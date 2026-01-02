import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { workspaceId, industry, location, radiusMiles = 20 } = await req.json();
    
    if (!workspaceId || !industry || !location) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[start-research] Starting:', { workspaceId, industry, location, radiusMiles });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Cancel any existing running jobs
    await supabase
      .from('competitor_research_jobs')
      .update({ status: 'cancelled' })
      .eq('workspace_id', workspaceId)
      .in('status', ['queued', 'discovering', 'validating', 'scraping', 'extracting', 'deduplicating', 'refining', 'embedding']);

    // Generate search queries
    const searchQueries = [
      `${industry} ${location}`,
      `${industry} services ${location}`,
      `${industry} company ${location}`,
      `best ${industry} ${location}`,
      `${industry} near ${location}`,
    ];

    // Create new job
    const { data: job, error: jobError } = await supabase
      .from('competitor_research_jobs')
      .insert({
        workspace_id: workspaceId,
        industry,
        location,
        radius_miles: radiusMiles,
        search_queries: searchQueries,
        niche_query: industry,
        service_area: location,
        status: 'queued',
        heartbeat_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (jobError || !job) {
      console.error('[start-research] Job error:', jobError);
      return new Response(JSON.stringify({ error: 'Failed to create job' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[start-research] Created job:', job.id);

    // Kick off discovery phase
    supabase.functions.invoke('competitor-discover', {
      body: { jobId: job.id, workspaceId }
    }).catch(err => console.error('Failed to start discovery:', err));

    return new Response(JSON.stringify({
      success: true,
      jobId: job.id,
      message: 'Research started'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[start-research] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
