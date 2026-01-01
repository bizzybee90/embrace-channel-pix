import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Mail, Loader2, Coffee, ArrowRight } from 'lucide-react';

const playfulMessages = [
  "☕ Go grab a coffee while we build your AI clone!",
  "🍵 Perfect time for a tea break!",
  "🚶 Take a quick stretch — we've got this!",
  "📱 Check your other notifications, we're working away!",
  "🌟 Sit back and relax, magic is happening!",
];

export default function EmailAuthSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [randomMessage] = useState(() => 
    playfulMessages[Math.floor(Math.random() * playfulMessages.length)]
  );
  
  const status = searchParams.get('aurinko');
  const message = searchParams.get('message');

  // If it's an error or cancelled, redirect back to onboarding
  useEffect(() => {
    if (status === 'error' || status === 'cancelled') {
      navigate('/onboarding?step=email&aurinko=' + status + (message ? '&message=' + message : ''));
    }
  }, [status, message, navigate]);

  // If opened as a popup, notify the opener and try to close automatically.
  useEffect(() => {
    if (status !== 'success') return;

    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'aurinko-auth-success' }, window.location.origin);
        window.setTimeout(() => {
          window.close();
        }, 150);
      }
    } catch {
      // ignore
    }
  }, [status]);

  const handleReturnToOnboarding = () => {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'aurinko-auth-success' }, window.location.origin);
        window.close();
        return;
      }
    } catch {
      // ignore
    }

    navigate('/onboarding?step=email&aurinko=success');
  };

  if (status !== 'success') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-4">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">Redirecting...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 text-center space-y-6">
          {/* Success Icon */}
          <div className="relative mx-auto w-fit">
            <div className="absolute inset-0 bg-success/20 rounded-full blur-xl animate-pulse" />
            <div className="relative bg-success/10 rounded-full p-4">
              <CheckCircle2 className="h-12 w-12 text-success" />
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <CardTitle className="text-2xl">Email Connected!</CardTitle>
            <CardDescription className="text-base">
              Your inbox is now linked to BizzyBee
            </CardDescription>
          </div>

          {/* What's happening */}
          <div className="bg-muted/50 rounded-lg p-4 text-left space-y-3">
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-foreground">Importing your emails</p>
                <p className="text-muted-foreground">
                  We're scanning your inbox and learning how you write
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Loader2 className="h-5 w-5 text-primary mt-0.5 shrink-0 animate-spin" />
              <div className="text-sm">
                <p className="font-medium text-foreground">Building your AI clone</p>
                <p className="text-muted-foreground">
                  This happens in the background — you can keep going!
                </p>
              </div>
            </div>
          </div>

          {/* Playful message */}
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground bg-primary/5 rounded-lg p-3">
            <Coffee className="h-4 w-4" />
            <span className="italic">{randomMessage}</span>
          </div>

          {/* CTA */}
          <Button 
            onClick={handleReturnToOnboarding}
            size="lg"
            className="w-full gap-2"
          >
            Continue Setup
            <ArrowRight className="h-4 w-4" />
          </Button>

          <p className="text-xs text-muted-foreground">
            You can track import progress on the next screen
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
