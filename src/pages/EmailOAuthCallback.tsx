import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type CallbackStatus = 'processing' | 'success' | 'error';

export default function EmailOAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<CallbackStatus>('processing');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [connectedEmail, setConnectedEmail] = useState<string>('');

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      // Handle OAuth errors
      if (error) {
        setStatus('error');
        setErrorMessage(error === 'access_denied' ? 'Access was denied' : 'OAuth authentication failed');
        return;
      }

      if (!code || !state) {
        setStatus('error');
        setErrorMessage('Missing authorization code or state');
        return;
      }

      try {
        // Decode state to get workspaceId and importMode
        let parsedState: { workspaceId: string; importMode: string; provider: string };
        try {
          parsedState = JSON.parse(atob(state));
        } catch {
          throw new Error('Invalid state parameter');
        }

        // Exchange code for token
        const { data, error: fnError } = await supabase.functions.invoke('aurinko-exchange-token', {
          body: {
            code,
            workspaceId: parsedState.workspaceId,
            importMode: parsedState.importMode,
            provider: parsedState.provider
          }
        });

        if (fnError) throw fnError;
        if (data?.error) throw new Error(data.error);

        setConnectedEmail(data?.email || 'your email');
        setStatus('success');

        // Notify opener window if in popup
        if (window.opener) {
          window.opener.postMessage({ type: 'aurinko-auth-success' }, '*');
        }

        // Auto-redirect after success
        setTimeout(() => {
          navigate('/onboarding?step=email&aurinko=success');
        }, 2000);

      } catch (err: any) {
        console.error('OAuth callback error:', err);
        setStatus('error');
        setErrorMessage(err.message || 'Failed to complete email connection');
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        {status === 'processing' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <h1 className="text-xl font-semibold">Connecting your email...</h1>
            <p className="text-muted-foreground">Please wait while we complete the connection.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="h-12 w-12 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-6 w-6 text-success" />
            </div>
            <h1 className="text-xl font-semibold">Email Connected!</h1>
            <p className="text-muted-foreground">
              Successfully connected to {connectedEmail}
            </p>
            <p className="text-sm text-muted-foreground">
              Redirecting you back to setup...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <h1 className="text-xl font-semibold">Connection Failed</h1>
            <p className="text-muted-foreground">{errorMessage}</p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={() => navigate('/onboarding')}>
                Back to Setup
              </Button>
              <Button onClick={() => window.location.reload()}>
                Try Again
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
