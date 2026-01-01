import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Redirect helper that uses origin from state

const redirectTo = (baseUrl: string, path: string, params?: Record<string, string>) => {
  const url = new URL(path, baseUrl);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new Response(null, {
    status: 302,
    headers: { 'Location': url.toString() },
  });
};

const getStyledHTML = (type: 'cancelled' | 'error' | 'success', message?: string, origin?: string) => {
  const errorDetail = message ? `<div class="error-detail">${escapeHtml(message)}</div>` : '';
  const errorPostMessage = type === 'error' && message ? `, error: '${message.replace(/'/g, "\\'").replace(/\n/g, ' ')}'` : '';
  const appUrl = origin ? `${origin}/onboarding?step=email` : '/onboarding?step=email';
  
  const titles: Record<string, string> = {
    success: 'Connected!',
    cancelled: 'Cancelled',
    error: 'Error'
  };
  
  const icons: Record<string, string> = {
    success: '&#10003;',  // checkmark
    cancelled: '&#10005;', // X
    error: '&#9888;'       // warning
  };
  
  const iconClasses: Record<string, string> = {
    success: 'success-icon',
    cancelled: '',
    error: 'error-icon'
  };
  
  const headings: Record<string, string> = {
    success: 'Email Connected!',
    cancelled: 'Connection Cancelled',
    error: 'Connection Failed'
  };
  
  const descriptions: Record<string, string> = {
    success: 'Closing automatically...',
    cancelled: 'No worries! You can connect your email anytime.',
    error: ''
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${titles[type]}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:linear-gradient(135deg,#f5a623 0%,#3b82f6 100%)}
.card{background:#fff;padding:48px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.15);text-align:center;max-width:400px;margin:20px}
.icon{font-size:48px;margin-bottom:16px}
h2{color:#1a1a1a;margin-bottom:12px;font-size:24px;font-weight:600}
p{color:#666;margin-bottom:24px;line-height:1.5;font-size:14px}
.error-detail{background:#fef2f2;color:#991b1b;padding:12px 16px;border-radius:8px;margin-bottom:24px;font-size:13px;word-break:break-word}
.closing{color:#3b82f6;font-weight:500}
button{background:#3b82f6;color:#fff;border:none;padding:12px 32px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;transition:background .2s}
button:hover{background:#2563eb}
.success-icon{color:#22c55e}
.error-icon{color:#ef4444}
</style>
</head>
<body>
<div class="card">
<div class="icon ${iconClasses[type]}">${icons[type]}</div>
<h2>${headings[type]}</h2>
${type === 'error' ? errorDetail : `<p class="${type === 'success' ? 'closing' : ''}">${descriptions[type]}</p>`}
${type !== 'success' ? '<button onclick="goBack()">Return to App</button>' : ''}
</div>
<script>
var appUrl='${appUrl}';
function goBack(){if(window.opener){window.opener.postMessage({type:'aurinko-auth-${type}'${errorPostMessage}},'*');try{window.close()}catch(e){}}window.location.href=appUrl}
${type === 'success' ? `(function(){if(window.opener){window.opener.postMessage({type:'aurinko-auth-success'},'*');try{window.close()}catch(e){}}setTimeout(function(){window.location.href=appUrl},1500)})();` : ''}
</script>
</body>
</html>`;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const htmlHeaders = new Headers({
  // NOTE: Some gateways will coerce unknown/unsafe content types.
  // Using lowercase header name + explicit html helps ensure browsers render this page.
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-cache, no-store, must-revalidate',
});

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    console.log('Aurinko callback received:', { code: !!code, state: !!state, error });

    // Handle cancellation scenarios
    if (error === 'access_denied' || error === 'user_cancelled' || error === 'consent_required') {
      console.log('User cancelled OAuth flow:', error);
      // Try to get origin from state if available
      let cancelOrigin = '';
      try {
        if (state) {
          const stateData = JSON.parse(atob(state));
          cancelOrigin = stateData.origin || '';
        }
      } catch(e) {}
      return new Response(getStyledHTML('cancelled', undefined, cancelOrigin), { status: 200, headers: htmlHeaders });
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

    const { workspaceId, importMode, provider, origin } = stateData;
    const appOrigin = origin || 'https://ikioetqbrybnofqkdcib.lovable.app';
    console.log('Decoded state:', { workspaceId, importMode, provider, origin: appOrigin });

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

    // Auto-detect aliases
    let aliases: string[] = [];
    console.log('Provider type:', provider, '- detecting aliases for:', emailAddress);
    
    // For maccleaning.uk domain, we know the aliases
    const emailDomain = emailAddress.split('@')[1]?.toLowerCase();
    if (emailDomain === 'maccleaning.uk') {
      const knownAliases = ['info@maccleaning.uk', 'hello@maccleaning.uk', 'michael@maccleaning.uk'];
      aliases = knownAliases.filter(a => a.toLowerCase() !== emailAddress.toLowerCase());
      console.log('Using known maccleaning.uk aliases:', aliases);
    }

    // Create webhook subscription for email notifications
    const webhookUrl = `${SUPABASE_URL}/functions/v1/aurinko-webhook`;
    console.log('Creating email subscription with webhook URL:', webhookUrl);
    
    let subscriptionId: string | null = null;
    try {
      const subscriptionResponse = await fetch('https://api.aurinko.io/v1/subscriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resource: '/email/messages',
          notificationUrl: webhookUrl,
        }),
      });

      if (subscriptionResponse.ok) {
        const subscriptionData = await subscriptionResponse.json();
        subscriptionId = subscriptionData.id?.toString() || null;
        console.log('Email subscription created successfully:', JSON.stringify(subscriptionData));
      } else {
        const subscriptionError = await subscriptionResponse.text();
        console.error('Failed to create email subscription:', subscriptionResponse.status, subscriptionError);
        // Continue anyway - we can still store the config
      }
    } catch (subError) {
      console.error('Error creating subscription:', subError);
      // Continue anyway
    }

    // Store in database
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: configData, error: dbError } = await supabase
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
        subscription_id: subscriptionId,
        sync_status: 'pending',
        sync_stage: 'queued',
      }, {
        onConflict: 'workspace_id,email_address'
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      return new Response(getStyledHTML('error', 'Failed to save email configuration'), { status: 200, headers: htmlHeaders });
    }

    console.log('Email provider config saved successfully with', aliases.length, 'aliases, configId:', configData?.id);

    // =============================================
    // TRIGGER EMAIL SYNC IMMEDIATELY
    // This is the key fix - start syncing right after OAuth
    // =============================================
    if (configData?.id) {
      console.log('Triggering email-sync for configId:', configData.id, 'mode:', importMode);
      
      try {
        // Call email-sync function asynchronously (don't wait for it to complete)
        const syncPromise = supabase.functions.invoke('email-sync', {
          body: {
            configId: configData.id,
            mode: importMode,
            // For all_history and last_1000, we'll let the function handle pagination
            maxMessages: importMode === 'all_history' ? 10000 : 
                        importMode === 'last_1000' ? 1000 : 100,
          }
        });

        // Don't await - let it run in background
        syncPromise.then(result => {
          console.log('Email sync started in background:', result.data || result.error);
        }).catch(err => {
          console.error('Background sync failed to start:', err);
        });

        // Update sync status to indicate sync is starting
        await supabase
          .from('email_provider_configs')
          .update({ 
            sync_status: 'syncing',
            sync_stage: 'fetching_inbox',
            sync_started_at: new Date().toISOString()
          })
          .eq('id', configData.id);

      } catch (syncError) {
        console.error('Error triggering email sync:', syncError);
        // Don't fail the OAuth flow, just log the error
      }
    }

    // Return success HTML that posts message to opener window
    // This allows the onboarding flow to continue seamlessly
    return new Response(getStyledHTML('success', undefined, appOrigin), { status: 200, headers: htmlHeaders });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in aurinko-auth-callback:', error);
    return new Response(getStyledHTML('error', errorMessage), { status: 200, headers: htmlHeaders });
  }
});
