import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { workspaceId, confirm } = await req.json();

    if (!workspaceId) {
      return new Response(
        JSON.stringify({ error: 'workspaceId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (confirm !== 'CONFIRM_NUCLEAR_RESET') {
      return new Response(
        JSON.stringify({ error: 'Must send confirm: "CONFIRM_NUCLEAR_RESET"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[nuclear-reset] ⚠️ Starting nuclear reset for workspace ${workspaceId}`);
    console.log(`[nuclear-reset] This will TRUNCATE all messages, conversations, customers, and import data`);

    // Call the database function that uses TRUNCATE
    const { data, error } = await supabase.rpc('nuclear_reset', {
      p_workspace_id: workspaceId,
      p_confirm: confirm
    });

    if (error) {
      console.error('[nuclear-reset] Database error:', error);
      throw error;
    }

    console.log(`[nuclear-reset] ✅ Nuclear reset complete:`, data);

    return new Response(
      JSON.stringify({ success: true, result: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[nuclear-reset] Error:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
