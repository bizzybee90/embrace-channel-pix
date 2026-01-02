import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Jobs are considered stale if no heartbeat in 5 minutes
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const MAX_RETRIES = 3;

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
    const { data: staleJobs, error } = await supabase
      .from('competitor_research_jobs')
      .select('*')
      .in('status', ['discovering', 'validating', 'scraping', 'extracting', 'deduplicating', 'refining', 'embedding'])
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

    for (const job of staleJobs || []) {
      const retryCount = (job.retry_count || 0) + 1;

      if (retryCount > MAX_RETRIES) {
        // Mark as failed
        await supabase.from('competitor_research_jobs').update({
          status: 'error',
          error_message: `Job stalled after ${MAX_RETRIES} retries`,
        }).eq('id', job.id);
        
        failed++;
        console.log(`[research-watchdog] Job ${job.id} failed after max retries`);
        continue;
      }

      // Determine which function to restart based on status
      let functionToCall: string;
      switch (job.status) {
        case 'discovering':
          functionToCall = 'competitor-discover';
          break;
        case 'validating':
          functionToCall = 'competitor-validate';
          break;
        case 'scraping':
          functionToCall = 'competitor-scrape';
          break;
        case 'extracting':
          functionToCall = 'competitor-extract-faqs';
          break;
        case 'deduplicating':
          functionToCall = 'competitor-dedupe-faqs';
          break;
        case 'refining':
        case 'embedding':
          functionToCall = 'competitor-refine-faqs';
          break;
        default:
          continue;
      }

      // Update retry count and heartbeat
      await supabase.from('competitor_research_jobs').update({
        retry_count: retryCount,
        heartbeat_at: new Date().toISOString(),
      }).eq('id', job.id);

      // Restart the function
      console.log(`[research-watchdog] Restarting ${functionToCall} for job ${job.id}`);
      
      await supabase.functions.invoke(functionToCall, {
        body: { 
          jobId: job.id, 
          workspaceId: job.workspace_id 
        }
      });

      restarted++;
    }

    return new Response(JSON.stringify({
      success: true,
      checked: staleJobs?.length || 0,
      restarted,
      failed,
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
