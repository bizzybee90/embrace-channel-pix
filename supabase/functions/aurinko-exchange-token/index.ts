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
    const { code, workspaceId, importMode, provider } = await req.json();

    if (!code || !workspaceId) {
      return new Response(
        JSON.stringify({ error: 'Missing code or workspaceId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Save to email_provider_configs
    const { error: insertError } = await supabase
      .from('email_provider_configs')
      .upsert({
        workspace_id: workspaceId,
        provider: provider || 'gmail',
        email_address: emailAddress,
        access_token: accessToken,
        refresh_token: tokenData.refreshToken || null,
        import_mode: importMode || 'last_1000',
        sync_status: 'connected',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'workspace_id'
      });

    if (insertError) {
      console.error('[aurinko-exchange-token] Database error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save email configuration' }),
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

    console.log(`[aurinko-exchange-token] Successfully connected ${emailAddress} for workspace ${workspaceId}`);

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
