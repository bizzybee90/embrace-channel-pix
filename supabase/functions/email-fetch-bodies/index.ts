import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Smaller batch to stay within rate limits
const BATCH_SIZE = 20;
const MAX_RUNTIME_MS = 25000;

// Rate limiting - be conservative to avoid 429
const DELAY_BETWEEN_FETCHES_MS = 500; // 500ms between body fetches
const RATE_LIMIT_WAIT_MS = 60000; // 60 seconds on 429
const MAX_RETRIES = 3;

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void } | undefined;
const waitUntil = (p: Promise<unknown>) => { try { EdgeRuntime?.waitUntil(p); } catch {} };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const stripHtml = (html: string): string => html
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

const extractBody = (message: any): string => {
  let body = message.textBody || message.body?.text || '';
  if (!body && (message.body?.html || message.htmlBody)) {
    body = stripHtml(message.body?.html || message.htmlBody);
  }
  // Strip quoted reply content
  const stripped = body
    .split(/^On .+ wrote:$/m)[0]
    .split(/^-{2,}\s*Original Message/mi)[0]
    .split(/^>+\s/m)[0]
    .trim();
  return stripped.length > 10 ? stripped : body.trim();
};

async function fetchWithRetry(externalId: string, accessToken: string): Promise<{ data: any | null; rateLimited: boolean }> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`https://api.aurinko.io/v1/email/messages/${externalId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      if (response.ok) {
        return { data: await response.json(), rateLimited: false };
      }
      
      // Handle rate limiting specially
      if (response.status === 429) {
        if (attempt < MAX_RETRIES - 1) {
          const retryAfter = response.headers.get('Retry-After');
          const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : RATE_LIMIT_WAIT_MS;
          console.log(`[email-fetch-bodies] Rate limited, waiting ${waitMs / 1000}s...`);
          await sleep(waitMs);
          continue;
        }
        // Last retry failed with 429 - signal to pause the batch
        return { data: null, rateLimited: true };
      }
      
      // Server errors - retry with backoff
      if (response.status >= 500) {
        console.log(`[email-fetch-bodies] Server error ${response.status}, retry ${attempt + 1}`);
        await sleep(5000 * Math.pow(2, attempt));
        continue;
      }
      
      // 4xx errors (except 429) - don't retry
      console.log(`[email-fetch-bodies] Skipping ${externalId}: status ${response.status}`);
      return { data: null, rateLimited: false };
    } catch (err) {
      console.log(`[email-fetch-bodies] Network error, retry ${attempt + 1}:`, err);
      await sleep(3000 * Math.pow(2, attempt));
    }
  }
  return { data: null, rateLimited: false };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { jobId, configId } = await req.json();
    console.log('[email-fetch-bodies] Starting:', { jobId, configId });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: job } = await supabase.from('email_import_jobs').select('*').eq('id', jobId).single();
    if (!job || job.status === 'cancelled') {
      console.log('[email-fetch-bodies] Job cancelled or not found');
      return new Response(JSON.stringify({ cancelled: true }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const { data: config } = await supabase.from('email_provider_configs').select('*').eq('id', configId).single();
    if (!config) {
      await supabase.from('email_import_jobs').update({ status: 'error', error_message: 'Config not found' }).eq('id', jobId);
      return new Response(JSON.stringify({ error: 'Config not found' }), { 
        status: 404, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    await supabase.from('email_import_jobs').update({ 
      status: 'fetching', 
      heartbeat_at: new Date().toISOString() 
    }).eq('id', jobId);

    // Get batch of emails to fetch
    const { data: emailsToFetch } = await supabase
      .from('email_import_queue')
      .select('*')
      .eq('job_id', jobId)
      .eq('status', 'queued_for_fetch')
      .order('received_at', { ascending: false })
      .limit(BATCH_SIZE);

    if (!emailsToFetch || emailsToFetch.length === 0) {
      console.log('[email-fetch-bodies] All bodies fetched, completing job...');
      
      await supabase.from('email_import_jobs').update({ 
        status: 'completed', 
        completed_at: new Date().toISOString() 
      }).eq('id', jobId);
      
      await supabase.from('email_provider_configs').update({ 
        sync_status: 'completed', 
        sync_stage: 'complete',
        sync_completed_at: new Date().toISOString() 
      }).eq('id', configId);
      
      return new Response(JSON.stringify({ success: true, completed: true }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    console.log(`[email-fetch-bodies] Fetching ${emailsToFetch.length} email bodies with ${DELAY_BETWEEN_FETCHES_MS}ms delay...`);

    const connectedEmails = [
      config.email_address.toLowerCase(), 
      ...(config.aliases || []).map((a: string) => a.toLowerCase())
    ];
    
    let bodiesFetched = 0;
    let messagesCreated = 0;
    let wasRateLimited = false;

    for (const email of emailsToFetch) {
      // Check time limit
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        console.log('[email-fetch-bodies] Time limit reached');
        break;
      }

      // Delay between fetches to respect rate limits
      if (bodiesFetched > 0) {
        await sleep(DELAY_BETWEEN_FETCHES_MS);
      }

      const { data: fullMessage, rateLimited } = await fetchWithRetry(email.external_id, config.access_token);
      
      // If rate limited, stop this batch and wait before continuing
      if (rateLimited) {
        console.log('[email-fetch-bodies] Rate limited, pausing batch for 60s...');
        wasRateLimited = true;
        
        // Update status to show rate limiting
        await supabase.from('email_provider_configs').update({
          sync_error: 'Rate limited - pausing briefly...',
        }).eq('id', configId);
        
        break;
      }
      
      if (!fullMessage) {
        await supabase.from('email_import_queue').update({ 
          status: 'error', 
          error_message: 'Fetch failed after retries' 
        }).eq('id', email.id);
        continue;
      }

      const body = extractBody(fullMessage);
      
      await supabase.from('email_import_queue').update({
        body: body?.substring(0, 50000),
        has_body: true,
        status: 'fetched',
        fetched_at: new Date().toISOString()
      }).eq('id', email.id);
      
      bodiesFetched++;

      // Find or create conversation
      let conversationId: string | null = null;
      
      // Check for existing conversation by thread_id
      const { data: existingConv } = await supabase
        .from('conversations')
        .select('id')
        .eq('workspace_id', config.workspace_id)
        .contains('metadata', { thread_id: email.thread_id })
        .limit(1)
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
      }

      // Create conversation if this is an inbound email and no conversation exists
      if (!conversationId && email.direction === 'inbound') {
        // Find or create customer
        let customerId: string | null = null;
        
        const { data: existingCustomer } = await supabase
          .from('customers')
          .select('id')
          .eq('workspace_id', config.workspace_id)
          .eq('email', email.from_email)
          .single();

        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else if (email.from_email) {
          const { data: newCustomer } = await supabase
            .from('customers')
            .insert({
              workspace_id: config.workspace_id,
              email: email.from_email,
              name: email.from_name || email.from_email?.split('@')[0],
              preferred_channel: 'email'
            })
            .select('id')
            .single();
          customerId = newCustomer?.id || null;
        }

        if (customerId) {
          const { data: newConv } = await supabase
            .from('conversations')
            .insert({
              workspace_id: config.workspace_id,
              customer_id: customerId,
              channel: 'email',
              title: email.subject || 'No Subject',
              status: 'closed',
              external_conversation_id: `aurinko_${email.thread_id}`,
              metadata: { 
                thread_id: email.thread_id, 
                email_provider: config.provider, 
                imported: true 
              },
              created_at: email.received_at,
            })
            .select('id')
            .single();
          conversationId = newConv?.id || null;
        }
      }

      // Create message if we have a conversation and body
      if (conversationId && body && body.length >= 5) {
        // Check for duplicate
        const { data: existingMsg } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('raw_payload->>id', email.external_id)
          .maybeSingle();

        if (!existingMsg) {
          const isOutbound = email.direction === 'outbound' || connectedEmails.includes(email.from_email);
          
          await supabase.from('messages').insert({
            conversation_id: conversationId,
            body: body.substring(0, 10000),
            direction: isOutbound ? 'outbound' : 'inbound',
            channel: 'email',
            actor_type: isOutbound ? 'human_agent' : 'customer',
            actor_name: email.from_name || email.from_email?.split('@')[0],
            created_at: email.received_at,
            raw_payload: fullMessage,
          });
          
          messagesCreated++;
          
          await supabase.from('email_import_queue').update({ 
            status: 'processed', 
            processed_at: new Date().toISOString() 
          }).eq('id', email.id);
        }
      }
    }

    // Update job progress
    const { data: currentJob } = await supabase
      .from('email_import_jobs')
      .select('bodies_fetched, messages_created')
      .eq('id', jobId)
      .single();
      
    await supabase.from('email_import_jobs').update({
      bodies_fetched: (currentJob?.bodies_fetched || 0) + bodiesFetched,
      messages_created: (currentJob?.messages_created || 0) + messagesCreated,
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Check if more to process
    const { count: remainingCount } = await supabase
      .from('email_import_queue')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('status', 'queued_for_fetch');

    console.log(`[email-fetch-bodies] Fetched ${bodiesFetched}, created ${messagesCreated} messages, ${remainingCount} remaining`);

    if (remainingCount && remainingCount > 0) {
      // If rate limited, wait 60s before continuing
      if (wasRateLimited) {
        console.log('[email-fetch-bodies] Scheduling retry after rate limit wait...');
        await sleep(RATE_LIMIT_WAIT_MS);
        await supabase.from('email_provider_configs').update({
          sync_error: null,
        }).eq('id', configId);
      }
      
      // Continue fetching
      waitUntil(supabase.functions.invoke('email-fetch-bodies', { body: { jobId, configId } }));
    } else {
      // All done
      console.log('[email-fetch-bodies] Job complete!');
      
      await supabase.from('email_import_jobs').update({ 
        status: 'completed', 
        completed_at: new Date().toISOString() 
      }).eq('id', jobId);
      
      await supabase.from('email_provider_configs').update({ 
        sync_status: 'completed',
        sync_stage: 'complete', 
        sync_error: null,
        sync_completed_at: new Date().toISOString() 
      }).eq('id', configId);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      bodiesFetched, 
      messagesCreated, 
      remaining: remainingCount,
      wasRateLimited 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[email-fetch-bodies] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
