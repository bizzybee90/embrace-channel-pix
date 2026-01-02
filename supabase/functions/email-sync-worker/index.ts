import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Edge runtime helper (type shim for TS)
declare const EdgeRuntime:
  | { waitUntil: (promise: Promise<unknown>) => void }
  | undefined;

const waitUntil = (promise: Promise<unknown>) => {
  try {
    EdgeRuntime?.waitUntil(promise);
  } catch {
    // no-op (shouldn't happen in production edge runtime)
  }
};

// Safe batch size to avoid timeouts (process ~50 messages per invocation)
const BATCH_SIZE = 50;
const MAX_RUNTIME_MS = 25000; // 25 seconds, leave buffer before 30s timeout

// Retry configuration for rate limits
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 2000; // 2 seconds

// Import mode limits - stop fetching when limit is reached
const IMPORT_MODE_LIMITS: Record<string, number | null> = {
  'last_1000': 1000,
  'all_historical_30_days': null, // Use date filter instead
  'all_historical_90_days': null, // Use date filter instead
  'unread_only': null, // Handled differently
  'new_only': null, // No historical import
  'all_history': null, // No limit
};

// Helper function to fetch with exponential backoff retry
async function fetchWithRetry(
  url: string, 
  options: RequestInit, 
  maxRetries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // If rate limited (429), wait and retry
      if (response.status === 429 && attempt < maxRetries) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter 
          ? parseInt(retryAfter, 10) * 1000 
          : INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        
        console.log(`[Retry] Rate limited (429), waiting ${delayMs}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      
      // If server error (5xx), wait and retry
      if (response.status >= 500 && attempt < maxRetries) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.log(`[Retry] Server error (${response.status}), waiting ${delayMs}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      
      return response;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.log(`[Retry] Network error, waiting ${delayMs}ms before retry ${attempt + 1}/${maxRetries}:`, err);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

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

    // Check if job was cancelled by user
    if (job.status === 'cancelled') {
      console.log('[Worker] Job was cancelled by user, exiting');
      return new Response(JSON.stringify({ cancelled: true, reason: 'user_cancelled' }), {
        status: 200,
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

    // CRITICAL: Check if this job is still the active job for this config
    // If not, another sync has been started and this job should exit
    if (config.active_job_id && config.active_job_id !== jobId) {
      console.log('[Worker] Job superseded by newer job, exiting', { 
        thisJob: jobId, 
        activeJob: config.active_job_id 
      });
      await supabase.from('email_sync_jobs').update({ 
        status: 'cancelled',
        error_message: 'Superseded by newer sync job'
      }).eq('id', jobId);
      return new Response(JSON.stringify({ cancelled: true, reason: 'superseded' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Mark job as running
    await supabase.from('email_sync_jobs').update({ 
      status: 'running',
      last_batch_at: new Date().toISOString(),
      started_at: job.started_at || new Date().toISOString()
    }).eq('id', jobId);

    // Determine import limit based on mode
    const importLimit = IMPORT_MODE_LIMITS[job.import_mode] ?? null;
    console.log('[Worker] Import mode:', job.import_mode, 'Limit:', importLimit);

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

    // Check if we've already hit the import limit (for resuming jobs)
    const limitReached = importLimit !== null && inboundProcessed >= importLimit;
    if (limitReached) {
      console.log('[Worker] Import limit already reached:', inboundProcessed, '>=', importLimit);
    }

    // Determine which phase we're in
    const isInboundPhase = !job.inbound_cursor || job.inbound_cursor !== 'DONE';
    
    if (isInboundPhase && !limitReached) {
      // INBOUND PHASE
      console.log('Processing inbound emails, cursor:', job.inbound_cursor, 'Processed so far:', inboundProcessed);
      
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

      const response = await fetchWithRetry(fetchUrl, {
        headers: { 'Authorization': `Bearer ${config.access_token}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Fetch failed:', response.status, errorText);

        const snippet = (errorText || '').slice(0, 300);
        const errorMessage = `API error: ${response.status}${snippet ? ` - ${snippet}` : ''}`;

        // If Aurinko rejects an older pageToken (HTTP 400), restart from the beginning once.
        // This is safe because we de-dupe by external ids and prevents “stuck forever” imports.
        if (
          response.status === 400 &&
          job.inbound_cursor &&
          job.inbound_cursor !== 'START' &&
          job.inbound_cursor !== 'DONE'
        ) {
          console.log('[Worker] Page token rejected (400). Restarting inbound scan from START.', {
            previousCursor: job.inbound_cursor,
          });

          await supabase.from('email_sync_jobs').update({
            inbound_cursor: 'START',
            last_batch_at: new Date().toISOString(),
            // Keep status running; surface context for debugging without halting.
            status: 'running',
            error_message: `Cursor rejected (400). Restarting from START. ${snippet}`.slice(0, 1000),
          }).eq('id', jobId);

          // Keep config in "syncing" state (this is a recoverable issue)
          await supabase.from('email_provider_configs').update({
            sync_status: 'syncing',
            sync_error: null,
          }).eq('id', configId);

          // Schedule a continuation immediately
          waitUntil(
            supabase.functions.invoke('email-sync-worker', {
              body: { jobId, configId },
            }).then(({ error }) => {
              if (error) console.error('Failed to schedule recovery batch:', error);
            })
          );

          return new Response(JSON.stringify({ recovered: true, reason: 'cursor_rejected' }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Non-recoverable error: update both job AND config to reflect error state
        await supabase.from('email_sync_jobs').update({
          status: 'error',
          error_message: errorMessage.slice(0, 1000),
        }).eq('id', jobId);

        await supabase.from('email_provider_configs').update({
          sync_status: 'error',
          sync_error: errorMessage.slice(0, 1000),
        }).eq('id', configId);

        return new Response(JSON.stringify({ error: 'API fetch failed', details: errorMessage }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await response.json();
      const messages = data.records || [];
      const nextPageToken = data.nextPageToken || null;

      console.log(`Fetched ${messages.length} messages, nextPage: ${!!nextPageToken}`);

      for (const messageSummary of messages) {
        // Check timeout
        if (Date.now() - startTime > MAX_RUNTIME_MS) {
          console.log('Approaching timeout, saving progress');
          needsContinuation = true;
          break;
        }

        // Check import limit
        if (importLimit !== null && inboundProcessed >= importLimit) {
          console.log('[Worker] Import limit reached:', inboundProcessed, '>=', importLimit);
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

          // Fetch full message with retry
          const fullResp = await fetchWithRetry(`https://api.aurinko.io/v1/email/messages/${externalId}`, {
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

      // Check if we hit the import limit
      const hitLimit = importLimit !== null && inboundProcessed >= importLimit;
      
      // Update job with progress
      const newCursor = hitLimit
        ? 'DONE'  // Mark inbound as done when limit is reached
        : needsContinuation 
          ? (job.inbound_cursor || 'START')  // Keep same cursor if interrupted
          : (nextPageToken || 'DONE');
      
      if (hitLimit) {
        console.log('[Worker] Marking inbound DONE due to limit:', inboundProcessed);
      }
      
      await supabase.from('email_sync_jobs').update({
        inbound_cursor: newCursor,
        inbound_processed: inboundProcessed,
        last_batch_at: new Date().toISOString(),
        status: 'running'
      }).eq('id', jobId);

      // Update provider config progress monotonically (avoid jumping backwards if multiple jobs run)
      const { data: currentCounts } = await supabase
        .from('email_provider_configs')
        .select('inbound_emails_found, outbound_emails_found, threads_linked, sync_progress')
        .eq('id', configId)
        .single();

      const inboundFound = Math.max(currentCounts?.inbound_emails_found ?? 0, inboundProcessed);
      const outboundFound = Math.max(currentCounts?.outbound_emails_found ?? 0, sentProcessed);
      const linkedCount = Math.max(currentCounts?.threads_linked ?? 0, threadsLinked);
      const progressCount = Math.max(currentCounts?.sync_progress ?? 0, inboundFound + outboundFound);

      await supabase.from('email_provider_configs').update({
        inbound_emails_found: inboundFound,
        outbound_emails_found: outboundFound,
        threads_linked: linkedCount,
        sync_progress: progressCount,
      }).eq('id', configId);

      // Only continue if we haven't hit the limit and there's more pages
      needsContinuation = (needsContinuation || !!nextPageToken) && !(importLimit !== null && inboundProcessed >= importLimit);

    } else if (isInboundPhase && limitReached) {
      // If limit was already reached on job resume but inbound wasn't marked done yet
      console.log('[Worker] Limit was already reached, marking inbound DONE');
      await supabase.from('email_sync_jobs').update({
        inbound_cursor: 'DONE',
        last_batch_at: new Date().toISOString(),
      }).eq('id', jobId);
      // Don't set needsContinuation - let this batch complete, next call will hit sent phase
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
      console.log('[Worker] Fetching sent emails from:', fetchUrl);
      
      const response = await fetchWithRetry(fetchUrl, {
        headers: { 'Authorization': `Bearer ${config.access_token}` },
      });

      console.log('[Worker] Sent API response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        const messages = data.records || [];
        const nextPageToken = data.nextPageToken || null;
        console.log('[Worker] Sent messages fetched:', messages.length, 'nextPage:', !!nextPageToken);

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

            // Fetch full message with retry
            const fullResp = await fetchWithRetry(`https://api.aurinko.io/v1/email/messages/${externalId}`, {
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

            // Find conversation by thread_id OR external_conversation_id
            let conversationId: string | null = null;
            
            // Try metadata->thread_id first
            const { data: conv1 } = await supabase
              .from('conversations')
              .select('id')
              .eq('metadata->>thread_id', threadId)
              .eq('workspace_id', config.workspace_id)
              .limit(1)
              .maybeSingle();
            
            if (conv1) {
              conversationId = conv1.id;
            } else {
              // Try external_conversation_id
              const { data: conv2 } = await supabase
                .from('conversations')
                .select('id')
                .eq('external_conversation_id', threadId)
                .eq('workspace_id', config.workspace_id)
                .limit(1)
                .maybeSingle();
              if (conv2) conversationId = conv2.id;
            }

            if (conversationId) {
              await supabase.from('messages').insert({
                conversation_id: conversationId,
                body: body.substring(0, 10000),
                direction: 'outbound',
                channel: 'email',
                actor_type: 'human_agent',
                actor_name: config.email_address.split('@')[0],
                created_at: fullMsg.sentAt || fullMsg.createdAt,
                raw_payload: fullMsg,
              });
              threadsLinked++;
            } else {
              console.log('[Worker] No matching conversation for sent email, threadId:', threadId);
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

        // Update provider config progress monotonically (avoid jumping backwards if multiple jobs run)
        const { data: currentCounts } = await supabase
          .from('email_provider_configs')
          .select('inbound_emails_found, outbound_emails_found, threads_linked, sync_progress')
          .eq('id', configId)
          .single();

        const inboundFound = Math.max(currentCounts?.inbound_emails_found ?? 0, inboundProcessed);
        const outboundFound = Math.max(currentCounts?.outbound_emails_found ?? 0, sentProcessed);
        const linkedCount = Math.max(currentCounts?.threads_linked ?? 0, threadsLinked);
        const progressCount = Math.max(currentCounts?.sync_progress ?? 0, inboundFound + outboundFound);

        await supabase.from('email_provider_configs').update({
          inbound_emails_found: inboundFound,
          outbound_emails_found: outboundFound,
          threads_linked: linkedCount,
          sync_progress: progressCount,
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
        sync_stage: 'matching_threads',
        sync_completed_at: new Date().toISOString(),
      }).eq('id', configId);

      // Update onboarding progress
      await supabase.from('onboarding_progress').update({
        email_import_status: 'completed',
        email_import_count: inboundProcessed + sentProcessed,
        thread_matching_status: 'running',
      }).eq('workspace_id', config.workspace_id);

      // Trigger thread matching (Phase 2 of training)
      console.log('Starting thread matching phase...');
      // Ensure the background invocation isn't dropped during function shutdown
      waitUntil(
        supabase.functions
          .invoke('match-email-threads', {
            body: { workspace_id: config.workspace_id },
          })
          .then(({ data, error }) => {
            if (error) console.error('Thread matching failed:', error);
            else console.log('Thread matching started:', data);
          })
          .catch((err) => console.error('Thread matching failed:', err))
      );

    } else if (needsContinuation) {
      // Schedule next batch (self-invoke)
      console.log('Scheduling next batch...');
      // Ensure the self-invocation isn't dropped during function shutdown
      waitUntil(
        supabase.functions
          .invoke('email-sync-worker', {
            body: { jobId, configId },
          })
          .then(({ data, error }) => {
            if (error) console.error('Failed to schedule next batch:', error);
            else console.log('Next batch scheduled:', data);
          })
          .catch((err) => console.error('Failed to schedule next batch:', err))
      );
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
    
    // Try to update config status on unhandled errors too
    try {
      const { jobId, configId } = await req.clone().json().catch(() => ({}));
      if (configId) {
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        
        await supabase.from('email_provider_configs').update({
          sync_status: 'error',
          sync_error: String(error),
        }).eq('id', configId);
        
        if (jobId) {
          await supabase.from('email_sync_jobs').update({
            status: 'error',
            error_message: String(error),
          }).eq('id', jobId);
        }
      }
    } catch (e) {
      console.error('Failed to update error status:', e);
    }
    
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
