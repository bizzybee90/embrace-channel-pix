import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // =============================================
    // SECURITY: Validate JWT authentication
    // =============================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - missing token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's auth to verify JWT
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();

    if (authError || !user) {
      console.error('[nuclear-reset] JWT validation failed:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized - invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    console.log(`[nuclear-reset] Authenticated user: ${userId}`);

    // Use service role to look up workspace (avoids RLS issues)
    const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userError } = await serviceSupabase
      .from('users')
      .select('workspace_id')
      .eq('id', userId)
      .single();

    if (userError || !userData?.workspace_id) {
      console.error('[nuclear-reset] User workspace lookup failed:', userError);
      return new Response(
        JSON.stringify({ error: 'User not associated with a workspace' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { workspaceId, confirm } = await req.json();

    // =============================================
    // SECURITY: Verify user can only reset their own workspace
    // =============================================
    if (workspaceId !== userData.workspace_id) {
      return new Response(
        JSON.stringify({ error: 'Cannot reset a workspace you do not belong to' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // Use service role for the actual reset (already created above as serviceSupabase)
    const supabase = serviceSupabase;

    console.log(`[nuclear-reset] ⚠️ Starting nuclear reset for workspace ${workspaceId} by user ${userId}`);
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
