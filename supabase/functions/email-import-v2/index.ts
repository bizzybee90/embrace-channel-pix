import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chainNextBatch } from '../_shared/batch-processor.ts';

// =============================================================================
// ROBUST EMAIL IMPORT WITH RELAY RACE SELF-INVOCATION
// Handles 30,000+ emails autonomously without frontend polling
// =============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AURINKO_API_BASE = 'https://api.aurinko.io/v1';
const FUNCTION_NAME = 'email-import-v2';
const BATCH_SIZE = 100; // Increased for efficiency
const TIMEOUT_BUFFER_MS = 50000; // Stop 10s before 60s timeout
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_RELAY_DEPTH = 500; // Safety: max 50,000 emails (500 × 100)

interface ImportJob {
  id: string;
  workspace_id: string;
  config_id: string;
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
    const { workspace_id, job_id, import_mode = 'full', _relay_depth = 0 } = body;

    if (!workspace_id) {
      throw new Error('workspace_id is required');
    }

    // Safety check: prevent infinite loops
    if (_relay_depth >= MAX_RELAY_DEPTH) {
      console.error(`[${FUNCTION_NAME}] MAX_RELAY_DEPTH (${MAX_RELAY_DEPTH}) exceeded, stopping`);
      await supabase
        .from('email_import_progress')
        .upsert({
          workspace_id,
          current_phase: 'error',
          last_error: 'Max relay depth exceeded - possible infinite loop',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id' });
      return createResponse({ success: false, error: 'Max relay depth exceeded' });
    }

    console.log(`[${FUNCTION_NAME}] Starting: relay_depth=${_relay_depth}`, { workspace_id, job_id, import_mode });

    // -------------------------------------------------------------------------
    // Get Email Provider Config
    // -------------------------------------------------------------------------
    const { data: emailConfig, error: configError } = await supabase
      .from('email_provider_configs')
      .select('id, email_address')
      .eq('workspace_id', workspace_id)
      .single();

    if (configError || !emailConfig) {
      throw new Error('Email not connected. Please connect your email account first.');
    }

    // Get decrypted access token securely
    const { data: accessToken, error: tokenError } = await supabase
      .rpc('get_decrypted_access_token', { p_workspace_id: workspace_id });

    if (tokenError || !accessToken) {
      throw new Error('Email access token is missing. Please reconnect your email account.');
    }

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
          config_id: emailConfig.id,
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
      
      let response: Response | undefined;
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
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) break;

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : getBackoffDelay(retryCount);
          console.log(`[${FUNCTION_NAME}] Rate limited, waiting ${delay}ms`);
          
          // If delay would exceed timeout, save checkpoint and self-invoke
          if (!shouldContinueProcessing(startTime)) {
            await saveCheckpoint(supabase, job, 'in_progress');
            await updateProgress(supabase, workspace_id, 'importing', job.sent_imported + job.inbox_imported);
            
            console.log(`[${FUNCTION_NAME}] Timeout approaching, self-invoking with delay ${delay}ms`);
            
            // Wait a bit then self-invoke
            setTimeout(() => {
              chainNextBatch(supabaseUrl, FUNCTION_NAME, {
                workspace_id,
                job_id: job.id,
                import_mode,
                _relay_depth: _relay_depth + 1,
              }, supabaseServiceKey);
            }, Math.min(delay, 5000)); // Cap at 5s for the setTimeout
            
            return createResponse({
              success: true,
              status: 'continuing',
              job_id: job.id,
              message: 'Rate limited, continuing after delay',
              progress: getProgress(job),
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

      if (!response) {
        throw new Error('Failed to fetch emails after retries');
      }

      // Parse response
      const data = await response.json();
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

      // Transform and save emails to queue
      const emailsToSave = messages.map((msg: any) => ({
        workspace_id,
        config_id: emailConfig.id,
        external_id: msg.id,
        thread_id: msg.threadId,
        from_email: msg.from?.address || '',
        from_name: msg.from?.name || null,
        to_emails: msg.to?.map((t: any) => t.address) || [],
        subject: msg.subject || '',
        body: msg.textBody || msg.bodySnippet || '',
        body_html: msg.htmlBody || null,
        received_at: msg.receivedAt || msg.createdAt,
        direction: folder === 'SENT' ? 'outbound' : 'inbound',
        status: 'pending',
        has_body: !!(msg.textBody || msg.bodySnippet),
      }));

      const { error: insertError, data: insertedData } = await supabase
        .from('email_import_queue')
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

      // Update progress for frontend UI
      await updateProgress(supabase, workspace_id, 'importing', job.sent_imported + job.inbox_imported);

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
                      (job.inbox_imported >= targetPerFolder && job.sent_imported >= targetPerFolder) ||
                      (!job.inbox_page_token && !job.sent_page_token && job.current_folder === 'INBOX');

    if (isComplete) {
      // =========================================================================
      // IMPORT COMPLETE - Chain to email-classify-v2
      // =========================================================================
      await supabase
        .from('email_import_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      // Update progress phase
      await updateProgress(supabase, workspace_id, 'classifying', totalImported);

      console.log(`[${FUNCTION_NAME}] Import complete (${totalImported} emails), chaining to email-classify-v2`);

      // Chain to classification
      chainNextBatch(supabaseUrl, 'email-classify-v2', {
        workspace_id,
        _relay_depth: 0, // Reset depth for new phase
      }, supabaseServiceKey);

      return createResponse({
        success: true,
        status: 'completed',
        job_id: job.id,
        total_imported: totalImported,
        sent_count: job.sent_imported,
        inbox_count: job.inbox_imported,
        duration_ms: Date.now() - startTime,
        chained_to: 'email-classify-v2',
      });
    }

    // -------------------------------------------------------------------------
    // More work to do - SELF INVOKE (Relay Race)
    // -------------------------------------------------------------------------
    await saveCheckpoint(supabase, job, 'in_progress');
    await updateProgress(supabase, workspace_id, 'importing', totalImported);

    console.log(`[${FUNCTION_NAME}] Self-invoking: depth=${_relay_depth + 1}, progress=${totalImported}/${job.total_target}`);

    // Fire and forget - self invoke
    chainNextBatch(supabaseUrl, FUNCTION_NAME, {
      workspace_id,
      job_id: job.id,
      import_mode,
      _relay_depth: _relay_depth + 1,
    }, supabaseServiceKey);

    return createResponse({
      success: true,
      status: 'continuing',
      job_id: job.id,
      batches_this_run: batchesProcessed,
      imported_this_run: totalImportedThisRun,
      progress: getProgress(job),
      relay_depth: _relay_depth,
    });

  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Error:`, error.message);
    
    // Update progress with error
    try {
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const body = await req.clone().json().catch(() => ({}));
      if (body.workspace_id) {
        await supabase
          .from('email_import_progress')
          .upsert({
            workspace_id: body.workspace_id,
            current_phase: 'error',
            last_error: error.message,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'workspace_id' });
      }
    } catch (e) {
      // Ignore error logging errors
    }
    
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

async function updateProgress(
  supabase: SupabaseClient,
  workspace_id: string,
  phase: string,
  emails_received: number
): Promise<void> {
  await supabase
    .from('email_import_progress')
    .upsert({
      workspace_id,
      current_phase: phase,
      emails_received,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id' });
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