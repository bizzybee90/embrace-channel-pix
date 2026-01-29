import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chainNextBatch } from '../_shared/batch-processor.ts';

// =============================================================================
// ROBUST EMAIL CLASSIFICATION WITH RELAY RACE SELF-INVOCATION + WORKER LOCKS
// Handles 30,000+ emails autonomously with mega-batching
// Features: Single-worker enforcement, rate limit handling, adaptive backoff
// =============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'email-classify-v2';
const DB_BATCH_SIZE = 500; // Fetch from DB at once
const LLM_BATCH_SIZE = 100; // Send to Gemini at once (prevents malformed responses)
const TIMEOUT_BUFFER_MS = 50000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;
const MAX_RELAY_DEPTH = 100; // Safety: max 200,000 emails (100 × 2000)
const LOCK_FUNCTION_NAME = 'email-classify-v2';

// NOTE:
// - v2 import pipeline writes into `email_import_queue` with statuses like: scanned → queued_for_fetch → fetched → processed.
// - In this project, scanned rows already contain `body` + `has_body=true`, so classification should run against `scanned`.
// - Avoid relying on `setTimeout` inside edge runtimes; do backoff by self-invoking with `_sleep_ms`.

// Use Gemini 2.0 Flash for speed
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

interface ClassifyJob {
  id: string;
  workspace_id: string;
  status: string;
  total_to_classify: number;
  classified_count: number;
  failed_count: number;
  last_processed_id: string | null;
  retry_count: number;
}

// =============================================================================
// UTILITIES
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getBackoffDelay(attempt: number): number {
  const exponentialDelay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 2000;
  return Math.min(exponentialDelay + jitter, MAX_DELAY_MS);
}

function shouldContinueProcessing(startTime: number): boolean {
  return Date.now() - startTime < TIMEOUT_BUFFER_MS;
}

function parseRetryDelay(errorText: string): number | null {
  const match = errorText.match(/retry in ([\d.]+)s/i);
  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1000);
  }
  return null;
}

// =============================================================================
// WORKER LOCK FUNCTIONS - Prevent thundering herd
// =============================================================================

async function acquireLock(
  supabase: SupabaseClient,
  workspace_id: string,
  function_name: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('pipeline_locks')
      .insert({
        workspace_id,
        function_name,
        locked_at: new Date().toISOString(),
        locked_by: `${function_name}-${Date.now()}`,
      });

    if (error) {
      if (error.code === '23505') {
        console.log(`[${FUNCTION_NAME}] Lock already held for workspace ${workspace_id}`);
        return false;
      }
      console.error(`[${FUNCTION_NAME}] Lock acquisition error:`, error.message);
      return false;
    }

    console.log(`[${FUNCTION_NAME}] Acquired lock for workspace ${workspace_id}`);
    return true;
  } catch (e) {
    console.error(`[${FUNCTION_NAME}] Lock acquisition exception:`, e);
    return false;
  }
}

async function releaseLock(
  supabase: SupabaseClient,
  workspace_id: string,
  function_name: string
): Promise<void> {
  try {
    await supabase
      .from('pipeline_locks')
      .delete()
      .eq('workspace_id', workspace_id)
      .eq('function_name', function_name);
    
    console.log(`[${FUNCTION_NAME}] Released lock for workspace ${workspace_id}`);
  } catch (e) {
    console.error(`[${FUNCTION_NAME}] Lock release error:`, e);
  }
}

async function refreshLock(
  supabase: SupabaseClient,
  workspace_id: string,
  function_name: string
): Promise<void> {
  try {
    await supabase
      .from('pipeline_locks')
      .update({ locked_at: new Date().toISOString() })
      .eq('workspace_id', workspace_id)
      .eq('function_name', function_name);
  } catch (e) {
    console.warn(`[${FUNCTION_NAME}] Lock refresh failed:`, e);
  }
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
    const googleApiKey = Deno.env.get('GOOGLE_API_KEY');

    if (!googleApiKey) {
      throw new Error('GOOGLE_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { workspace_id, job_id, _relay_depth = 0, _sleep_ms = 0 } = body;

    if (!workspace_id) {
      throw new Error('workspace_id is required');
    }

    // -------------------------------------------------------------------------
    // Acquire Worker Lock - Only ONE classify worker per workspace
    // -------------------------------------------------------------------------
    const lockAcquired = await acquireLock(supabase, workspace_id, LOCK_FUNCTION_NAME);
    if (!lockAcquired) {
      console.log(`[${FUNCTION_NAME}] Another worker is already processing this workspace, exiting`);
      return createResponse({
        success: true,
        status: 'skipped',
        reason: 'Another worker is already processing this workspace',
      });
    }

    // Optional backoff sleep used for self-invoked retries (e.g., rate limit handling)
    if (typeof _sleep_ms === 'number' && _sleep_ms > 0) {
      const ms = Math.min(Math.max(_sleep_ms, 0), 60000);
      console.log(`[${FUNCTION_NAME}] Backoff sleep ${ms}ms before continuing`);
      await sleep(ms);
    }

    // Safety check: prevent infinite loops
    if (_relay_depth >= MAX_RELAY_DEPTH) {
      console.error(`[${FUNCTION_NAME}] MAX_RELAY_DEPTH (${MAX_RELAY_DEPTH}) exceeded, stopping`);
      await releaseLock(supabase, workspace_id, LOCK_FUNCTION_NAME);
      await supabase
        .from('email_import_progress')
        .upsert({
          workspace_id,
          current_phase: 'error',
          last_error: 'Max relay depth exceeded during classification',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id' });
      return createResponse({ success: false, error: 'Max relay depth exceeded' });
    }

    console.log(`[${FUNCTION_NAME}] Starting: relay_depth=${_relay_depth}`, { workspace_id, job_id });

    // -------------------------------------------------------------------------
    // Get or Create Classification Job
    // -------------------------------------------------------------------------
    let job: ClassifyJob;

    if (job_id) {
      const { data, error } = await supabase
        .from('classification_jobs')
        .select('*')
        .eq('id', job_id)
        .single();

      if (error || !data) {
        throw new Error(`Job ${job_id} not found`);
      }
      job = data as ClassifyJob;
    } else {
      // Count unclassified emails in queue (status='scanned' from v2 import)
      const { count } = await supabase
        .from('email_import_queue')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace_id)
        .eq('status', 'scanned');

      const { data, error } = await supabase
        .from('classification_jobs')
        .insert({
          workspace_id,
          status: 'in_progress',
          total_to_classify: count || 0,
          classified_count: 0,
          failed_count: 0,
          last_processed_id: null,
          retry_count: 0,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      job = data as ClassifyJob;
    }

    // Update job status
    await supabase
      .from('classification_jobs')
      .update({ status: 'in_progress' })
      .eq('id', job.id);

    // -------------------------------------------------------------------------
    // Process Batches Until Timeout
    // -------------------------------------------------------------------------
    let batchesProcessed = 0;
    let classifiedThisRun = 0;
    let consecutiveFailures = 0;
    let rateLimitDelay = 0;

    while (shouldContinueProcessing(startTime) && consecutiveFailures < MAX_RETRIES) {
      // Fetch next batch of unclassified emails from queue
      let query = supabase
        .from('email_import_queue')
        .select('id, from_email, from_name, subject, body, direction')
        .eq('workspace_id', workspace_id)
        .eq('status', 'scanned')
        .eq('has_body', true)
        .order('id', { ascending: false })
        .limit(DB_BATCH_SIZE);

      if (job.last_processed_id) {
        query = query.lt('id', job.last_processed_id);
      }

      const { data: emails, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      if (!emails || emails.length === 0) {
        console.log(`[${FUNCTION_NAME}] No more emails to classify`);
        break;
      }

      console.log(`[${FUNCTION_NAME}] Fetched ${emails.length} emails, processing in sub-batches of ${LLM_BATCH_SIZE}`);

      // Process emails in smaller sub-batches for LLM reliability
      for (let subBatchStart = 0; subBatchStart < emails.length; subBatchStart += LLM_BATCH_SIZE) {
        if (!shouldContinueProcessing(startTime)) break;

        const subBatch = emails.slice(subBatchStart, subBatchStart + LLM_BATCH_SIZE);
        
        // Build optimized Gemini prompt
        const emailSummaries = subBatch.map((e: any, i: number) =>
          `${i}|${e.from_email}|${e.subject || '(none)'}|${(e.body || '').substring(0, 150).replace(/\n/g, ' ')}`
        ).join('\n');

        const prompt = `Classify each email. Categories: inquiry, booking, quote, complaint, follow_up, spam, notification, personal.

Return ONLY a JSON array. Format: [{"i":0,"c":"inquiry","r":true}]
Where: i=index (number), c=category (string), r=requires_reply (boolean)

Important: Return valid JSON only, no markdown, no explanation.

EMAILS (format: index|from|subject|snippet):
${emailSummaries}`;

        // Call Gemini with retries
        let classifications: any[] | null = null;
        let retryCount = 0;
        let useTemperatureZero = false;

        while (retryCount < MAX_RETRIES && !classifications) {
          try {
            const response = await fetch(`${GEMINI_API}?key=${googleApiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { 
                  temperature: useTemperatureZero ? 0.0 : 0.1, 
                  maxOutputTokens: 4096 
                }
              })
            });

            if (response.status === 429) {
              const errorText = await response.text();
              rateLimitDelay = parseRetryDelay(errorText) || getBackoffDelay(retryCount);
              
              console.log(`[${FUNCTION_NAME}] Rate limited, delay: ${rateLimitDelay}ms`);
              
              if (!shouldContinueProcessing(startTime)) {
                await saveCheckpoint(supabase, job);
                await updateProgress(supabase, workspace_id, 'classifying', job.classified_count);
                await releaseLock(supabase, workspace_id, LOCK_FUNCTION_NAME);
                
                chainNextBatch(supabaseUrl, FUNCTION_NAME, {
                  workspace_id,
                  job_id: job.id,
                  _relay_depth: _relay_depth + 1,
                  _sleep_ms: rateLimitDelay,
                }, supabaseServiceKey);
                  
                return createResponse({
                  success: true,
                  status: 'rate_limited',
                  job_id: job.id,
                  classified_this_run: classifiedThisRun,
                  message: 'Rate limited, continuing after delay',
                });
              }
              
              await sleep(rateLimitDelay);
              retryCount++;
              continue;
            }

            if (!response.ok) {
              throw new Error(`Gemini API error: ${response.status}`);
            }

            const geminiData = await response.json();
            const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              try {
                classifications = JSON.parse(jsonMatch[0]);
                consecutiveFailures = 0;
              } catch (parseErr) {
                if (!useTemperatureZero) {
                  console.log(`[${FUNCTION_NAME}] JSON parse failed, retrying with temperature=0`);
                  useTemperatureZero = true;
                  retryCount++;
                  continue;
                }
                throw parseErr;
              }
            } else {
              throw new Error('No JSON array in Gemini response');
            }
          } catch (error: any) {
            console.error(`[${FUNCTION_NAME}] Gemini error (attempt ${retryCount + 1}):`, error.message);
            retryCount++;
            
            if (retryCount >= MAX_RETRIES) {
              consecutiveFailures++;
              break;
            }
            
            await sleep(getBackoffDelay(retryCount));
          }
        }

        if (!classifications) {
          console.warn(`[${FUNCTION_NAME}] Skipping sub-batch after ${MAX_RETRIES} retries`);
          continue;
        }

        // Update emails with classifications
        for (const c of classifications) {
          const index = c.index ?? c.i;
          const email = subBatch[index];
          if (!email) continue;

          const { error: updateError } = await supabase
            .from('email_import_queue')
            .update({
              status: 'processed',
              processed_at: new Date().toISOString(),
            })
            .eq('id', email.id);

          if (!updateError) {
            classifiedThisRun++;
            job.classified_count++;
          }
        }

        // Refresh lock periodically
        await refreshLock(supabase, workspace_id, LOCK_FUNCTION_NAME);
      }

      // Update checkpoint after processing all sub-batches
      job.last_processed_id = emails[emails.length - 1].id;
      await saveCheckpoint(supabase, job);
      await updateProgress(supabase, workspace_id, 'classifying', job.classified_count);
      batchesProcessed++;

      console.log(`[${FUNCTION_NAME}] Batch ${batchesProcessed}: +${classifiedThisRun}, total: ${job.classified_count}`);
    }

    // -------------------------------------------------------------------------
    // Check if Complete or Need Continuation
    // -------------------------------------------------------------------------
    const { count: remaining } = await supabase
      .from('email_import_queue')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
      .eq('status', 'scanned');

    const isComplete = !remaining || remaining === 0;

    if (isComplete) {
      // =========================================================================
      // CLASSIFICATION COMPLETE - Chain to voice-learn
      // =========================================================================
      await supabase
        .from('classification_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      // Update progress phase
      await updateProgress(supabase, workspace_id, 'learning', job.classified_count);

      // Release lock before chaining
      await releaseLock(supabase, workspace_id, LOCK_FUNCTION_NAME);

      console.log(`[${FUNCTION_NAME}] Classification complete (${job.classified_count}), chaining to voice-learn`);

      // Chain to voice learning
      chainNextBatch(supabaseUrl, 'voice-learn', {
        workspace_id,
      }, supabaseServiceKey);

      return createResponse({
        success: true,
        status: 'completed',
        job_id: job.id,
        total_classified: job.classified_count,
        duration_ms: Date.now() - startTime,
        chained_to: 'voice-learn',
      });
    }

    // -------------------------------------------------------------------------
    // More work to do - SELF INVOKE (Relay Race)
    // -------------------------------------------------------------------------
    await saveCheckpoint(supabase, job);
    await updateProgress(supabase, workspace_id, 'classifying', job.classified_count);

    // Release lock before self-invoking (next invocation will acquire its own)
    await releaseLock(supabase, workspace_id, LOCK_FUNCTION_NAME);

    console.log(`[${FUNCTION_NAME}] Self-invoking: depth=${_relay_depth + 1}, remaining=${remaining}`);

    // Fire and forget - self invoke
    chainNextBatch(supabaseUrl, FUNCTION_NAME, {
      workspace_id,
      job_id: job.id,
      _relay_depth: _relay_depth + 1,
    }, supabaseServiceKey);

    return createResponse({
      success: true,
      status: 'continuing',
      job_id: job.id,
      batches_this_run: batchesProcessed,
      classified_this_run: classifiedThisRun,
      remaining,
      relay_depth: _relay_depth,
    });

  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Error:`, error.message);

    // Update progress with error and release lock
    try {
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const body = await req.clone().json().catch(() => ({}));
      if (body.workspace_id) {
        // Release lock on error
        await releaseLock(supabase, body.workspace_id, LOCK_FUNCTION_NAME);
        
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

async function saveCheckpoint(supabase: SupabaseClient, job: ClassifyJob): Promise<void> {
  await supabase
    .from('classification_jobs')
    .update({
      classified_count: job.classified_count,
      last_processed_id: job.last_processed_id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);
}

async function updateProgress(
  supabase: SupabaseClient,
  workspace_id: string,
  phase: string,
  emails_classified: number
): Promise<void> {
  await supabase
    .from('email_import_progress')
    .upsert({
      workspace_id,
      current_phase: phase,
      emails_classified,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id' });
}

function createResponse(data: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify(data),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}