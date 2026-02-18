import React, { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Shield, Download, Trash2, Mail, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type RequestType = 'export' | 'deletion';
type PortalState = 'form' | 'submitted' | 'verified' | 'error';

export default function GDPRPortal() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const [searchParams] = useSearchParams();
  const verificationToken = searchParams.get('token');
  const action = searchParams.get('action') as RequestType | null;

  const [email, setEmail] = useState('');
  const [requestType, setRequestType] = useState<RequestType>('export');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<PortalState>(verificationToken ? 'verified' : 'form');
  const [verifying, setVerifying] = useState(!!verificationToken);

  // Handle verification token on mount
  React.useEffect(() => {
    if (verificationToken && action) {
      handleVerification(verificationToken, action);
    }
  }, [verificationToken, action]);

  const handleVerification = async (token: string, requestAction: RequestType) => {
    setVerifying(true);
    try {
      // GDPR portal migrated to n8n
      toast.info('GDPR portal migrated to n8n');
      setState('form');
    } finally {
      setVerifying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim()) {
      toast.error('Please enter your email address');
      return;
    }

    setLoading(true);
    try {
      // GDPR portal migrated to n8n
      toast.info('GDPR portal migrated to n8n');
      return;
    } finally {
      setLoading(false);
    }
  };

  if (verifying) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Verifying your request...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === 'verified') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Request Confirmed</h2>
            <p className="text-muted-foreground text-center">
              {action === 'export' 
                ? 'Your data export is being prepared. You will receive an email with a download link shortly.'
                : 'Your deletion request has been submitted. We will process it within 30 days as required by GDPR.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-16 w-16 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Verification Failed</h2>
            <p className="text-muted-foreground text-center mb-4">
              The verification link may have expired or is invalid. Please submit a new request.
            </p>
            <Button onClick={() => setState('form')}>
              Submit New Request
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === 'submitted') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Mail className="h-16 w-16 text-primary mb-4" />
            <h2 className="text-xl font-semibold mb-2">Check Your Email</h2>
            <p className="text-muted-foreground text-center mb-4">
              We've sent a verification email to <strong>{email}</strong>. 
              Please click the link in the email to confirm your request.
            </p>
            <p className="text-sm text-muted-foreground text-center">
              The link will expire in 24 hours. Check your spam folder if you don't see the email.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-primary/10 rounded-full">
              <Shield className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Your Data Rights</CardTitle>
          <CardDescription>
            Exercise your GDPR rights. Request a copy of your data or request deletion.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="your.email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Enter the email address associated with your account
              </p>
            </div>

            <div className="space-y-3">
              <Label>What would you like to do?</Label>
              <RadioGroup
                value={requestType}
                onValueChange={(v) => setRequestType(v as RequestType)}
                disabled={loading}
              >
                <div className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  <RadioGroupItem value="export" id="export" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="export" className="flex items-center gap-2 cursor-pointer">
                      <Download className="h-4 w-4 text-primary" />
                      <span className="font-medium">Export My Data</span>
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Receive a copy of all your personal data in a portable format (JSON)
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  <RadioGroupItem value="deletion" id="deletion" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="deletion" className="flex items-center gap-2 cursor-pointer">
                      <Trash2 className="h-4 w-4 text-destructive" />
                      <span className="font-medium">Delete My Data</span>
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Request permanent deletion of your personal data (processed within 30 days)
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            {requestType === 'deletion' && (
              <div className="space-y-2">
                <Label htmlFor="reason">Reason (optional)</Label>
                <Textarea
                  id="reason"
                  placeholder="Let us know why you're requesting deletion..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={loading}
                  rows={3}
                />
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending verification...
                </>
              ) : (
                'Submit Request'
              )}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              By submitting, you confirm that you are the owner of this email address. 
              We will send a verification link to confirm your identity.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
