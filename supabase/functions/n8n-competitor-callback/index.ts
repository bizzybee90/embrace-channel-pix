import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { 
      workspace_id, 
      status, 
      message,
      competitors_found,
      competitors_scraped,
      verified_count,
      probable_count,
      hallucinations_caught,
      live_domains,
      dead_domains,
      scraped,
      failed,
      faq_count,
      competitor_count,
      claude_found,
      gemini_found,
      error: errorMsg
    } = body;

    if (!workspace_id) {
      return new Response(
        JSON.stringify({ error: 'workspace_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[n8n-callback] workspace=${workspace_id} status=${status} message=${message}`);

    // Build details object with all available counts
    const details: Record<string, unknown> = {
      message,
      updated_at: new Date().toISOString(),
    };

    if (competitors_found !== undefined) details.competitors_found = competitors_found;
    if (competitors_scraped !== undefined) details.competitors_scraped = competitors_scraped;
    if (verified_count !== undefined) details.verified_count = verified_count;
    if (probable_count !== undefined) details.probable_count = probable_count;
    if (hallucinations_caught !== undefined) details.hallucinations_caught = hallucinations_caught;
    if (live_domains !== undefined) details.live_domains = live_domains;
    if (dead_domains !== undefined) details.dead_domains = dead_domains;
    if (scraped !== undefined) details.competitors_scraped = scraped;
    if (failed !== undefined) details.scrape_failed = failed;
    if (faq_count !== undefined) details.faqs_generated = faq_count;
    if (competitor_count !== undefined) details.competitor_count = competitor_count;
    if (claude_found !== undefined) details.claude_found = claude_found;
    if (gemini_found !== undefined) details.gemini_found = gemini_found;
    if (errorMsg) details.error = errorMsg;

    // Upsert to n8n_workflow_progress table
    const { error: upsertError } = await supabase
      .from('n8n_workflow_progress')
      .upsert({
        workspace_id,
        workflow_type: 'competitor_discovery',
        status: status || 'in_progress',
        details,
        updated_at: new Date().toISOString(),
        completed_at: status === 'complete' ? new Date().toISOString() : null,
      }, {
        onConflict: 'workspace_id,workflow_type',
      });

    if (upsertError) {
      console.error('[n8n-callback] Upsert error:', upsertError);
      return new Response(
        JSON.stringify({ error: 'Failed to update progress', details: upsertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, status, workspace_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[n8n-callback] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
