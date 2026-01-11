import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================================
// ROBUST EMAIL CLASSIFICATION WITH RATE LIMITING & FRONTEND-DRIVEN CONTINUATION
// Handles 30,000+ emails with Gemini rate limit management
// =============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'email-classify-v2';
const BATCH_SIZE = 30; // Smaller batches to avoid token limits
const TIMEOUT_BUFFER_MS = 50000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;

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
    const { workspace_id, job_id } = body;

    if (!workspace_id) {
      throw new Error('workspace_id is required');
    }

    console.log(`[${FUNCTION_NAME}] Starting:`, { workspace_id, job_id });

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
      // Count unclassified emails in queue
      const { count } = await supabase
        .from('email_import_queue')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace_id)
        .eq('status', 'pending');

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
        .eq('status', 'pending')
        .order('received_at', { ascending: false })
        .limit(BATCH_SIZE);

      // Use cursor for efficient pagination
      if (job.last_processed_id) {
        query = query.lt('id', job.last_processed_id);
      }

      const { data: emails, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      if (!emails || emails.length === 0) {
        // All emails classified
        console.log(`[${FUNCTION_NAME}] No more emails to classify`);
        break;
      }

      console.log(`[${FUNCTION_NAME}] Processing batch of ${emails.length} emails`);

      // Build Gemini prompt
      const emailSummaries = emails.map((e: any, i: number) =>
        `[${i}] From: ${e.from_email} | Subject: ${e.subject || '(no subject)'} | Direction: ${e.direction || 'unknown'}\nBody: ${(e.body || '').substring(0, 150)}...`
      ).join('\n\n---\n\n');

      const prompt = `Classify each email. Categories: inquiry, booking, quote, complaint, follow_up, spam, notification, personal.

Return JSON array ONLY:
[{"index":0,"category":"inquiry","confidence":0.95,"requires_reply":true,"reasoning":"..."}]

EMAILS:
${emailSummaries}`;

      // Call Gemini with retries
      let classifications: any[] | null = null;
      let retryCount = 0;

      while (retryCount < MAX_RETRIES && !classifications) {
        try {
          const response = await fetch(`${GEMINI_API}?key=${googleApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
            })
          });

          if (response.status === 429) {
            const errorText = await response.text();
            rateLimitDelay = parseRetryDelay(errorText) || getBackoffDelay(retryCount);
            
            console.log(`[${FUNCTION_NAME}] Rate limited, delay needed: ${rateLimitDelay}ms`);
            
            // Check if we have time to wait
            if (!shouldContinueProcessing(startTime)) {
              console.log(`[${FUNCTION_NAME}] No time for retry, saving checkpoint`);
              await saveCheckpoint(supabase, job);
              
              return createResponse({
                success: true,
                status: 'rate_limited',
                job_id: job.id,
                classified_this_run: classifiedThisRun,
                message: 'Rate limited, please continue after delay',
                should_continue: true,
                continue_after_ms: rateLimitDelay,
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

          // Parse JSON from response
          const jsonMatch = responseText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            classifications = JSON.parse(jsonMatch[0]);
            consecutiveFailures = 0;
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
        console.warn(`[${FUNCTION_NAME}] Skipping batch after ${MAX_RETRIES} retries`);
        job.last_processed_id = emails[emails.length - 1].id;
        continue;
      }

      // Update emails with classifications
      for (const c of classifications) {
        const email = emails[c.index];
        if (!email) continue;

        const { error: updateError } = await supabase
          .from('email_import_queue')
          .update({
            status: 'classified',
          })
          .eq('id', email.id);

        if (!updateError) {
          classifiedThisRun++;
          job.classified_count++;
        }
      }

      // Update checkpoint
      job.last_processed_id = emails[emails.length - 1].id;
      await saveCheckpoint(supabase, job);
      batchesProcessed++;

      console.log(`[${FUNCTION_NAME}] Batch ${batchesProcessed}: +${classifications.length}, total: ${job.classified_count}`);
    }

    // -------------------------------------------------------------------------
    // Check if Complete or Need Continuation
    // -------------------------------------------------------------------------
    const { count: remaining } = await supabase
      .from('email_import_queue')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
      .eq('status', 'pending');

    const isComplete = !remaining || remaining === 0;

    if (isComplete) {
      await supabase
        .from('classification_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      return createResponse({
        success: true,
        status: 'completed',
        job_id: job.id,
        total_classified: job.classified_count,
        duration_ms: Date.now() - startTime,
        should_continue: false,
      });
    }

    // More work to do - frontend should call again
    await saveCheckpoint(supabase, job);

    return createResponse({
      success: true,
      status: 'in_progress',
      job_id: job.id,
      batches_this_run: batchesProcessed,
      classified_this_run: classifiedThisRun,
      remaining,
      should_continue: true,
      continue_after_ms: rateLimitDelay || 2000, // Frontend should wait before next call
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

function createResponse(data: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify(data),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
