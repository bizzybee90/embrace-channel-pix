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
    const n8nWebhookBaseUrl = Deno.env.get('N8N_WEBHOOK_URL');
    
    if (!n8nWebhookBaseUrl) {
      return new Response(
        JSON.stringify({ error: 'N8N_WEBHOOK_URL not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { workspace_id, workflow_type } = body;

    if (!workspace_id || !workflow_type) {
      return new Response(
        JSON.stringify({ error: 'workspace_id and workflow_type are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[trigger-n8n] workspace=${workspace_id} type=${workflow_type}`);

    // Get business context
    const { data: businessContext, error: bcError } = await supabase
      .from('business_context')
      .select('*')
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    if (bcError) {
      console.error('[trigger-n8n] Error fetching business context:', bcError);
    }

    // Get search terms from n8n_workflow_progress (saved by SearchTermsStep)
    const { data: searchTermsProgress } = await supabase
      .from('n8n_workflow_progress')
      .select('details')
      .eq('workspace_id', workspace_id)
      .eq('workflow_type', 'search_terms_config')
      .maybeSingle();

    const searchConfig = (searchTermsProgress?.details as Record<string, unknown>) || {};

    // Callback URL for n8n to POST status updates
    const callbackUrl = `${supabaseUrl}/functions/v1/n8n-competitor-callback`;
    const emailCallbackUrl = `${supabaseUrl}/functions/v1/n8n-email-callback`;

    if (workflow_type === 'competitor_discovery') {
      // Extract domain from website URL for exclusion
      let excludeDomains: string[] = [];
      if (businessContext?.website_url) {
        try {
          const url = new URL(businessContext.website_url.startsWith('http') 
            ? businessContext.website_url 
            : `https://${businessContext.website_url}`);
          excludeDomains = [url.hostname.replace(/^www\./, '')];
        } catch (e) {
          console.warn('[trigger-n8n] Could not parse website URL:', e);
        }
      }

      // Build payload for n8n competitor discovery
      const competitorPayload = {
        workspace_id,
        business_name: businessContext?.company_name || 'Unknown Business',
        business_type: businessContext?.business_type || '',
        website_url: businessContext?.website_url || '',
        location: businessContext?.service_area || '',
        radius_miles: 20,
        search_queries: (searchConfig.search_queries as string[]) || [],
        target_count: (searchConfig.target_count as number) || 50,
        exclude_domains: excludeDomains,
        callback_url: callbackUrl,
      };

      console.log('[trigger-n8n] Sending to competitor-discovery:', JSON.stringify(competitorPayload));

      // Call n8n webhook
      const response = await fetch(`${n8nWebhookBaseUrl}/competitor-discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(competitorPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[trigger-n8n] n8n error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to trigger n8n workflow', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Initialize progress record
      await supabase.from('n8n_workflow_progress').upsert({
        workspace_id,
        workflow_type: 'competitor_discovery',
        status: 'pending',
        details: { message: 'Workflow triggered, waiting for n8n...' },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,workflow_type' });

      return new Response(
        JSON.stringify({ success: true, workflow: 'competitor_discovery' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (workflow_type === 'email_classification') {
      // n8n email classification workflow reads emails directly from DB
      // No need for Aurinko credentials — just workspace_id and callback
      const emailPayload = {
        workspace_id,
        callback_url: emailCallbackUrl,
      };

      console.log('[trigger-n8n] Sending to email-classification');

      const response = await fetch(`${n8nWebhookBaseUrl}/email-classification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[trigger-n8n] n8n email error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Failed to trigger email import workflow', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Initialize progress record
      await supabase.from('n8n_workflow_progress').upsert({
        workspace_id,
        workflow_type: 'email_import',
        status: 'pending',
        details: { message: 'Email classification triggered, waiting for n8n...' },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,workflow_type' });

      return new Response(
        JSON.stringify({ success: true, workflow: 'email_classification' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      return new Response(
        JSON.stringify({ error: `Unknown workflow_type: ${workflow_type}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('[trigger-n8n] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
