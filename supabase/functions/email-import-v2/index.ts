import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for TypeScript
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

// =============================================================================
// ROBUST EMAIL IMPORT WITH CHECKPOINTING & BACKGROUND PROCESSING
// Handles 30,000+ emails with automatic resumption and rate limiting
// =============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AURINKO_API_BASE = 'https://api.aurinko.io/v1';
const FUNCTION_NAME = 'email-import-v2';
const BATCH_SIZE = 50;
const TIMEOUT_BUFFER_MS = 50000; // Stop 10s before 60s timeout
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

interface ImportJob {
  id: string;
  workspace_id: string;
  status: 'pending' | 'in_progress' | 'paused' | 'completed' | 'failed';
  import_mode: string;
  total_target: number;
  inbox_imported: number;
  sent_imported: number;
  inbox_page_token: string | null;
  sent_page_token: string | null;
  current_folder: 'SENT' | 'INBOX';
  error_message: string | null;
  retry_count: number;
  last_batch_at: string | null;
}

// =============================================================================
// UTILITIES
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getBackoffDelay(attempt: number): number {
  const exponentialDelay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(exponentialDelay + jitter, 30000);
}

function shouldContinueProcessing(startTime: number): boolean {
  return Date.now() - startTime < TIMEOUT_BUFFER_MS;
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { workspace_id, job_id, import_mode = 'full' } = body;

    if (!workspace_id) {
      throw new Error('workspace_id is required');
    }

    console.log(`[${FUNCTION_NAME}] Starting:`, { workspace_id, job_id, import_mode });

    // -------------------------------------------------------------------------
    // Get or Create Import Job
    // -------------------------------------------------------------------------
    let job: ImportJob;

    if (job_id) {
      // Resume existing job
      const { data, error } = await supabase
        .from('email_import_jobs')
        .select('*')
        .eq('id', job_id)
        .single();

      if (error || !data) {
        throw new Error(`Job ${job_id} not found`);
      }
      job = data as ImportJob;
    } else {
      // Create new job
      const totalTarget = import_mode === 'last_100' ? 100 : 
                         import_mode === 'last_1000' ? 1000 : 30000;

      const { data, error } = await supabase
        .from('email_import_jobs')
        .insert({
          workspace_id,
          status: 'in_progress',
          import_mode,
          total_target: totalTarget,
          inbox_imported: 0,
          sent_imported: 0,
          inbox_page_token: null,
          sent_page_token: null,
          current_folder: 'SENT',
          retry_count: 0,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      job = data as ImportJob;
    }

    // Update job to in_progress
    await supabase
      .from('email_import_jobs')
      .update({ status: 'in_progress', last_batch_at: new Date().toISOString() })
      .eq('id', job.id);

    // -------------------------------------------------------------------------
    // Get Email Provider Config
    // -------------------------------------------------------------------------
    const { data: emailConfig, error: configError } = await supabase
      .from('email_provider_configs')
      .select('access_token, email_address')
      .eq('workspace_id', workspace_id)
      .single();

    if (configError || !emailConfig?.access_token) {
      throw new Error('Email not connected. Please connect your email account first.');
    }

    // -------------------------------------------------------------------------
    // Process Emails in Batches
    // -------------------------------------------------------------------------
    let batchesProcessed = 0;
    let totalImportedThisRun = 0;
    const targetPerFolder = Math.floor(job.total_target / 2);

    // Continue with current folder
    while (shouldContinueProcessing(startTime)) {
      const folder = job.current_folder;
      const imported = folder === 'SENT' ? job.sent_imported : job.inbox_imported;
      const pageToken = folder === 'SENT' ? job.sent_page_token : job.inbox_page_token;

      // Check if folder is complete
      if (imported >= targetPerFolder) {
        if (folder === 'SENT') {
          // Switch to INBOX
          job.current_folder = 'INBOX';
          await supabase
            .from('email_import_jobs')
            .update({ current_folder: 'INBOX' })
            .eq('id', job.id);
          continue;
        } else {
          // Both folders complete
          break;
        }
      }

      // Fetch batch from Aurinko
      const batchLimit = Math.min(BATCH_SIZE, targetPerFolder - imported);
      
      let response: Response;
      let retryCount = 0;

      while (retryCount < MAX_RETRIES) {
        const url = new URL(`${AURINKO_API_BASE}/email/messages`);
        url.searchParams.set('limit', String(batchLimit));
        url.searchParams.set('folder', folder);
        if (pageToken) {
          url.searchParams.set('pageToken', pageToken);
        }

        response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${emailConfig.access_token}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) break;

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : getBackoffDelay(retryCount);
          console.log(`[${FUNCTION_NAME}] Rate limited, waiting ${delay}ms`);
          
          // If delay would exceed timeout, save checkpoint and exit
          if (!shouldContinueProcessing(startTime)) {
            await saveCheckpoint(supabase, job, 'paused');
            return createResponse({
              success: true,
              status: 'paused',
              job_id: job.id,
              message: 'Rate limited, will continue automatically',
              progress: getProgress(job),
              should_continue: true,
            });
          }
          
          await sleep(delay);
          retryCount++;
          continue;
        }

        if (response.status === 401) {
          throw new Error('Email access token expired. Please reconnect your email account.');
        }

        throw new Error(`Aurinko API error: ${response.status}`);
      }

      // Parse response
      const data = await response!.json();
      const messages = data.records || [];

      if (messages.length === 0) {
        // No more emails in this folder
        if (folder === 'SENT') {
          job.current_folder = 'INBOX';
          job.sent_page_token = null;
        } else {
          // All done
          break;
        }
        continue;
      }

      // Transform and save emails
      const emailsToSave = messages.map((msg: any) => ({
        workspace_id,
        external_id: msg.id,
        thread_id: msg.threadId,
        from_email: msg.from?.address || '',
        from_name: msg.from?.name || null,
        to_email: msg.to?.[0]?.address || '',
        subject: msg.subject || '',
        body_text: msg.textBody || msg.bodySnippet || '',
        received_at: msg.receivedAt || msg.createdAt,
        folder,
        email_type: folder === 'SENT' ? 'sent' : 'received',
        status: 'imported',
      }));

      const { error: insertError, data: insertedData } = await supabase
        .from('raw_emails')
        .upsert(emailsToSave, {
          onConflict: 'workspace_id,external_id',
          ignoreDuplicates: true,
        })
        .select('id');

      if (insertError) {
        console.error(`[${FUNCTION_NAME}] Insert error:`, insertError.message);
      }

      const savedCount = insertedData?.length || messages.length;
      totalImportedThisRun += savedCount;
      batchesProcessed++;

      // Update job state
      if (folder === 'SENT') {
        job.sent_imported += savedCount;
        job.sent_page_token = data.nextPageToken || null;
      } else {
        job.inbox_imported += savedCount;
        job.inbox_page_token = data.nextPageToken || null;
      }

      // Save checkpoint every batch
      await saveCheckpoint(supabase, job, 'in_progress');

      console.log(`[${FUNCTION_NAME}] Batch ${batchesProcessed}: ${folder} +${savedCount}, total: ${job.sent_imported + job.inbox_imported}`);

      // No more pages
      if (!data.nextPageToken) {
        if (folder === 'SENT') {
          job.current_folder = 'INBOX';
        } else {
          break;
        }
      }
    }

    // -------------------------------------------------------------------------
    // Determine if Complete or Need Continuation
    // -------------------------------------------------------------------------
    const totalImported = job.sent_imported + job.inbox_imported;
    const isComplete = totalImported >= job.total_target || 
                      (job.inbox_imported >= targetPerFolder && job.sent_imported >= targetPerFolder);

    if (isComplete) {
      await supabase
        .from('email_import_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      return createResponse({
        success: true,
        status: 'completed',
        job_id: job.id,
        total_imported: totalImported,
        sent_count: job.sent_imported,
        inbox_count: job.inbox_imported,
        duration_ms: Date.now() - startTime,
        should_continue: false,
      });
    }

    // Need to continue - trigger next batch
    await saveCheckpoint(supabase, job, 'in_progress');

    // Use EdgeRuntime.waitUntil for background continuation
    const continuePayload = { workspace_id, job_id: job.id };
    
    // Schedule next batch (fire and forget)
    EdgeRuntime.waitUntil(
      sleep(1000).then(() => 
        fetch(`${supabaseUrl}/functions/v1/${FUNCTION_NAME}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(continuePayload),
        }).catch(err => console.error('[${FUNCTION_NAME}] Chain error:', err))
      )
    );

    return createResponse({
      success: true,
      status: 'in_progress',
      job_id: job.id,
      batches_this_run: batchesProcessed,
      imported_this_run: totalImportedThisRun,
      progress: getProgress(job),
      should_continue: true,
      message: 'Processing continues in background',
    });

  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Error:`, error.message);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: FUNCTION_NAME,
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// =============================================================================
// HELPERS
// =============================================================================

async function saveCheckpoint(
  supabase: SupabaseClient,
  job: ImportJob,
  status: string
): Promise<void> {
  await supabase
    .from('email_import_jobs')
    .update({
      status,
      sent_imported: job.sent_imported,
      inbox_imported: job.inbox_imported,
      sent_page_token: job.sent_page_token,
      inbox_page_token: job.inbox_page_token,
      current_folder: job.current_folder,
      last_batch_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);
}

function getProgress(job: ImportJob): { sent: number; inbox: number; total: number; percent: number } {
  const total = job.sent_imported + job.inbox_imported;
  return {
    sent: job.sent_imported,
    inbox: job.inbox_imported,
    total,
    percent: Math.round((total / job.total_target) * 100),
  };
}

function createResponse(data: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify(data),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Handle graceful shutdown
addEventListener('beforeunload', (ev: any) => {
  console.log(`[${FUNCTION_NAME}] Shutdown:`, ev.detail?.reason);
});
