import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const getStyledHTML = (type: 'cancelled' | 'error' | 'success', message?: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${type === 'success' ? 'Connected!' : type === 'cancelled' ? 'Connection Cancelled' : 'Connection Error'}</title>
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
    .error-detail { 
      background: #fef2f2; color: #991b1b; padding: 12px 16px; 
      border-radius: 8px; margin-bottom: 24px; font-size: 13px;
      word-break: break-word;
    }
    button {
      background: hsl(217, 91%, 60%); color: white; border: none;
      padding: 12px 32px; border-radius: 8px; cursor: pointer;
      font-size: 14px; font-weight: 500; transition: background 0.2s;
    }
    button:hover { background: hsl(217, 91%, 50%); }
    .success-icon { color: #22c55e; }
    .error-icon { color: #ef4444; }
  </style>
</head>
<body>
  <div class="card">
    ${type === 'success' ? `
      <div class="icon success-icon">✓</div>
      <h2>Email Connected!</h2>
      <p>Your email account has been connected successfully. This window will close automatically.</p>
    ` : type === 'cancelled' ? `
      <div class="icon">✖️</div>
      <h2>Connection Cancelled</h2>
      <p>No worries! You can connect your email account anytime from Settings.</p>
    ` : `
      <div class="icon error-icon">⚠️</div>
      <h2>Connection Failed</h2>
      <p>Something went wrong while connecting your email account.</p>
      ${message ? `<div class="error-detail">${message}</div>` : ''}
      <p>Please try again or contact support if the issue persists.</p>
    `}
    <button onclick="window.close()">Close Window</button>
  </div>
  <script>
    window.opener?.postMessage({ type: 'aurinko-auth-${type}'${type === 'error' && message ? `, error: '${message.replace(/'/g, "\\'")}'` : ''} }, '*');
    ${type === 'success' ? "setTimeout(() => window.close(), 2000);" : ""}
  </script>
</body>
</html>`;

const htmlHeaders = new Headers({
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
});

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
      return new Response(getStyledHTML('cancelled'), { status: 200, headers: htmlHeaders });
    }

    // If no code and no explicit error, treat as cancellation
    if (!code) {
      console.log('No code provided, treating as cancellation');
      return new Response(getStyledHTML('cancelled'), { status: 200, headers: htmlHeaders });
    }

    if (error) {
      console.error('Aurinko auth error:', error);
      return new Response(getStyledHTML('error', error), { status: 200, headers: htmlHeaders });
    }

    if (!state) {
      return new Response(getStyledHTML('error', 'Missing state parameter'), { status: 200, headers: htmlHeaders });
    }

    // Decode state
    let stateData;
    try {
      stateData = JSON.parse(atob(state));
    } catch (e) {
      return new Response(getStyledHTML('error', 'Invalid state parameter'), { status: 200, headers: htmlHeaders });
    }

    const { workspaceId, importMode, provider } = stateData;
    console.log('Decoded state:', { workspaceId, importMode, provider });

    const AURINKO_CLIENT_ID = Deno.env.get('AURINKO_CLIENT_ID');
    const AURINKO_CLIENT_SECRET = Deno.env.get('AURINKO_CLIENT_SECRET');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!AURINKO_CLIENT_ID || !AURINKO_CLIENT_SECRET) {
      return new Response(getStyledHTML('error', 'Aurinko credentials not configured'), { status: 200, headers: htmlHeaders });
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
      return new Response(getStyledHTML('error', 'Failed to exchange authorization code. Please try again.'), { status: 200, headers: htmlHeaders });
    }

    const tokenData = await tokenResponse.json();
    console.log('Token exchange successful:', JSON.stringify(tokenData));

    // Extract email from token response
    let emailAddress = tokenData.email || tokenData.userEmail || 'unknown@email.com';

    // If not in token response, get from /v1/account endpoint using Bearer token
    if (emailAddress === 'unknown@email.com') {
      try {
        const accountResponse = await fetch('https://api.aurinko.io/v1/account', {
          headers: {
            'Authorization': `Bearer ${tokenData.accessToken}`,
          },
        });

        if (accountResponse.ok) {
          const accountData = await accountResponse.json();
          console.log('Account data:', JSON.stringify(accountData));
          emailAddress = accountData.email || accountData.email2 || accountData.mailboxAddress || accountData.loginString || emailAddress;
        } else {
          console.log('Account fetch failed:', accountResponse.status, await accountResponse.text());
        }
      } catch (e) {
        console.log('Failed to fetch account info:', e);
      }
    }
    
    console.log('Final email address:', emailAddress);

    // Try to auto-fetch aliases for Google accounts
    let aliases: string[] = [];
    console.log('Provider type:', provider, '- attempting alias detection');
    
    if (provider === 'Google' && tokenData.accessToken) {
      try {
        // Try calling Gmail API directly with the token
        console.log('Attempting Gmail sendAs API call...');
        const sendAsResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs', {
          headers: {
            'Authorization': `Bearer ${tokenData.accessToken}`,
          },
        });

        console.log('Gmail sendAs response status:', sendAsResponse.status);
        
        if (sendAsResponse.ok) {
          const sendAsData = await sendAsResponse.json();
          console.log('Gmail sendAs data:', JSON.stringify(sendAsData));
          
          // Extract aliases (exclude the primary email)
          if (sendAsData.sendAs && Array.isArray(sendAsData.sendAs)) {
            aliases = sendAsData.sendAs
              .map((sa: any) => sa.sendAsEmail?.toLowerCase())
              .filter((email: string) => email && email !== emailAddress.toLowerCase());
          }
          console.log('Auto-detected aliases:', aliases);
        } else {
          const errorText = await sendAsResponse.text();
          console.log('Gmail sendAs failed:', sendAsResponse.status, errorText);
        }
      } catch (e) {
        console.log('Failed to fetch Gmail aliases:', e);
      }
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
        aliases: aliases,
      }, {
        onConflict: 'workspace_id,email_address'
      });

    if (dbError) {
      console.error('Database error:', dbError);
      return new Response(getStyledHTML('error', 'Failed to save email configuration'), { status: 200, headers: htmlHeaders });
    }

    console.log('Email provider config saved successfully with', aliases.length, 'aliases');

    // Return success page
    return new Response(getStyledHTML('success'), { status: 200, headers: htmlHeaders });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in aurinko-auth-callback:', error);
    return new Response(getStyledHTML('error', errorMessage), { status: 200, headers: htmlHeaders });
  }
});
