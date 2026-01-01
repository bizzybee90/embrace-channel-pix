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

const buildRedirectUrl = (
  origin: string,
  type: 'cancelled' | 'error' | 'success',
  message?: string
) => {
  // For success, redirect to a dedicated success page
  if (type === 'success') {
    const url = new URL('/email-auth-success', origin);
    url.searchParams.set('aurinko', 'success');
    return url.toString();
  }
  
  // For errors/cancelled, redirect back to onboarding
  const url = new URL('/onboarding', origin);
  url.searchParams.set('step', 'email');
  url.searchParams.set('aurinko', type);
  if (message) url.searchParams.set('message', message.slice(0, 200));
  return url.toString();
};

const redirectToApp = (
  origin: string,
  type: 'cancelled' | 'error' | 'success',
  message?: string
) => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: buildRedirectUrl(origin, type, message),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
};

function safeMessage(text: string): string {
  // keep URL safe and short
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}

const defaultOrigin = 'https://ikioetqbrybnofqkdcib.lovable.app';

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
      let cancelOrigin = defaultOrigin;
      try {
        if (state) {
          const stateData = JSON.parse(atob(state));
          cancelOrigin = stateData.origin || defaultOrigin;
        }
      } catch (e) {
        // ignore
      }
      return redirectToApp(cancelOrigin, 'cancelled');
    }

    // If no code and no explicit error, treat as cancellation
    if (!code) {
      console.log('No code provided, treating as cancellation');
      return redirectToApp(defaultOrigin, 'cancelled');
    }

    if (error) {
      console.error('Aurinko auth error:', error);
      return redirectToApp(defaultOrigin, 'error', safeMessage(error));
    }

    if (!state) {
      return redirectToApp(defaultOrigin, 'error', 'Missing state');
    }

    // Decode state
    let stateData;
    try {
      stateData = JSON.parse(atob(state));
    } catch (e) {
      return redirectToApp(defaultOrigin, 'error', 'Invalid state');
    }

    const { workspaceId, importMode, provider, origin } = stateData;
    const appOrigin = origin || 'https://ikioetqbrybnofqkdcib.lovable.app';
    console.log('Decoded state:', { workspaceId, importMode, provider, origin: appOrigin });

    const AURINKO_CLIENT_ID = Deno.env.get('AURINKO_CLIENT_ID');
    const AURINKO_CLIENT_SECRET = Deno.env.get('AURINKO_CLIENT_SECRET');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!AURINKO_CLIENT_ID || !AURINKO_CLIENT_SECRET) {
      return redirectToApp(appOrigin, 'error', 'Aurinko credentials not configured');
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
      return redirectToApp(appOrigin, 'error', 'Failed to exchange authorization code. Please try again.');
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
      return redirectToApp(appOrigin, 'error', 'Failed to save email configuration');
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

    // Redirect back into the app instead of showing an inline HTML page.
    // This avoids browsers showing raw HTML (text/plain) and keeps the UX consistent.
    return redirectToApp(appOrigin, 'success');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in aurinko-auth-callback:', error);
    return redirectToApp(defaultOrigin, 'error', safeMessage(errorMessage));
  }
});
