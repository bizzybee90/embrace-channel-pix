import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create client with user's auth to verify JWT
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: userError } = await userSupabase.auth.getUser();
    
    if (userError || !user) {
      console.error('[aurinko-exchange-token] JWT validation failed:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized - invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const userId = user.id;
    console.log(`[aurinko-exchange-token] Authenticated user: ${userId}`);

    const { code, workspaceId, importMode, provider } = await req.json();

    if (!code || !workspaceId) {
      return new Response(
        JSON.stringify({ error: 'Missing code or workspaceId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =============================================
    // SECURITY: Verify user belongs to workspace
    // =============================================
    const { data: userWorkspace, error: workspaceError } = await userSupabase
      .from('users')
      .select('workspace_id')
      .eq('id', userId)
      .single();
    
    if (workspaceError || !userWorkspace || userWorkspace.workspace_id !== workspaceId) {
      console.error('[aurinko-exchange-token] User not authorized for workspace:', workspaceId);
      return new Response(
        JSON.stringify({ error: 'Not authorized for this workspace' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clientId = Deno.env.get('AURINKO_CLIENT_ID');
    const clientSecret = Deno.env.get('AURINKO_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      console.error('Missing Aurinko credentials');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Exchange code for token
    console.log('[aurinko-exchange-token] Exchanging code for token...');
    
    const tokenResponse = await fetch('https://api.aurinko.io/v1/auth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[aurinko-exchange-token] Token exchange failed:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to exchange authorization code' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.accessToken;

    if (!accessToken) {
      console.error('[aurinko-exchange-token] No access token in response');
      return new Response(
        JSON.stringify({ error: 'No access token received' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user's email address
    let emailAddress = tokenData.email;
    
    if (!emailAddress) {
      console.log('[aurinko-exchange-token] Fetching email from account endpoint...');
      const accountResponse = await fetch('https://api.aurinko.io/v1/account', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (accountResponse.ok) {
        const accountData = await accountResponse.json();
        emailAddress = accountData.email;
      }
    }

    if (!emailAddress) {
      console.error('[aurinko-exchange-token] Could not determine email address');
      return new Response(
        JSON.stringify({ error: 'Could not determine email address' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[aurinko-exchange-token] Got email: ${emailAddress}`);

    // Use service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // =============================================
    // SECURITY: First insert the record, then encrypt tokens via RPC
    // =============================================
    const { data: configData, error: insertError } = await supabase
      .from('email_provider_configs')
      .upsert({
        workspace_id: workspaceId,
        provider: provider || 'gmail',
        email_address: emailAddress,
        // Don't store plaintext tokens - will use RPC to encrypt
        access_token: null,
        refresh_token: null,
        import_mode: importMode || 'last_1000',
        sync_status: 'connected',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'workspace_id'
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[aurinko-exchange-token] Database error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save email configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =============================================
    // SECURITY: Store tokens encrypted via secure RPC
    // =============================================
    const { error: encryptError } = await supabase.rpc('store_encrypted_token', {
      p_config_id: configData.id,
      p_access_token: accessToken,
      p_refresh_token: tokenData.refreshToken || null
    });

    if (encryptError) {
      console.error('[aurinko-exchange-token] Failed to encrypt token:', encryptError);
      // Delete the config since we couldn't secure the tokens
      await supabase.from('email_provider_configs').delete().eq('id', configData.id);
      return new Response(
        JSON.stringify({ error: 'Failed to securely store credentials' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize make_progress for this workspace
    await supabase
      .from('make_progress')
      .upsert({
        workspace_id: workspaceId,
        status: 'idle',
        emails_imported: 0,
        emails_classified: 0,
        emails_total: 0,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'workspace_id'
      });

    console.log(`[aurinko-exchange-token] Successfully connected ${emailAddress} for workspace ${workspaceId} (tokens encrypted)`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        email: emailAddress,
        message: 'Email connected successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[aurinko-exchange-token] Error:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
