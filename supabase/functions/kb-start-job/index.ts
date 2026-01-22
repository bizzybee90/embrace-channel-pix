import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'kb-start-job';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { workspace_id, niche_query, service_area, target_count = 15 } = await req.json();

    if (!workspace_id) throw new Error('workspace_id is required');
    if (!niche_query) throw new Error('niche_query is required');

    console.log(`[${FUNCTION_NAME}] Starting job for workspace:`, workspace_id);

    // Verify ground truth exists (Stage 1 completed)
    const { data: facts, error: factsError } = await supabase
      .from('ground_truth_facts')
      .select('id')
      .eq('workspace_id', workspace_id)
      .limit(1);

    if (factsError) {
      console.error(`[${FUNCTION_NAME}] Error checking ground truth:`, factsError);
    }

    if (!facts?.length) {
      // Check if workspace has been analyzed at all
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('ground_truth_generated, website_url')
        .eq('id', workspace_id)
        .single();

      if (!workspace?.ground_truth_generated) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Ground truth not generated. Please analyze your website first.',
            code: 'GROUND_TRUTH_REQUIRED'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Load business profile for additional context
    const { data: profile } = await supabase
      .from('business_profile')
      .select('business_name, industry, search_keywords, service_area')
      .eq('workspace_id', workspace_id)
      .single();

    // Create the job
    const { data: job, error: jobError } = await supabase
      .from('competitor_research_jobs')
      .insert({
        workspace_id,
        niche_query,
        service_area: service_area || profile?.service_area,
        target_count,
        status: 'queued',
        industry: profile?.industry,
        started_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString()
      })
      .select()
      .single();

    if (jobError) {
      throw new Error(`Failed to create job: ${jobError.message}`);
    }

    // Update workspace status
    await supabase
      .from('workspaces')
      .update({ knowledge_base_status: 'discovering' })
      .eq('id', workspace_id);

    const duration = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Created job ${job.id} in ${duration}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        job_id: job.id,
        niche_query,
        service_area: service_area || profile?.service_area,
        target_count,
        search_keywords: profile?.search_keywords || [],
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[${FUNCTION_NAME}] Error:`, error.message);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: FUNCTION_NAME,
        duration_ms: duration
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
