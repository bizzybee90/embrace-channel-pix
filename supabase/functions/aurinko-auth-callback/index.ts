import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    console.log('Aurinko callback received:', { code: !!code, state: !!state, error });

    if (error) {
      console.error('Aurinko auth error:', error);
      return new Response(
        `<html><body><script>window.close(); window.opener?.postMessage({ type: 'aurinko-auth-error', error: '${error}' }, '*');</script><p>Authentication failed: ${error}. You can close this window.</p></body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    if (!code || !state) {
      throw new Error('Missing code or state parameter');
    }

    // Decode state
    let stateData;
    try {
      stateData = JSON.parse(atob(state));
    } catch (e) {
      throw new Error('Invalid state parameter');
    }

    const { workspaceId, importMode, provider } = stateData;
    console.log('Decoded state:', { workspaceId, importMode, provider });

    const AURINKO_CLIENT_ID = Deno.env.get('AURINKO_CLIENT_ID');
    const AURINKO_CLIENT_SECRET = Deno.env.get('AURINKO_CLIENT_SECRET');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!AURINKO_CLIENT_ID || !AURINKO_CLIENT_SECRET) {
      throw new Error('Aurinko credentials not configured');
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://api.aurinko.io/v1/auth/token/' + code, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${AURINKO_CLIENT_ID}:${AURINKO_CLIENT_SECRET}`),
        'Content-Type': 'application/json',
      },
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await tokenResponse.json();
    console.log('Token exchange successful, account ID:', tokenData.accountId);

    // Get account info to retrieve email address
    const accountResponse = await fetch(`https://api.aurinko.io/v1/accounts/${tokenData.accountId}`, {
      headers: {
        'Authorization': `Bearer ${tokenData.accessToken}`,
      },
    });

    let emailAddress = tokenData.email || 'unknown@email.com';
    if (accountResponse.ok) {
      const accountData = await accountResponse.json();
      emailAddress = accountData.email || accountData.primaryEmail || emailAddress;
      console.log('Account email:', emailAddress);
    }

    // Store in database
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { error: dbError } = await supabase
      .from('email_provider_configs')
      .upsert({
        workspace_id: workspaceId,
        provider: provider,
        account_id: tokenData.accountId.toString(),
        access_token: tokenData.accessToken,
        email_address: emailAddress,
        import_mode: importMode,
        connected_at: new Date().toISOString(),
      }, {
        onConflict: 'workspace_id,email_address'
      });

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error('Failed to save email configuration');
    }

    console.log('Email provider config saved successfully');

    // Redirect back to settings with success message
    const successUrl = `${url.origin.replace('supabase.co/functions/v1', 'lovable.app')}/settings?email_connected=true`;
    
    return new Response(
      `<html><body><script>
        window.opener?.postMessage({ type: 'aurinko-auth-success' }, '*');
        window.location.href = '${successUrl}';
      </script><p>Email connected successfully! Redirecting...</p></body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in aurinko-auth-callback:', error);
    return new Response(
      `<html><body><script>window.opener?.postMessage({ type: 'aurinko-auth-error', error: '${errorMessage}' }, '*');</script><p>Error: ${errorMessage}. You can close this window.</p></body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
});
