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
      total_emails,
      emails_imported,
      emails_classified,
      categories,
      error: errorMsg
    } = body;

    if (!workspace_id) {
      return new Response(
        JSON.stringify({ error: 'workspace_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[n8n-email-callback] workspace=${workspace_id} status=${status} message=${message}`);

    // Build details object
    const details: Record<string, unknown> = {
      message,
      updated_at: new Date().toISOString(),
    };

    if (total_emails !== undefined) details.total_emails = total_emails;
    if (emails_imported !== undefined) details.emails_imported = emails_imported;
    if (emails_classified !== undefined) details.emails_classified = emails_classified;
    if (categories) details.categories = categories;
    if (errorMsg) details.error = errorMsg;

    // Upsert to n8n_workflow_progress table
    const { error: upsertError } = await supabase
      .from('n8n_workflow_progress')
      .upsert({
        workspace_id,
        workflow_type: 'email_import',
        status: status || 'in_progress',
        details,
        updated_at: new Date().toISOString(),
        completed_at: status === 'complete' || status === 'classification_complete' 
          ? new Date().toISOString() 
          : null,
      }, {
        onConflict: 'workspace_id,workflow_type',
      });

    if (upsertError) {
      console.error('[n8n-email-callback] Upsert error:', upsertError);
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
    console.error('[n8n-email-callback] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
