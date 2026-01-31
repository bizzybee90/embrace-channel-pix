import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Jobs are considered stale if no heartbeat in 10 minutes (increased from 5)
const STALE_THRESHOLD_MS = 10 * 60 * 1000;
const MAX_RETRIES = 2; // Reduced from 3 to prevent excessive restarts

// Terminal statuses that should NEVER be restarted
const TERMINAL_STATUSES = ['completed', 'cancelled', 'failed', 'error', 'review_ready'];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    console.log('[research-watchdog] Starting watchdog check...');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

    // Find stale jobs (active but no heartbeat)
    // CRITICAL: Only query NON-TERMINAL statuses
    const { data: staleJobs, error } = await supabase
      .from('competitor_research_jobs')
      .select('*')
      .in('status', ['discovering', 'validating', 'scraping', 'extracting', 'deduplicating', 'refining', 'embedding', 'generating'])
      .lt('heartbeat_at', staleThreshold);

    if (error) {
      console.error('[research-watchdog] Query error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[research-watchdog] Found ${staleJobs?.length || 0} stale jobs`);

    let restarted = 0;
    let failed = 0;
    let skipped = 0;

    for (const job of staleJobs || []) {
      // Double-check status (in case it changed between query and processing)
      const { data: currentJob } = await supabase
        .from('competitor_research_jobs')
        .select('status, retry_count')
        .eq('id', job.id)
        .single();

      if (!currentJob || TERMINAL_STATUSES.includes(currentJob.status)) {
        console.log(`[research-watchdog] Job ${job.id} already ${currentJob?.status}, skipping`);
        skipped++;
        continue;
      }

      const retryCount = (currentJob.retry_count || 0) + 1;

      if (retryCount > MAX_RETRIES) {
        // Mark as failed - do NOT restart again
        await supabase.from('competitor_research_jobs').update({
          status: 'error',
          error_message: `Job stalled after ${MAX_RETRIES} retries. Check logs for details.`,
        }).eq('id', job.id);
        
        failed++;
        console.log(`[research-watchdog] Job ${job.id} failed after max retries`);
        continue;
      }

      // Determine which function to restart based on status
      let functionToCall: string | null = null;
      switch (job.status) {
        case 'discovering':
          functionToCall = 'competitor-discover';
          break;
        case 'scraping':
          functionToCall = 'competitor-scrape-worker';
          break;
        case 'extracting':
          functionToCall = 'extract-competitor-faqs';
          break;
        case 'deduplicating':
          functionToCall = 'competitor-dedupe-faqs';
          break;
        case 'refining':
          functionToCall = 'refine-competitor-faqs';
          break;
        default:
          // Unknown or terminal status - skip
          console.log(`[research-watchdog] Skipping job ${job.id} with status ${job.status}`);
          skipped++;
          continue;
      }

      // Update retry count and heartbeat BEFORE restarting
      await supabase.from('competitor_research_jobs').update({
        retry_count: retryCount,
        heartbeat_at: new Date().toISOString(),
      }).eq('id', job.id);

      // Restart the function
      console.log(`[research-watchdog] Restarting ${functionToCall} for job ${job.id} (retry ${retryCount})`);
      
      try {
        await supabase.functions.invoke(functionToCall, {
          body: { 
            jobId: job.id, 
            workspaceId: job.workspace_id,
            iteration: 0  // Reset iteration counter on restart
          }
        });
        restarted++;
      } catch (invokeError) {
        console.error(`[research-watchdog] Failed to invoke ${functionToCall}:`, invokeError);
        // Don't count as restarted if invoke failed
      }
    }

    return new Response(JSON.stringify({
      success: true,
      checked: staleJobs?.length || 0,
      restarted,
      failed,
      skipped,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[research-watchdog] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
