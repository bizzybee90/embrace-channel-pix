import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const getCancelledHTML = () => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connection Cancelled</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
      background: linear-gradient(135deg, hsl(45, 100%, 52%) 0%, hsl(217, 91%, 60%) 100%);
    }
    .card {
      background: white; padding: 48px; border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.15);
      text-align: center; max-width: 400px; margin: 20px;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h2 { color: #1a1a1a; margin-bottom: 12px; font-size: 24px; font-weight: 600; }
    p { color: #666; margin-bottom: 24px; line-height: 1.5; }
    button {
      background: hsl(217, 91%, 60%); color: white; border: none;
      padding: 12px 32px; border-radius: 8px; cursor: pointer;
      font-size: 14px; font-weight: 500; transition: background 0.2s;
    }
    button:hover { background: hsl(217, 91%, 50%); }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✖️</div>
    <h2>Connection Cancelled</h2>
    <p>No worries! You can connect your email account anytime from Settings.</p>
    <button onclick="window.close()">Close Window</button>
  </div>
  <script>
    window.opener?.postMessage({ type: 'aurinko-auth-cancelled' }, '*');
    setTimeout(() => window.close(), 100);
  </script>
</body>
</html>
`;

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    console.log('Aurinko callback received:', { code: !!code, state: !!state, error });

    // Handle cancellation scenarios
    if (error === 'access_denied' || error === 'user_cancelled' || error === 'consent_required') {
      console.log('User cancelled OAuth flow:', error);
      return new Response(getCancelledHTML(), { headers: { 'Content-Type': 'text/html' } });
    }

    // If no code and no explicit error, treat as cancellation
    if (!code) {
      console.log('No code provided, treating as cancellation');
      return new Response(getCancelledHTML(), { headers: { 'Content-Type': 'text/html' } });
    }

    if (error) {
      console.error('Aurinko auth error:', error);
      return new Response(
        `<html><body><script>window.close(); window.opener?.postMessage({ type: 'aurinko-auth-error', error: '${error}' }, '*');</script><p>Authentication failed: ${error}. You can close this window.</p></body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    if (!state) {
      throw new Error('Missing state parameter');
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
