import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Smaller batch to avoid rate limits
const BATCH_SIZE = 50;
const MAX_RUNTIME_MS = 25000;

// Rate limiting configuration - be conservative
const MAX_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 60000; // 60 seconds on 429
const REQUEST_DELAY_MS = 500; // 500ms between batch requests (increased from 200ms)
const INITIAL_RETRY_DELAY_MS = 5000; // 5 seconds for other retries

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void } | undefined;
const waitUntil = (p: Promise<unknown>) => { try { EdgeRuntime?.waitUntil(p); } catch {} };

// Helper: delay between requests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to fetch with rate limit handling
async function fetchWithRetry(
  url: string, 
  options: RequestInit, 
  maxRetries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Add delay between requests to avoid hitting rate limits
      if (attempt > 0) {
        console.log(`[email-scan] Retry attempt ${attempt}/${maxRetries}...`);
      }
      
      const response = await fetch(url, options);
      
      // If rate limited (429), wait 60 seconds and retry
      if (response.status === 429 && attempt < maxRetries) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter 
          ? parseInt(retryAfter, 10) * 1000 
          : RATE_LIMIT_WAIT_MS; // 60 seconds
        
        console.log(`[email-scan] Rate limited (429), waiting ${delayMs / 1000}s before retry ${attempt + 1}/${maxRetries}`);
        await delay(delayMs);
        continue;
      }
      
      // If server error (5xx), wait and retry with backoff
      if (response.status >= 500 && attempt < maxRetries) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.log(`[email-scan] Server error (${response.status}), waiting ${delayMs / 1000}s before retry ${attempt + 1}/${maxRetries}`);
        await delay(delayMs);
        continue;
      }
      
      return response;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.log(`[email-scan] Network error, waiting ${delayMs / 1000}s before retry ${attempt + 1}/${maxRetries}:`, err);
        await delay(delayMs);
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
    const { jobId, configId, resume = false } = await req.json();
    console.log('[email-scan] Starting:', { jobId, configId, resume });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: job } = await supabase.from('email_import_jobs').select('*').eq('id', jobId).single();
    if (!job || job.status === 'cancelled') {
      console.log('[email-scan] Job cancelled or not found');
      return new Response(JSON.stringify({ cancelled: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: config } = await supabase.from('email_provider_configs').select('*').eq('id', configId).single();
    if (!config) {
      await supabase.from('email_import_jobs').update({ status: 'error', error_message: 'Config not found' }).eq('id', jobId);
      return new Response(JSON.stringify({ error: 'Config not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const checkpoint = job.checkpoint || {};
    let phase: 'inbox' | 'sent' | 'done' = checkpoint.phase || 'inbox';
    let pageToken: string | null = checkpoint.page_token || null;
    let inboxScanned = job.inbox_emails_scanned || 0;
    let sentScanned = job.sent_emails_scanned || 0;

    const newStatus = phase === 'inbox' ? 'scanning_inbox' : 'scanning_sent';
    await supabase.from('email_import_jobs').update({
      status: newStatus,
      started_at: job.started_at || new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Update config stage for UI
    await supabase.from('email_provider_configs').update({
      sync_stage: phase === 'inbox' ? 'fetching_inbox' : 'fetching_sent',
      inbound_emails_found: inboxScanned,
      outbound_emails_found: sentScanned,
    }).eq('id', configId);

    let needsContinuation = false;

    while (phase !== 'done' && Date.now() - startTime < MAX_RUNTIME_MS) {
      const folder = phase === 'inbox' ? 'INBOX' : 'SENT';
      let url = `https://api.aurinko.io/v1/email/messages?folder=${folder}&limit=${BATCH_SIZE}`;
      if (pageToken) url += `&pageToken=${pageToken}`;

      console.log(`[email-scan] Fetching ${folder} page...`);

      const response = await fetchWithRetry(url, {
        headers: { 'Authorization': `Bearer ${config.access_token}` }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[email-scan] API error ${response.status}:`, errorText);
        
        if (response.status === 401) {
          await supabase.from('email_import_jobs').update({ status: 'error', error_message: 'Token expired - please reconnect email' }).eq('id', jobId);
          await supabase.from('email_provider_configs').update({ sync_status: 'error', sync_error: 'Token expired' }).eq('id', configId);
          break;
        }
        if (response.status === 429) {
          console.log('[email-scan] Rate limited, will continue...');
          needsContinuation = true;
          break;
        }
        await supabase.from('email_import_jobs').update({ status: 'error', error_message: `API error: ${response.status}` }).eq('id', jobId);
        await supabase.from('email_provider_configs').update({ sync_status: 'error', sync_error: `API error: ${response.status}` }).eq('id', configId);
        break;
      }

      const data = await response.json();
      const messages = data.records || [];
      const nextPageToken = data.nextPageToken || null;

      console.log(`[email-scan] Got ${messages.length} ${folder} messages`);

      if (messages.length > 0) {
        const rows = messages.map((msg: any) => ({
          workspace_id: config.workspace_id,
          config_id: configId,
          job_id: jobId,
          external_id: msg.id?.toString(),
          thread_id: msg.threadId?.toString() || msg.id?.toString(),
          direction: phase === 'inbox' ? 'inbound' : 'outbound',
          from_email: (msg.from?.address || msg.from?.email || '').toLowerCase(),
          from_name: msg.from?.name || null,
          to_emails: msg.to?.map((t: any) => (t.address || t.email || '').toLowerCase()) || [],
          subject: msg.subject || null,
          received_at: msg.receivedAt || msg.createdAt || null,
          status: 'scanned',
        }));

        const { error: upsertError } = await supabase
          .from('email_import_queue')
          .upsert(rows, { onConflict: 'workspace_id,external_id', ignoreDuplicates: true });
        
        if (upsertError) {
          console.error('[email-scan] Upsert error:', upsertError);
        }

        if (phase === 'inbox') inboxScanned += messages.length;
        else sentScanned += messages.length;
      }

      if (nextPageToken) {
        pageToken = nextPageToken;
        needsContinuation = true;
      } else {
        if (phase === 'inbox') {
          console.log('[email-scan] Inbox complete, moving to sent...');
          phase = 'sent';
          pageToken = null;
          needsContinuation = true;
        } else {
          console.log('[email-scan] Sent complete, moving to analysis...');
          phase = 'done';
          needsContinuation = false;
        }
      }

      // Update progress
      await supabase.from('email_import_jobs').update({
        checkpoint: { phase, page_token: pageToken },
        inbox_emails_scanned: inboxScanned,
        sent_emails_scanned: sentScanned,
        status: phase === 'done' ? 'analyzing' : (phase === 'inbox' ? 'scanning_inbox' : 'scanning_sent'),
        heartbeat_at: new Date().toISOString(),
      }).eq('id', jobId);

      await supabase.from('email_provider_configs').update({
        sync_stage: phase === 'done' ? 'analyzing' : (phase === 'inbox' ? 'fetching_inbox' : 'fetching_sent'),
        inbound_emails_found: inboxScanned,
        outbound_emails_found: sentScanned,
      }).eq('id', configId);

      // Add delay between batch requests to avoid rate limits
      await delay(REQUEST_DELAY_MS);

      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        console.log('[email-scan] Time limit reached, continuing...');
        needsContinuation = phase !== 'done';
        break;
      }
    }

    if (phase === 'done') {
      console.log('[email-scan] Scan complete, starting analysis...');
      await supabase.from('email_import_jobs').update({ 
        status: 'analyzing', 
        checkpoint: { phase: 'done' } 
      }).eq('id', jobId);
      
      await supabase.from('email_provider_configs').update({
        sync_stage: 'analyzing',
      }).eq('id', configId);
      
      waitUntil(supabase.functions.invoke('email-analyze', { body: { jobId, configId } }));
    } else if (needsContinuation) {
      console.log('[email-scan] Continuing scan...');
      waitUntil(supabase.functions.invoke('email-scan', { body: { jobId, configId, resume: true } }));
    }

    return new Response(JSON.stringify({ 
      success: true, 
      phase, 
      inboxScanned, 
      sentScanned, 
      needsContinuation 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[email-scan] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
