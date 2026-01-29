import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================================
// PIPELINE WATCHDOG - External safety net for email import/classify pipeline
// Runs every 2 minutes via pg_cron to resurrect stalled jobs
// =============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'pipeline-watchdog';
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const LOCK_EXPIRY_MS = 3 * 60 * 1000; // 3 minutes

interface ResurrectionLog {
  workspace_id: string;
  function_name: string;
  reason: string;
  resurrected_at: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const resurrections: ResurrectionLog[] = [];

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[${FUNCTION_NAME}] Starting watchdog check...`);

    const now = new Date();
    const staleThreshold = new Date(now.getTime() - STALE_THRESHOLD_MS).toISOString();
    const lockExpiry = new Date(now.getTime() - LOCK_EXPIRY_MS).toISOString();

    // -------------------------------------------------------------------------
    // 1. Clean up stale locks (older than 3 minutes)
    // -------------------------------------------------------------------------
    const { data: deletedLocks, error: lockCleanupError } = await supabase
      .from('pipeline_locks')
      .delete()
      .lt('locked_at', lockExpiry)
      .select('workspace_id, function_name');

    if (lockCleanupError) {
      console.error(`[${FUNCTION_NAME}] Lock cleanup error:`, lockCleanupError.message);
    } else if (deletedLocks && deletedLocks.length > 0) {
      console.log(`[${FUNCTION_NAME}] Cleaned up ${deletedLocks.length} stale locks`);
    }

    // -------------------------------------------------------------------------
    // 2. Check for stalled import jobs
    // -------------------------------------------------------------------------
    const { data: stalledImportJobs, error: importJobError } = await supabase
      .from('email_import_jobs')
      .select('id, workspace_id, status, updated_at, last_batch_at')
      .in('status', ['queued', 'scanning_sent', 'scanning_inbox', 'importing'])
      .lt('updated_at', staleThreshold);

    if (importJobError) {
      console.error(`[${FUNCTION_NAME}] Import jobs query error:`, importJobError.message);
    }

    for (const job of stalledImportJobs || []) {
      console.warn(`[${FUNCTION_NAME}] RESURRECTING stalled import job ${job.id} for workspace ${job.workspace_id}`);
      
      // Trigger email-import-v2 to resume
      await triggerFunction(supabaseUrl, 'email-import-v2', {
        workspace_id: job.workspace_id,
        job_id: job.id,
        _relay_depth: 0, // Reset depth on resurrection
      }, supabaseServiceKey);

      resurrections.push({
        workspace_id: job.workspace_id,
        function_name: 'email-import-v2',
        reason: `Import job stalled in status: ${job.status}`,
        resurrected_at: now.toISOString(),
      });
    }

    // -------------------------------------------------------------------------
    // 3. Check for stalled classification jobs (direct table check)
    // This catches cases where phase hasn't been updated to 'classifying' yet
    // -------------------------------------------------------------------------
    const { data: stalledClassifyJobs, error: classifyJobError } = await supabase
      .from('classification_jobs')
      .select('id, workspace_id, status, classified_count, total_to_classify, updated_at')
      .eq('status', 'in_progress')
      .lt('updated_at', staleThreshold);

    if (classifyJobError) {
      console.error(`[${FUNCTION_NAME}] Classification jobs query error:`, classifyJobError.message);
    }

    for (const job of stalledClassifyJobs || []) {
      console.warn(`[${FUNCTION_NAME}] RESURRECTING stalled classification job ${job.id} for workspace ${job.workspace_id}`);
      
      await triggerFunction(supabaseUrl, 'email-classify-v2', {
        workspace_id: job.workspace_id,
        job_id: job.id,
        _relay_depth: 0,
      }, supabaseServiceKey);

      resurrections.push({
        workspace_id: job.workspace_id,
        function_name: 'email-classify-v2',
        reason: `Classification job stalled at ${job.classified_count || 0}/${job.total_to_classify || 0}`,
        resurrected_at: now.toISOString(),
      });
    }

    // Also check email_import_progress for 'classifying' phase (legacy fallback)
    const { data: stalledClassifyProgress, error: classifyError } = await supabase
      .from('email_import_progress')
      .select('workspace_id, current_phase, updated_at, emails_received, emails_classified')
      .eq('current_phase', 'classifying')
      .lt('updated_at', staleThreshold);

    if (classifyError) {
      console.error(`[${FUNCTION_NAME}] Classification progress query error:`, classifyError.message);
    }

    for (const p of stalledClassifyProgress || []) {
      // Skip if we already resurrected via job table
      if (resurrections.some(r => r.workspace_id === p.workspace_id && r.function_name === 'email-classify-v2')) {
        continue;
      }
      
      console.warn(`[${FUNCTION_NAME}] RESURRECTING stalled classification progress for workspace ${p.workspace_id}`);
      
      await triggerFunction(supabaseUrl, 'email-classify-v2', {
        workspace_id: p.workspace_id,
        _relay_depth: 0,
      }, supabaseServiceKey);

      resurrections.push({
        workspace_id: p.workspace_id,
        function_name: 'email-classify-v2',
        reason: `Classification phase stalled at ${p.emails_classified || 0}/${p.emails_received || 0}`,
        resurrected_at: now.toISOString(),
      });
    }

    // -------------------------------------------------------------------------
    // 4. Check for stalled learning phase
    // -------------------------------------------------------------------------
    const { data: stalledLearningProgress, error: learningError } = await supabase
      .from('email_import_progress')
      .select('workspace_id, current_phase, updated_at')
      .eq('current_phase', 'learning')
      .lt('updated_at', staleThreshold);

    if (learningError) {
      console.error(`[${FUNCTION_NAME}] Learning progress query error:`, learningError.message);
    }

    for (const p of stalledLearningProgress || []) {
      console.warn(`[${FUNCTION_NAME}] RESURRECTING stalled learning for workspace ${p.workspace_id}`);
      
      await triggerFunction(supabaseUrl, 'voice-learning', {
        workspace_id: p.workspace_id,
      }, supabaseServiceKey);

      resurrections.push({
        workspace_id: p.workspace_id,
        function_name: 'voice-learning',
        reason: 'Learning phase stalled',
        resurrected_at: now.toISOString(),
      });
    }

    // -------------------------------------------------------------------------
    // 5. Log resurrections if any occurred
    // -------------------------------------------------------------------------
    if (resurrections.length > 0) {
      console.warn(`[WATCHDOG] Resurrected ${resurrections.length} stalled jobs:`, 
        JSON.stringify(resurrections.map(r => `${r.function_name}@${r.workspace_id}`)));

      // Optional: Insert into an alerts/logs table for UI visibility
      // await supabase.from('pipeline_alerts').insert(resurrections);
    }

    const duration = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Completed in ${duration}ms. Resurrected: ${resurrections.length}, Locks cleaned: ${deletedLocks?.length || 0}`);

    return new Response(
      JSON.stringify({
        success: true,
        checked_at: now.toISOString(),
        stalled_imports: stalledImportJobs?.length || 0,
        stalled_classify_jobs: stalledClassifyJobs?.length || 0,
        stalled_classify_progress: stalledClassifyProgress?.length || 0,
        stalled_learning: stalledLearningProgress?.length || 0,
        resurrected: resurrections.length,
        locks_cleaned: deletedLocks?.length || 0,
        duration_ms: duration,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Fatal error:`, error.message);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// =============================================================================
// HELPERS
// =============================================================================

async function triggerFunction(
  supabaseUrl: string,
  functionName: string,
  payload: Record<string, unknown>,
  serviceRoleKey: string
): Promise<void> {
  try {
    // Fire and forget
    fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).catch(err => {
      console.error(`[triggerFunction] Failed to trigger ${functionName}:`, err);
    });
  } catch (error) {
    console.error(`[triggerFunction] Error triggering ${functionName}:`, error);
  }
}
