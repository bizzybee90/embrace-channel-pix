import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FAQ_WORKFLOW_URL = 'https://bizzybee.app.n8n.cloud/webhook/faq-generation';

/**
 * start-competitor-analysis
 * 
 * Called by the UI after the user reviews/edits the competitor list.
 * Triggers the n8n FAQ generation workflow with the curated list.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { workspace_id } = await req.json();

    if (!workspace_id) {
      return new Response(
        JSON.stringify({ error: 'workspace_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[start-competitor-analysis] workspace=${workspace_id}`);

    // Fetch selected competitors (is_selected = true OR status in discovered/validated/approved)
    const { data: competitors, error: fetchError } = await supabase
      .from('competitor_sites')
      .select('id, business_name, domain, url, address, rating, reviews_count, phone')
      .eq('workspace_id', workspace_id)
      .eq('is_selected', true)
      .order('created_at', { ascending: false })
      .limit(100);

    if (fetchError) {
      console.error('[start-competitor-analysis] Failed to fetch competitors:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch competitors' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!competitors || competitors.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No competitors selected' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get business context
    const { data: context } = await supabase
      .from('business_context')
      .select('business_type, company_name')
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    // Update progress to pending
    await supabase.from('n8n_workflow_progress').upsert({
      workspace_id,
      workflow_type: 'competitor_scrape',
      status: 'pending',
      details: {
        message: `Queued ${competitors.length} competitors for scraping & FAQ extraction`,
        total: competitors.length,
        competitors_found: competitors.length,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,workflow_type' });

    const callbackUrl = `${supabaseUrl}/functions/v1/n8n-competitor-callback`;

    const payload = {
      workspace_id,
      business_type: context?.business_type || '',
      business_name: context?.company_name || '',
      competitors: competitors.map(c => ({
        id: c.id,
        business_name: c.business_name,
        domain: c.domain,
        url: c.url,
        address: c.address,
        rating: c.rating,
        reviews_count: c.reviews_count,
        phone: c.phone,
      })),
      callback_url: callbackUrl,
    };

    const response = await fetch(FAQ_WORKFLOW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    console.log(`[start-competitor-analysis] FAQ workflow triggered: status=${response.status}, competitors=${competitors.length}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[start-competitor-analysis] FAQ workflow error:', errorText);
      
      await supabase.from('n8n_workflow_progress').upsert({
        workspace_id,
        workflow_type: 'competitor_scrape',
        status: 'failed',
        details: { message: 'Failed to trigger FAQ generation workflow', error: errorText },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,workflow_type' });

      return new Response(
        JSON.stringify({ error: 'Failed to trigger workflow' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, competitors_count: competitors.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[start-competitor-analysis] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
