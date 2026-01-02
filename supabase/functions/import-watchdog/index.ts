import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Jobs without heartbeat for 5 minutes are considered stale
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[import-watchdog] Starting check for stale jobs...');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
    
    // Find jobs that haven't had a heartbeat in 5 minutes
    const { data: staleJobs, error: queryError } = await supabase
      .from('email_import_jobs')
      .select('id, config_id, status, retry_count')
      .in('status', ['scanning_inbox', 'scanning_sent', 'analyzing', 'fetching'])
      .lt('heartbeat_at', staleThreshold);

    if (queryError) {
      console.error('[import-watchdog] Query error:', queryError);
      throw queryError;
    }

    console.log(`[import-watchdog] Found ${staleJobs?.length || 0} stale jobs`);

    const restarted: string[] = [];
    const failed: string[] = [];

    for (const job of staleJobs || []) {
      // Max 3 retries before giving up
      if ((job.retry_count || 0) >= 3) {
        console.log(`[import-watchdog] Job ${job.id} exceeded max retries, marking as error`);
        await supabase.from('email_import_jobs').update({ 
          status: 'error', 
          error_message: 'Job stalled and max retries exceeded' 
        }).eq('id', job.id);
        
        await supabase.from('email_provider_configs').update({
          sync_status: 'error',
          sync_error: 'Import stalled - please retry'
        }).eq('id', job.config_id);
        
        failed.push(job.id);
        continue;
      }

      // Increment retry count and update heartbeat
      await supabase.from('email_import_jobs').update({
        retry_count: (job.retry_count || 0) + 1,
        heartbeat_at: new Date().toISOString(),
      }).eq('id', job.id);

      // Determine which function to restart based on status
      let functionName: string;
      switch (job.status) {
        case 'scanning_inbox':
        case 'scanning_sent':
          functionName = 'email-scan';
          break;
        case 'analyzing':
          functionName = 'email-analyze';
          break;
        case 'fetching':
          functionName = 'email-fetch-bodies';
          break;
        default:
          functionName = 'email-scan';
      }

      console.log(`[import-watchdog] Restarting job ${job.id} with ${functionName}`);
      
      try {
        await supabase.functions.invoke(functionName, { 
          body: { jobId: job.id, configId: job.config_id, resume: true } 
        });
        restarted.push(job.id);
      } catch (invokeErr) {
        console.error(`[import-watchdog] Failed to restart ${job.id}:`, invokeErr);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      checked: staleJobs?.length || 0,
      restarted,
      failed 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[import-watchdog] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
