import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================================
// BULLETPROOF PIPELINE WATCHDOG - External safety net for email import/classify
// Runs every 2 minutes via pg_cron to resurrect stalled jobs
// 
// THREE-LAYER RELIABILITY:
// 1. Self-Invocation Relay (fast - every 30-60s)
// 2. pg_cron Watchdog (slow - every 2 minutes) <- THIS
// 3. Job State Machine (persistent)
// =============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'pipeline-watchdog';
const STALE_THRESHOLD_MS = 8 * 60 * 1000; // 8 minutes (increased from 5)
const LOCK_EXPIRY_MS = 3 * 60 * 1000; // 3 minutes

interface ResurrectionLog {
  workspace_id: string;
  function_name: string;
  reason: string;
  resurrected_at: string;
}

interface SkippedLog {
  workspace_id: string;
  job_id: string;
  reason: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const resurrections: ResurrectionLog[] = [];
  const skipped: SkippedLog[] = [];

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[${FUNCTION_NAME}] Starting bulletproof watchdog check...`);

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
    // 2. Auto-complete ghost classification jobs (total_to_classify = 0)
    // -------------------------------------------------------------------------
    const { data: ghostJobs, error: ghostError } = await supabase
      .from('classification_jobs')
      .update({ 
        status: 'failed', 
        completed_at: now.toISOString(),
        error_message: 'Auto-closed: ghost job with no emails to classify'
      })
      .eq('status', 'in_progress')
      .eq('total_to_classify', 0)
      .select('id, workspace_id');

    if (ghostError) {
      console.error(`[${FUNCTION_NAME}] Ghost job cleanup error:`, ghostError.message);
    } else if (ghostJobs && ghostJobs.length > 0) {
      console.log(`[${FUNCTION_NAME}] Auto-closed ${ghostJobs.length} ghost classification jobs`);
      for (const g of ghostJobs) {
        skipped.push({
          workspace_id: g.workspace_id,
          job_id: g.id,
          reason: 'Ghost job with total_to_classify=0'
        });
      }
    }

    // -------------------------------------------------------------------------
    // 3. Check for stalled import jobs
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
      
      await triggerFunction(supabaseUrl, 'email-import-v2', {
        workspace_id: job.workspace_id,
        job_id: job.id,
        _relay_depth: 0,
      }, supabaseServiceKey);

      resurrections.push({
        workspace_id: job.workspace_id,
        function_name: 'email-import-v2',
        reason: `Import job stalled in status: ${job.status}`,
        resurrected_at: now.toISOString(),
      });
    }

    // -------------------------------------------------------------------------
    // 4. Check for stalled classification jobs - ONLY ONE per workspace
    //    Skip ghost jobs (total_to_classify = 0)
    //    Group by workspace, resurrect only the most recent
    // -------------------------------------------------------------------------
    const { data: stalledClassifyJobs, error: classifyJobError } = await supabase
      .from('classification_jobs')
      .select('id, workspace_id, status, classified_count, total_to_classify, updated_at')
      .eq('status', 'in_progress')
      .gt('total_to_classify', 0) // Skip ghost jobs
      .lt('updated_at', staleThreshold)
      .order('updated_at', { ascending: false }); // Most recent first

    if (classifyJobError) {
      console.error(`[${FUNCTION_NAME}] Classification jobs query error:`, classifyJobError.message);
    }

    // Group by workspace - only resurrect ONE job per workspace (the most recent)
    type ClassifyJobRow = { id: string; workspace_id: string; status: string; classified_count: number; total_to_classify: number; updated_at: string };
    const workspaceClassifyJobs = new Map<string, ClassifyJobRow>();
    for (const job of (stalledClassifyJobs || []) as ClassifyJobRow[]) {
      if (!workspaceClassifyJobs.has(job.workspace_id)) {
        workspaceClassifyJobs.set(job.workspace_id, job);
      } else {
        // Mark older stalled jobs as failed to prevent future resurrection
        const { error: markError } = await supabase
          .from('classification_jobs')
          .update({ 
            status: 'failed', 
            completed_at: now.toISOString(),
            error_message: 'Superseded by newer classification job'
          })
          .eq('id', job.id);
        
        if (!markError) {
          skipped.push({
            workspace_id: job.workspace_id,
            job_id: job.id,
            reason: 'Superseded by newer job'
          });
        }
      }
    }

    // Resurrect ONE job per workspace
    for (const [workspace_id, job] of workspaceClassifyJobs) {
      console.warn(`[${FUNCTION_NAME}] RESURRECTING stalled classification job ${job.id} for workspace ${workspace_id} (${job.classified_count}/${job.total_to_classify})`);
      
      await triggerFunction(supabaseUrl, 'email-classify-v2', {
        workspace_id: job.workspace_id,
        job_id: job.id,
        _relay_depth: 0,
      }, supabaseServiceKey);

      resurrections.push({
        workspace_id: job.workspace_id,
        function_name: 'email-classify-v2',
        reason: `Classification job stalled at ${job.classified_count}/${job.total_to_classify}`,
        resurrected_at: now.toISOString(),
      });
    }

    // -------------------------------------------------------------------------
    // 5. Also check paused jobs and resume them (from graceful degradation)
    // -------------------------------------------------------------------------
    const pausedThreshold = new Date(now.getTime() - 30000).toISOString(); // 30 seconds
    const { data: pausedJobs, error: pausedError } = await supabase
      .from('classification_jobs')
      .select('id, workspace_id, classified_count, total_to_classify, updated_at')
      .eq('status', 'paused')
      .lt('updated_at', pausedThreshold);

    if (pausedError) {
      console.error(`[${FUNCTION_NAME}] Paused jobs query error:`, pausedError.message);
    }

    for (const job of pausedJobs || []) {
      // Skip if we already resurrected a job for this workspace
      if (resurrections.some(r => r.workspace_id === job.workspace_id && r.function_name === 'email-classify-v2')) {
        continue;
      }

      console.warn(`[${FUNCTION_NAME}] RESUMING paused classification job ${job.id} for workspace ${job.workspace_id}`);
      
      await triggerFunction(supabaseUrl, 'email-classify-v2', {
        workspace_id: job.workspace_id,
        job_id: job.id,
        _relay_depth: 0,
      }, supabaseServiceKey);

      resurrections.push({
        workspace_id: job.workspace_id,
        function_name: 'email-classify-v2',
        reason: `Resuming paused job at ${job.classified_count}/${job.total_to_classify}`,
        resurrected_at: now.toISOString(),
      });
    }

    // -------------------------------------------------------------------------
    // 6. Fallback: Check email_import_progress for 'classifying' phase (legacy)
    // -------------------------------------------------------------------------
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
      
      console.warn(`[${FUNCTION_NAME}] RESURRECTING stalled classification progress for workspace ${p.workspace_id} (fallback)`);
      
      await triggerFunction(supabaseUrl, 'email-classify-v2', {
        workspace_id: p.workspace_id,
        _relay_depth: 0,
      }, supabaseServiceKey);

      resurrections.push({
        workspace_id: p.workspace_id,
        function_name: 'email-classify-v2',
        reason: `Classification phase stalled at ${p.emails_classified || 0}/${p.emails_received || 0} (fallback)`,
        resurrected_at: now.toISOString(),
      });
    }

    // -------------------------------------------------------------------------
    // 7. Check for stalled learning phase
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
    // 8. Log summary
    // -------------------------------------------------------------------------
    if (resurrections.length > 0) {
      console.warn(`[WATCHDOG] Resurrected ${resurrections.length} stalled jobs:`, 
        JSON.stringify(resurrections.map(r => `${r.function_name}@${r.workspace_id}`)));
    }

    if (skipped.length > 0) {
      console.log(`[WATCHDOG] Skipped/cleaned ${skipped.length} ghost/duplicate jobs:`,
        JSON.stringify(skipped.map(s => `${s.job_id}: ${s.reason}`)));
    }

    const duration = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Completed in ${duration}ms. Resurrected: ${resurrections.length}, Skipped: ${skipped.length}, Locks cleaned: ${deletedLocks?.length || 0}`);

    return new Response(
      JSON.stringify({
        success: true,
        checked_at: now.toISOString(),
        stalled_imports: stalledImportJobs?.length || 0,
        stalled_classify_jobs: workspaceClassifyJobs.size,
        stalled_classify_progress: stalledClassifyProgress?.length || 0,
        paused_jobs_resumed: pausedJobs?.length || 0,
        stalled_learning: stalledLearningProgress?.length || 0,
        resurrected: resurrections.length,
        skipped: skipped.length,
        ghost_jobs_cleaned: ghostJobs?.length || 0,
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
