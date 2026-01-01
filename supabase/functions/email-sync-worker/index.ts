import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Safe batch size to avoid timeouts (process ~50 messages per invocation)
const BATCH_SIZE = 50;
const MAX_RUNTIME_MS = 25000; // 25 seconds, leave buffer before 30s timeout

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const { jobId, configId } = await req.json();
    console.log('Email sync worker started:', { jobId, configId });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get the sync job
    const { data: job, error: jobError } = await supabase
      .from('email_sync_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      console.error('Job not found:', jobError);
      return new Response(JSON.stringify({ error: 'Job not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get email config
    const { data: config, error: configError } = await supabase
      .from('email_provider_configs')
      .select('*')
      .eq('id', configId)
      .single();

    if (configError || !config) {
      await supabase.from('email_sync_jobs').update({ 
        status: 'error', 
        error_message: 'Email config not found' 
      }).eq('id', jobId);
      return new Response(JSON.stringify({ error: 'Config not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Mark job as running
    await supabase.from('email_sync_jobs').update({ 
      status: 'running',
      last_batch_at: new Date().toISOString(),
      started_at: job.started_at || new Date().toISOString()
    }).eq('id', jobId);

    const allConnectedEmails = [
      config.email_address.toLowerCase(), 
      ...(config.aliases || []).map((a: string) => a.toLowerCase())
    ];

    const stripHtml = (html: string): string => {
      return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
    };

    let inboundProcessed = job.inbound_processed || 0;
    let sentProcessed = job.sent_processed || 0;
    let threadsLinked = job.threads_linked || 0;
    let batchCount = 0;
    let needsContinuation = false;

    // Determine which phase we're in
    const isInboundPhase = !job.inbound_cursor || job.inbound_cursor !== 'DONE';
    
    if (isInboundPhase) {
      // INBOUND PHASE
      console.log('Processing inbound emails, cursor:', job.inbound_cursor);
      
      await supabase.from('email_provider_configs').update({ 
        sync_stage: 'fetching_inbox' 
      }).eq('id', configId);

      const baseUrl = 'https://api.aurinko.io/v1/email/messages';
      let queryParams = [`limit=${BATCH_SIZE}`];
      
      if (job.inbound_cursor && job.inbound_cursor !== 'START') {
        queryParams.push(`pageToken=${job.inbound_cursor}`);
      }

      const fetchUrl = `${baseUrl}?${queryParams.join('&')}`;
      console.log('Fetching:', fetchUrl);

      const response = await fetch(fetchUrl, {
        headers: { 'Authorization': `Bearer ${config.access_token}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Fetch failed:', response.status, errorText);
        await supabase.from('email_sync_jobs').update({ 
          status: 'error', 
          error_message: `API error: ${response.status}` 
        }).eq('id', jobId);
        return new Response(JSON.stringify({ error: 'API fetch failed' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const data = await response.json();
      const messages = data.records || [];
      const nextPageToken = data.nextPageToken || null;

      console.log(`Fetched ${messages.length} messages, nextPage: ${!!nextPageToken}`);

      for (const messageSummary of messages) {
        if (Date.now() - startTime > MAX_RUNTIME_MS) {
          console.log('Approaching timeout, saving progress');
          needsContinuation = true;
          break;
        }

        try {
          const externalId = messageSummary.id?.toString();

          // Count "processed" emails as those we have scanned, even if we skip importing
          // (prevents UI from appearing stuck when most emails were imported previously).
          inboundProcessed++;

          // Skip if exists
          const { data: existing } = await supabase
            .from('conversations')
            .select('id')
            .eq('external_conversation_id', `aurinko_${externalId}`)
            .single();

          if (existing) continue;

          // Fetch full message
          const fullResp = await fetch(`https://api.aurinko.io/v1/email/messages/${externalId}`, {
            headers: { 'Authorization': `Bearer ${config.access_token}` },
          });

          if (!fullResp.ok) continue;

          const message = await fullResp.json();
          const fromEmail = (message.from?.address || message.from?.email || '').toLowerCase();
          const fromName = message.from?.name || fromEmail.split('@')[0] || 'Unknown';
          const subject = message.subject || 'No Subject';
          const threadId = message.threadId || externalId;

          // Skip outbound
          if (allConnectedEmails.includes(fromEmail)) continue;

          // Extract body
          let body = message.textBody || message.body?.text || '';
          if (!body && (message.body?.html || message.htmlBody)) {
            body = stripHtml(message.body?.html || message.htmlBody);
          }

          const receivedAt = message.receivedAt || message.createdAt;

          // Find or create customer
          let customer;
          const { data: existingCustomer } = await supabase
            .from('customers')
            .select('*')
            .eq('email', fromEmail)
            .eq('workspace_id', config.workspace_id)
            .single();

          if (existingCustomer) {
            customer = existingCustomer;
          } else {
            const { data: newCustomer } = await supabase
              .from('customers')
              .insert({
                workspace_id: config.workspace_id,
                email: fromEmail,
                name: fromName,
                preferred_channel: 'email',
              })
              .select()
              .single();
            customer = newCustomer;
          }

          if (!customer) continue;

          // Create conversation
          const { data: conversation } = await supabase
            .from('conversations')
            .insert({
              workspace_id: config.workspace_id,
              customer_id: customer.id,
              channel: 'email',
              title: subject,
              status: 'new',
              external_conversation_id: `aurinko_${externalId}`,
              metadata: { thread_id: threadId, email_provider: config.provider },
              created_at: receivedAt,
            })
            .select()
            .single();

          if (!conversation) continue;

          // Create message
          await supabase.from('messages').insert({
            conversation_id: conversation.id,
            body: body.substring(0, 10000),
            direction: 'inbound',
            channel: 'email',
            actor_type: 'customer',
            actor_name: fromName,
            created_at: receivedAt,
            raw_payload: message,
          });

          batchCount++;

        } catch (err) {
          console.error('Error processing message:', err);
        }
      }

      // Update job with progress
      const newCursor = needsContinuation 
        ? (job.inbound_cursor || 'START')  // Keep same cursor if interrupted
        : (nextPageToken || 'DONE');
      
      await supabase.from('email_sync_jobs').update({
        inbound_cursor: newCursor,
        inbound_processed: inboundProcessed,
        last_batch_at: new Date().toISOString(),
        status: (newCursor === 'DONE' && !nextPageToken) ? 'running' : 'running'
      }).eq('id', jobId);

      await supabase.from('email_provider_configs').update({
        inbound_emails_found: inboundProcessed,
        sync_progress: inboundProcessed + sentProcessed,
      }).eq('id', configId);

      needsContinuation = needsContinuation || !!nextPageToken;

    } else {
      // SENT PHASE
      console.log('Processing sent emails, cursor:', job.sent_cursor);
      
      await supabase.from('email_provider_configs').update({ 
        sync_stage: 'fetching_sent' 
      }).eq('id', configId);

      const baseUrl = 'https://api.aurinko.io/v1/email/messages';
      let queryParams = [`folder=SENT`, `limit=${BATCH_SIZE}`];
      
      if (job.sent_cursor && job.sent_cursor !== 'START') {
        queryParams.push(`pageToken=${job.sent_cursor}`);
      }

      const fetchUrl = `${baseUrl}?${queryParams.join('&')}`;
      const response = await fetch(fetchUrl, {
        headers: { 'Authorization': `Bearer ${config.access_token}` },
      });

      if (response.ok) {
        const data = await response.json();
        const messages = data.records || [];
        const nextPageToken = data.nextPageToken || null;

        for (const message of messages) {
          if (Date.now() - startTime > MAX_RUNTIME_MS) {
            needsContinuation = true;
            break;
          }

          try {
            const externalId = message.id?.toString();
            const threadId = message.threadId || externalId;

            // Check for existing
            const { data: existingMsg } = await supabase
              .from('messages')
              .select('id')
              .eq('raw_payload->>id', externalId)
              .single();

            if (existingMsg) continue;

            // Fetch full message
            const fullResp = await fetch(`https://api.aurinko.io/v1/email/messages/${externalId}`, {
              headers: { 'Authorization': `Bearer ${config.access_token}` },
            });

            if (!fullResp.ok) continue;

            const fullMsg = await fullResp.json();
            let body = fullMsg.textBody || fullMsg.body?.text || '';
            if (!body && (fullMsg.body?.html || fullMsg.htmlBody)) {
              body = stripHtml(fullMsg.body?.html || fullMsg.htmlBody);
            }

            // Strip quoted content
            body = body.split(/^On .+ wrote:$/m)[0]
              .split(/^>+/m)[0]
              .trim();

            if (!body || body.length < 20) continue;

            // Find conversation
            const { data: conversation } = await supabase
              .from('conversations')
              .select('id')
              .eq('metadata->>thread_id', threadId)
              .eq('workspace_id', config.workspace_id)
              .single();

            if (conversation) {
              await supabase.from('messages').insert({
                conversation_id: conversation.id,
                body: body.substring(0, 10000),
                direction: 'outbound',
                channel: 'email',
                actor_type: 'human_agent',
                actor_name: config.email_address.split('@')[0],
                created_at: fullMsg.sentAt || fullMsg.createdAt,
                raw_payload: fullMsg,
              });
              threadsLinked++;
            }

            sentProcessed++;
            batchCount++;

          } catch (err) {
            console.error('Error processing sent:', err);
          }
        }

        const newSentCursor = needsContinuation 
          ? (job.sent_cursor || 'START')
          : (nextPageToken || 'DONE');

        await supabase.from('email_sync_jobs').update({
          sent_cursor: newSentCursor,
          sent_processed: sentProcessed,
          threads_linked: threadsLinked,
          last_batch_at: new Date().toISOString(),
        }).eq('id', jobId);

        await supabase.from('email_provider_configs').update({
          outbound_emails_found: sentProcessed,
          threads_linked: threadsLinked,
          sync_progress: inboundProcessed + sentProcessed,
        }).eq('id', configId);

        needsContinuation = needsContinuation || !!nextPageToken;

      } else {
        console.log('Sent folder not available, marking done');
        await supabase.from('email_sync_jobs').update({
          sent_cursor: 'DONE',
        }).eq('id', jobId);
      }
    }

    // Check if we're completely done
    const { data: updatedJob } = await supabase
      .from('email_sync_jobs')
      .select('inbound_cursor, sent_cursor')
      .eq('id', jobId)
      .single();

    const isComplete = updatedJob?.inbound_cursor === 'DONE' && updatedJob?.sent_cursor === 'DONE';

    if (isComplete) {
      console.log('Sync complete! Marking job done.');
      await supabase.from('email_sync_jobs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', jobId);

      await supabase.from('email_provider_configs').update({
        sync_status: 'completed',
        sync_stage: 'complete',
        sync_completed_at: new Date().toISOString(),
      }).eq('id', configId);

      // Trigger voice profile analysis if we have enough sent emails
      if (sentProcessed >= 10) {
        supabase.functions.invoke('analyze-voice-profile', {
          body: { workspace_id: config.workspace_id }
        }).catch(err => console.error('Voice analysis failed:', err));
      }

    } else if (needsContinuation) {
      // Schedule next batch (self-invoke)
      console.log('Scheduling next batch...');
      supabase.functions.invoke('email-sync-worker', {
        body: { jobId, configId }
      }).catch(err => console.error('Failed to schedule next batch:', err));
    }

    return new Response(JSON.stringify({ 
      success: true,
      inboundProcessed,
      sentProcessed,
      threadsLinked,
      batchCount,
      isComplete,
      needsContinuation
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Worker error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
