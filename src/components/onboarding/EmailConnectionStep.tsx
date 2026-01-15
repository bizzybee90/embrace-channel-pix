import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Mail, CheckCircle2, Loader2, ArrowRight, AlertCircle, RotateCcw } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

interface EmailConnectionStepProps {
  workspaceId: string;
  onNext: () => void;
  onBack: () => void;
  onEmailConnected: (email: string) => void;
}

type Provider = 'gmail' | 'outlook' | 'icloud' | 'yahoo';
type ImportMode = 'new_only' | 'last_1000' | 'last_10000' | 'last_30000' | 'all_history';

interface MakeProgress {
  status: string;
  emails_imported: number;
  emails_classified: number;
  emails_total: number;
  voice_profile_complete: boolean;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

const emailProviders = [
  { 
    id: 'gmail' as Provider, 
    name: 'Gmail', 
    icon: 'https://www.google.com/gmail/about/static-2.0/images/logo-gmail.png',
    available: true 
  },
  { 
    id: 'outlook' as Provider, 
    name: 'Outlook', 
    icon: null,
    iconColor: 'text-blue-600',
    available: true 
  },
  { 
    id: 'icloud' as Provider, 
    name: 'iCloud Mail', 
    icon: null,
    iconColor: 'text-sky-500',
    available: true
  },
  { 
    id: 'yahoo' as Provider, 
    name: 'Yahoo Mail', 
    icon: null,
    iconColor: 'text-purple-600',
    available: false,
    comingSoon: true
  },
];

const importModes = [
  { 
    value: 'all_history' as ImportMode, 
    label: 'Entire email history', 
    description: 'Import everything — best for maximum AI accuracy',
    timeEstimate: '~90 mins',
    recommended: false
  },
  { 
    value: 'last_30000' as ImportMode, 
    label: 'Last 30,000 emails', 
    description: 'Comprehensive learning with great coverage',
    timeEstimate: '~65 mins',
    recommended: true
  },
  { 
    value: 'last_10000' as ImportMode, 
    label: 'Last 10,000 emails', 
    description: 'Strong learning data with faster import',
    timeEstimate: '~25 mins'
  },
  { 
    value: 'last_1000' as ImportMode, 
    label: 'Last 1,000 emails', 
    description: 'Quick start with decent learning data',
    timeEstimate: '~10 mins'
  },
  { 
    value: 'new_only' as ImportMode, 
    label: 'New emails only', 
    description: 'Only receive new emails going forward (no history)',
    timeEstimate: 'Instant'
  },
];

// Make.com webhook URL
const MAKE_WEBHOOK_URL = 'https://hook.eu2.make.com/ya89bi65tcxsmyet08ii9jtijsscbv2b';

// Aurinko OAuth config - uses fixed published URL for consistent callback
const AURINKO_CLIENT_ID = '6e9db931edb62a956bdac105ddda0354';
const AURINKO_REDIRECT_URI = 'https://ikioetqbrybnofqkdcib.supabase.co/functions/v1/aurinko-auth-callback';

export function EmailConnectionStep({ 
  workspaceId, 
  onNext, 
  onBack,
  onEmailConnected 
}: EmailConnectionStepProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('last_1000');
  const [initialLoading, setInitialLoading] = useState(true);
  const [importStarted, setImportStarted] = useState(false);
  const [progress, setProgress] = useState<MakeProgress | null>(null);

  const toastedEmailRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<number | undefined>(undefined);

  // Check for existing connection on mount
  useEffect(() => {
    checkEmailConnection(true);
  }, [workspaceId]);

  // Poll make_progress when import is started
  useEffect(() => {
    if (!importStarted || !workspaceId) return;

    const poll = async () => {
      const { data, error } = await supabase
        .from('make_progress')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (!error && data) {
        setProgress(data as MakeProgress);
        
        // Stop polling if complete or error
        if (data.status === 'complete' || data.status === 'error') {
          if (pollIntervalRef.current) {
            window.clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = undefined;
          }
        }
      }
    };

    // Initial poll
    poll();

    // Poll every 3 seconds
    pollIntervalRef.current = window.setInterval(poll, 3000);

    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
  }, [importStarted, workspaceId]);

  // Handle OAuth redirect params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const aurinko = params.get('aurinko');
    
    if (aurinko === 'success') {
      toast.success('Email connected successfully');
      params.delete('aurinko');
      params.delete('message');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', newUrl);
      checkEmailConnection();
    } else if (aurinko === 'error') {
      const errorMessage = params.get('message') || 'Email connection failed';
      toast.error(errorMessage, { duration: 8000 });
      params.delete('aurinko');
      params.delete('message');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', newUrl);
      setIsConnecting(false);
    }
  }, []);

  const checkEmailConnection = async (isInitialLoad = false) => {
    try {
      const [configResult, progressResult] = await Promise.all([
        supabase
          .from('email_provider_configs')
          .select('id, import_mode, email_address, sync_status')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('make_progress')
          .select('*')
          .eq('workspace_id', workspaceId)
          .maybeSingle()
      ]);

      if (!progressResult.error && progressResult.data) {
        setProgress(progressResult.data as MakeProgress);
        if (progressResult.data.status !== 'idle') {
          setImportStarted(true);
        }
      }

      if (!configResult.error && configResult.data?.email_address) {
        const email = configResult.data.email_address;
        setConnectedEmail(email);
        onEmailConnected(email);
        
        if (toastedEmailRef.current !== email && !isInitialLoad) {
          toastedEmailRef.current = email;
          toast.success(`Connected to ${email}`);
        }
      }
    } catch (error) {
      console.error('Error checking connection:', error);
    } finally {
      setInitialLoading(false);
      setIsConnecting(false);
    }
  };

  const handleConnect = async (provider: Provider) => {
    setIsConnecting(true);
    setSelectedProvider(provider);

    try {
      // Build OAuth URL directly (original working flow)
    const state = btoa(JSON.stringify({
      workspaceId,
      importMode,
      provider,
      origin: window.location.origin
    }));

      const serviceType = provider === 'gmail' ? 'Google' : 
                          provider === 'outlook' ? 'Office365' : 
                          provider === 'icloud' ? 'iCloud' : 'Google';

      const authUrl = `https://api.aurinko.io/v1/auth/authorize?` + 
        `clientId=${AURINKO_CLIENT_ID}` +
        `&serviceType=${serviceType}` +
        `&scopes=Mail.ReadWrite Mail.Send` +
        `&responseType=code` +
        `&returnUrl=${encodeURIComponent(AURINKO_REDIRECT_URI)}` +
        `&state=${encodeURIComponent(state)}`;

      // Check if in iframe
      const isEmbedded = (() => {
        try { return window.self !== window.top; } catch { return true; }
      })();

      if (isEmbedded) {
        const popup = window.open(authUrl, '_blank', 'noopener,noreferrer');
        if (!popup) {
          toast.error('Popup blocked — please allow popups and try again.');
          setIsConnecting(false);
          return;
        }
        toast.message('Complete the email connection in the new tab, then come back here.');
      } else {
        window.location.href = authUrl;
      }
    } catch (error) {
      console.error('Error starting OAuth:', error);
      toast.error('Failed to start email connection');
      setIsConnecting(false);
    }
  };

  const startImport = async () => {
    if (!workspaceId || importStarted) return;
    
    setImportStarted(true);
    
    try {
      // Trigger Make.com webhook
      const response = await fetch(MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          import_mode: importMode
        })
      });

      if (!response.ok) {
        throw new Error('Failed to trigger import');
      }

      toast.success('Starting email import...');
    } catch (error) {
      console.error('Error starting import:', error);
      toast.error('Failed to start email import');
      setImportStarted(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await Promise.all([
        supabase.from('email_provider_configs').delete().eq('workspace_id', workspaceId),
        supabase.from('make_progress').delete().eq('workspace_id', workspaceId)
      ]);

      setConnectedEmail(null);
      setProgress(null);
      setImportStarted(false);
      toastedEmailRef.current = null;
      toast.success('Email disconnected');
    } catch (error) {
      toast.error('Failed to disconnect');
    }
  };

  const handleRetry = async () => {
    try {
      await supabase
        .from('make_progress')
        .update({ 
          status: 'idle', 
          error_message: null,
          updated_at: new Date().toISOString()
        })
        .eq('workspace_id', workspaceId);
      
      setImportStarted(false);
      setProgress(null);
      await startImport();
    } catch (error) {
      toast.error('Failed to retry import');
    }
  };

  // Loading state
  if (initialLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl">Connect Your Email</CardTitle>
          <CardDescription className="mt-2">
            BizzyBee will learn from your inbox to handle emails just like you would.
          </CardDescription>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">Checking connection...</span>
        </div>
      </div>
    );
  }

  // Calculate progress percentage
  const progressPercent = progress?.emails_total 
    ? Math.round((progress.emails_imported / progress.emails_total) * 100)
    : 0;

  const isImporting = progress?.status === 'importing' || progress?.status === 'classifying' || progress?.status === 'learning';
  const isComplete = progress?.status === 'complete';
  const isError = progress?.status === 'error';

  return (
    <div className="space-y-6">
      <div className="text-center">
        <CardTitle className="text-xl">Connect Your Email</CardTitle>
        <CardDescription className="mt-2">
          BizzyBee will learn from your inbox to handle emails just like you would.
        </CardDescription>
      </div>

      {!connectedEmail && !isConnecting && (
        <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800 text-sm">
          <div className="shrink-0 mt-0.5">
            <svg className="h-4 w-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="text-blue-800 dark:text-blue-200">
            <span className="font-medium">Heads up:</span> A secure login window will open in a popup or new tab.
          </div>
        </div>
      )}

      {connectedEmail ? (
        <div className="space-y-6">
          {/* Connected status */}
          <div className="flex items-center justify-between gap-3 p-4 bg-success/10 rounded-lg border border-success/30">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-success" />
              <div>
                <p className="font-medium text-foreground">Email Connected!</p>
                <p className="text-sm text-muted-foreground">{connectedEmail}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-destructive"
              onClick={handleDisconnect}
            >
              Disconnect
            </Button>
          </div>

          {/* Start Import button */}
          {!importStarted && !progress && (
            <div className="space-y-4">
              <Button onClick={startImport} className="w-full gap-2">
                Start Learning from Emails
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={onNext} className="w-full">
                Skip for Now
              </Button>
            </div>
          )}

          {/* Import Progress */}
          {isImporting && progress && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg border">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="font-medium text-sm">
                  {progress.status === 'importing' && `Importing emails... ${progress.emails_imported.toLocaleString()}`}
                  {progress.status === 'classifying' && `Classifying... ${progress.emails_classified.toLocaleString()}`}
                  {progress.status === 'learning' && 'Learning your style...'}
                </span>
              </div>

              {progressPercent > 0 && (
                <div className="space-y-1">
                  <Progress value={progressPercent} className="h-2" />
                  <p className="text-xs text-center text-muted-foreground">
                    {progressPercent}% complete
                  </p>
                </div>
              )}

              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span>Actively importing</span>
              </div>

              <p className="text-xs text-center text-muted-foreground">
                You can continue while we import in the background.
              </p>
            </div>
          )}

          {/* Error state */}
          {isError && progress && (
            <div className="space-y-4 p-4 bg-destructive/10 rounded-lg border border-destructive/30">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <span className="font-medium">Import encountered an error</span>
              </div>
              {progress.error_message && (
                <p className="text-sm text-muted-foreground">{progress.error_message}</p>
              )}
              <Button onClick={handleRetry} className="w-full gap-2">
                <RotateCcw className="h-4 w-4" />
                Retry Import
              </Button>
            </div>
          )}

          {/* Complete state */}
          {isComplete && progress && (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-2 p-3 bg-success/5 rounded-lg border border-success/20 text-success text-sm">
                <CheckCircle2 className="h-4 w-4" />
                <span>Import complete!</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                <div className="bg-muted/30 rounded p-2">
                  <div className="font-semibold text-foreground">{progress.emails_imported.toLocaleString()}</div>
                  <div className="text-muted-foreground">Emails imported</div>
                </div>
                <div className="bg-muted/30 rounded p-2">
                  <div className="font-semibold text-foreground">{progress.emails_classified.toLocaleString()}</div>
                  <div className="text-muted-foreground">Emails classified</div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          {(isImporting || isComplete || isError) && (
            <div className="flex gap-3">
              <Button variant="outline" onClick={onBack} className="flex-1">
                Back
              </Button>
              <Button onClick={onNext} className="flex-1 gap-2">
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Import Mode Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">How much email history should we learn from?</Label>
            <RadioGroup value={importMode} onValueChange={(v) => setImportMode(v as ImportMode)} className="space-y-2">
              {importModes.map((mode) => (
                <div 
                  key={mode.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    importMode === mode.value 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover:border-muted-foreground/50'
                  }`}
                  onClick={() => setImportMode(mode.value)}
                >
                  <RadioGroupItem value={mode.value} id={mode.value} className="mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={mode.value} className="font-medium cursor-pointer">
                        {mode.label}
                      </Label>
                      {mode.recommended && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{mode.description}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">{mode.timeEstimate}</p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Provider Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Select your email provider</Label>
            <div className="grid grid-cols-2 gap-3">
              {emailProviders.map((provider) => (
                <Button
                  key={provider.id}
                  variant="outline"
                  className="h-auto py-4 flex flex-col items-center gap-2 relative"
                  onClick={() => handleConnect(provider.id)}
                  disabled={!provider.available || isConnecting}
                >
                  {provider.comingSoon && (
                    <span className="absolute top-1 right-1 text-[10px] bg-muted px-1.5 py-0.5 rounded">
                      Soon
                    </span>
                  )}
                  {isConnecting && selectedProvider === provider.id ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : provider.icon ? (
                    <img src={provider.icon} alt={provider.name} className="h-6 w-6 object-contain" />
                  ) : (
                    <Mail className={`h-6 w-6 ${provider.iconColor || ''}`} />
                  )}
                  <span className="text-sm font-medium">{provider.name}</span>
                </Button>
              ))}
            </div>
          </div>

          <Button variant="outline" onClick={onBack} className="w-full">
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
