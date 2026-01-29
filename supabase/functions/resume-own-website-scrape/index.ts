import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'resume-own-website-scrape';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId, workspaceId } = await req.json();
    if (!jobId) throw new Error('jobId is required');
    if (!workspaceId) throw new Error('workspaceId is required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');
    if (!APIFY_API_KEY) throw new Error('APIFY_API_KEY not configured');

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: job, error: jobError } = await supabase
      .from('scraping_jobs')
      .select('id, workspace_id, apify_run_id, apify_dataset_id, status')
      .eq('id', jobId)
      .single();

    if (jobError || !job) throw new Error(`Job not found: ${jobError?.message ?? 'unknown'}`);
    if (job.workspace_id !== workspaceId) throw new Error('Workspace mismatch');
    if (!job.apify_run_id) throw new Error('Job has no apify_run_id yet');

    // If we already have a dataset, just kick processing.
    if (job.apify_dataset_id) {
      const invoke = await supabase.functions.invoke('process-own-website-scrape', {
        body: { jobId, workspaceId, datasetId: job.apify_dataset_id },
      });
      if (invoke.error) throw new Error(invoke.error.message);

      return new Response(JSON.stringify({
        success: true,
        resumed: true,
        datasetId: job.apify_dataset_id,
        mode: 'existing_dataset',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Otherwise, query Apify run for dataset.
    const runResp = await fetch(
      `https://api.apify.com/v2/actor-runs/${job.apify_run_id}?token=${APIFY_API_KEY}`
    );
    const runJson = await runResp.json().catch(() => ({}));
    if (!runResp.ok) {
      throw new Error(`Failed to fetch run status: ${runResp.status}`);
    }

    const status = runJson?.data?.status;
    const datasetId = runJson?.data?.defaultDatasetId;

    if (status !== 'SUCCEEDED' || !datasetId) {
      return new Response(JSON.stringify({
        success: true,
        resumed: false,
        status,
        datasetId: datasetId ?? null,
        message: 'Run not ready yet',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Kick processing
    const invoke = await supabase.functions.invoke('process-own-website-scrape', {
      body: { jobId, workspaceId, datasetId },
    });
    if (invoke.error) throw new Error(invoke.error.message);

    return new Response(JSON.stringify({
      success: true,
      resumed: true,
      status,
      datasetId,
      mode: 'run_lookup',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Error:`, error?.message ?? error);
    return new Response(JSON.stringify({
      success: false,
      error: error?.message ?? String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
