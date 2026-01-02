import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { configId, mode = 'all' } = await req.json();
    
    if (!configId) {
      return new Response(JSON.stringify({ error: 'Missing configId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[start-email-import] Starting import:', { configId, mode });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get email config
    const { data: config, error: configError } = await supabase
      .from('email_provider_configs')
      .select('id, workspace_id, email_address, access_token')
      .eq('id', configId)
      .single();

    if (configError || !config) {
      return new Response(JSON.stringify({ error: 'Email config not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Cancel any existing running jobs for this config
    const { data: existingJobs } = await supabase
      .from('email_import_jobs')
      .select('id')
      .eq('config_id', configId)
      .in('status', ['queued', 'scanning_inbox', 'scanning_sent', 'analyzing', 'fetching']);

    if (existingJobs && existingJobs.length > 0) {
      console.log(`[start-email-import] Cancelling ${existingJobs.length} existing jobs`);
      await supabase
        .from('email_import_jobs')
        .update({ status: 'cancelled' })
        .in('id', existingJobs.map(j => j.id));
    }

    // Clear old import queue for this config
    await supabase.from('email_import_queue').delete().eq('config_id', configId);
    await supabase.from('email_thread_analysis').delete().eq('workspace_id', config.workspace_id);

    // Create new import job
    const { data: newJob, error: jobError } = await supabase
      .from('email_import_jobs')
      .insert({
        workspace_id: config.workspace_id,
        config_id: configId,
        status: 'queued',
        import_mode: mode,
        checkpoint: { phase: 'inbox', page_token: null },
        heartbeat_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (jobError || !newJob) {
      console.error('[start-email-import] Failed to create job:', jobError);
      return new Response(JSON.stringify({ error: 'Failed to create import job' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update email config with active job
    await supabase.from('email_provider_configs').update({
      active_job_id: newJob.id,
      sync_status: 'syncing',
      sync_stage: 'scanning_inbox',
      sync_started_at: new Date().toISOString(),
      sync_error: null,
    }).eq('id', configId);

    // Kick off the scan phase
    supabase.functions.invoke('email-scan', {
      body: { jobId: newJob.id, configId }
    }).catch(err => console.error('[start-email-import] Failed to start scan:', err));

    return new Response(JSON.stringify({
      success: true,
      jobId: newJob.id,
      message: 'Import started'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[start-email-import] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
