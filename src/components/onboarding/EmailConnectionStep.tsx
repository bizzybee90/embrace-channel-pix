import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Mail, CheckCircle2, Loader2, RefreshCw, ArrowRight, AlertCircle, RotateCcw, StopCircle } from 'lucide-react';
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
type ImportMode = 'new_only' | 'unread_only' | 'all_historical_30_days' | 'all_historical_90_days' | 'last_1000' | 'all_history';

interface ImportJob {
  id: string;
  status: string;
  inbox_emails_scanned: number;
  sent_emails_scanned: number;
  total_threads_found: number;
  conversation_threads: number;
  bodies_fetched: number;
  messages_created: number;
  error_message: string | null;
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
    timeEstimate: '15-20 mins',
    recommended: false
  },
  { 
    value: 'last_1000' as ImportMode, 
    label: 'Last 1,000 emails', 
    description: 'Great balance of learning data and speed',
    timeEstimate: '5-10 mins',
    recommended: true
  },
  { 
    value: 'all_historical_90_days' as ImportMode, 
    label: 'Last 90 days', 
    description: 'Import all emails from the past 3 months',
    timeEstimate: '10-15 mins'
  },
  { 
    value: 'all_historical_30_days' as ImportMode, 
    label: 'Last 30 days', 
    description: 'A lighter import for smaller inboxes',
    timeEstimate: '5-10 mins'
  },
  { 
    value: 'unread_only' as ImportMode, 
    label: 'Unread emails only', 
    description: 'Quick start — just your current unread messages',
    timeEstimate: '1-2 mins'
  },
  { 
    value: 'new_only' as ImportMode, 
    label: 'New emails only', 
    description: 'Only receive new emails going forward (no history)',
    timeEstimate: 'Instant'
  },
];

// Calculate progress percentage based on job status
function calculateProgress(job: ImportJob): number {
  switch (job.status) {
    case 'queued': return 0;
    case 'scanning_inbox':
    case 'scanning_sent':
      return Math.min(30, Math.floor((job.inbox_emails_scanned + job.sent_emails_scanned) / 500));
    case 'analyzing': return 35;
    case 'fetching':
      if (job.conversation_threads > 0) {
        return Math.min(95, 40 + (job.bodies_fetched / job.conversation_threads) * 55);
      }
      return 40;
    case 'completed': return 100;
    case 'error': return -1;
    default: return 0;
  }
}

// Get human-readable status message
function getStatusMessage(job: ImportJob): string {
  switch (job.status) {
    case 'queued': return 'Preparing...';
    case 'scanning_inbox': return `Scanning inbox... ${job.inbox_emails_scanned.toLocaleString()} found`;
    case 'scanning_sent': return `Scanning sent... ${job.sent_emails_scanned.toLocaleString()} found`;
    case 'analyzing': return `Analyzing ${(job.inbox_emails_scanned + job.sent_emails_scanned).toLocaleString()} emails...`;
    case 'fetching': return `Importing ${job.bodies_fetched} of ${job.conversation_threads} conversations`;
    case 'completed': return `Done! ${job.messages_created} messages imported`;
    case 'error': return 'Failed: ' + (job.error_message || 'Unknown error');
    default: return job.status;
  }
}

export function EmailConnectionStep({ 
  workspaceId, 
  onNext, 
  onBack,
  onEmailConnected 
}: EmailConnectionStepProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [connectedConfigId, setConnectedConfigId] = useState<string | null>(null);
  const [connectedImportMode, setConnectedImportMode] = useState<ImportMode | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('last_1000');
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  
  // New job-based state
  const [importJob, setImportJob] = useState<ImportJob | null>(null);

  const connectedEmailRef = useRef<string | null>(null);
  const connectTimeoutRef = useRef<number | undefined>(undefined);
  const popupRef = useRef<Window | null>(null);
  const popupPollRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    connectedEmailRef.current = connectedEmail;
  }, [connectedEmail]);

  const handleConnect = async (provider: Provider) => {
    setIsConnecting(true);
    setSelectedProvider(provider);

    if (connectTimeoutRef.current) window.clearTimeout(connectTimeoutRef.current);
    if (popupPollRef.current) window.clearInterval(popupPollRef.current);
    popupPollRef.current = undefined;
    connectTimeoutRef.current = undefined;
    popupRef.current = null;

    try {
      const authEndpoint = 'aurinko-auth-start';
      
      const { data, error } = await supabase.functions.invoke(authEndpoint, {
        body: {
          workspaceId,
          provider,
          importMode,
          origin: window.location.origin,
        },
      });

      if (error) throw error;

      if (data?.authUrl) {
        localStorage.setItem('onboarding_email_pending', 'true');
        localStorage.setItem('onboarding_workspace_id', workspaceId);
        localStorage.setItem('onboarding_import_mode', importMode);

        const isEmbedded = (() => {
          try {
            return window.self !== window.top;
          } catch {
            return true;
          }
        })();

        if (isEmbedded) {
          const popup = window.open(data.authUrl, '_blank', 'noopener,noreferrer');
          if (!popup) {
            toast.error('Popup blocked — please allow popups and try again.');
            setIsConnecting(false);
            return;
          }
          toast.message('Complete the email connection in the new tab, then come back here.');
        } else {
          window.location.href = data.authUrl;
        }
      }
    } catch (error) {
      console.error('Error starting OAuth:', error);
      toast.error('Failed to start email connection');
      setIsConnecting(false);
    }
  };

  const checkEmailConnection = async () => {
    setCheckingConnection(true);
    try {
      const { data, error } = await supabase
        .from('email_provider_configs')
        .select('id, import_mode, email_address, sync_status, sync_error')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data?.email_address) {
        setConnectedEmail(data.email_address);
        setConnectedConfigId(data.id);
        setConnectedImportMode((data.import_mode as ImportMode) || null);
        onEmailConnected(data.email_address);

        if (connectTimeoutRef.current) window.clearTimeout(connectTimeoutRef.current);
        if (popupPollRef.current) window.clearInterval(popupPollRef.current);
        connectTimeoutRef.current = undefined;
        popupPollRef.current = undefined;
        popupRef.current = null;

        // Fetch the latest import job
        await fetchLatestImportJob(data.id);

        if (!connectedEmail) {
          toast.success(`Connected to ${data.email_address}`);
        }
        localStorage.removeItem('onboarding_email_pending');
        localStorage.removeItem('onboarding_workspace_id');
      }
    } catch (error) {
      console.error('Error checking connection:', error);
    } finally {
      setCheckingConnection(false);
      setInitialLoading(false);
    }
  };

  const fetchLatestImportJob = async (configId: string) => {
    const { data: job, error } = await supabase
      .from('email_import_jobs')
      .select('id, status, inbox_emails_scanned, sent_emails_scanned, total_threads_found, conversation_threads, bodies_fetched, messages_created, error_message')
      .eq('config_id', configId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && job) {
      setImportJob(job as ImportJob);
    }
  };

  const handleStopSync = async () => {
    if (!connectedConfigId || !importJob?.id) return;
    try {
      toast.message('Stopping sync…');
      
      await supabase
        .from('email_import_jobs')
        .update({ 
          status: 'cancelled',
          error_message: 'Stopped by user'
        })
        .eq('id', importJob.id);
      
      await supabase
        .from('email_provider_configs')
        .update({
          sync_status: 'completed',
          sync_stage: 'complete',
          sync_completed_at: new Date().toISOString(),
          active_job_id: null,
        })
        .eq('id', connectedConfigId);
      
      toast.success('Sync stopped. You can continue with the imported emails.');
      await fetchLatestImportJob(connectedConfigId);
    } catch (e) {
      console.error(e);
      toast.error('Could not stop the sync.');
    }
  };

  const handleRetrySync = async () => {
    if (!connectedConfigId) return;
    try {
      toast.message('Restarting sync…');

      // Use the new 3-phase import system
      const { data, error } = await supabase.functions.invoke('start-email-import', {
        body: {
          configId: connectedConfigId,
          mode: connectedImportMode || 'all',
        },
      });

      if (error) throw error;

      await fetchLatestImportJob(connectedConfigId);
      toast.success('Sync restarted!');
    } catch (e: any) {
      console.error(e);
      const msg = typeof e?.message === 'string' ? e.message : 'Could not restart the sync.';
      toast.error(msg);
    }
  };

  // Poll for job status when connected
  useEffect(() => {
    checkEmailConnection();

    const pending = localStorage.getItem('onboarding_email_pending') === 'true';

    let connectInterval: number | undefined;
    if (isConnecting || pending) {
      connectInterval = window.setInterval(() => {
        checkEmailConnection();
      }, 2000);

      window.setTimeout(() => {
        if (connectInterval) window.clearInterval(connectInterval);
      }, 120000);
    }

    // Poll for import job progress
    if (connectedConfigId) {
      const interval = setInterval(async () => {
        await fetchLatestImportJob(connectedConfigId);
      }, 2000);

      return () => {
        clearInterval(interval);
        if (connectInterval) window.clearInterval(connectInterval);
      };
    }

    return () => {
      if (connectInterval) window.clearInterval(connectInterval);
    };
  }, [isConnecting, connectedConfigId, connectedImportMode]);

  // Handle OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    
    const aurinko = params.get('aurinko');
    if (aurinko === 'success') {
      toast.success('Email connected successfully');
      localStorage.removeItem('onboarding_email_pending');
      params.delete('aurinko');
      params.delete('message');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', newUrl);
      checkEmailConnection();
    }
    if (aurinko === 'error') {
      const errorMessage = params.get('message') || 'Email connection failed';
      toast.error(errorMessage, { duration: 8000 });
      console.error('Aurinko OAuth error:', errorMessage);
      localStorage.removeItem('onboarding_email_pending');
      params.delete('aurinko');
      params.delete('message');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', newUrl);
      setIsConnecting(false);
    }
    if (aurinko === 'cancelled') {
      toast.info('Email connection was cancelled');
      localStorage.removeItem('onboarding_email_pending');
      params.delete('aurinko');
      params.delete('message');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', newUrl);
      setIsConnecting(false);
    }
  }, []);

  // Listen for OAuth completion message from popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'aurinko-auth-success') {
        checkEmailConnection();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

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

  const isImporting = importJob && ['queued', 'scanning_inbox', 'scanning_sent', 'analyzing', 'fetching'].includes(importJob.status);
  const importComplete = importJob?.status === 'completed';
  const importError = importJob?.status === 'error';
  const progress = importJob ? calculateProgress(importJob) : 0;
  const statusMessage = importJob ? getStatusMessage(importJob) : '';

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
            <span className="font-medium">Heads up:</span> A secure login window will open in a popup or new tab. If you don't see it, check if your browser blocked the popup.
          </div>
        </div>
      )}

      {connectedEmail ? (
        <div className="space-y-6">
          <div className="flex items-center justify-center gap-3 p-4 bg-success/10 rounded-lg border border-success/30">
            <CheckCircle2 className="h-6 w-6 text-success" />
            <div className="text-center">
              <p className="font-medium text-foreground">Email Connected!</p>
              <p className="text-sm text-muted-foreground">{connectedEmail}</p>
            </div>
          </div>

          {/* Error State */}
          {importError && importJob && (
            <div className="space-y-4 p-4 bg-destructive/10 rounded-lg border border-destructive/30">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <span className="font-medium">Import encountered an error</span>
              </div>
              
              {importJob.error_message && (
                <p className="text-sm text-muted-foreground">
                  {importJob.error_message}
                </p>
              )}
              
              <div className="text-sm text-muted-foreground">
                <p>Progress before error:</p>
                <p className="font-medium">
                  {importJob.inbox_emails_scanned.toLocaleString()} inbox, {importJob.sent_emails_scanned.toLocaleString()} sent scanned
                </p>
              </div>
              
              <Button onClick={handleRetrySync} className="w-full gap-2">
                <RotateCcw className="h-4 w-4" />
                Retry Import
              </Button>
            </div>
          )}

          {/* Import Progress */}
          {isImporting && importJob && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg border">
              {/* Current phase indicator */}
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="font-medium text-sm">{statusMessage}</span>
              </div>

              {/* Progress stats */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-background/50 rounded p-2">
                  <div className="font-semibold text-foreground flex items-center gap-1">
                    {importJob.inbox_emails_scanned.toLocaleString()}
                    {importJob.status === 'scanning_inbox' && (
                      <span className="text-muted-foreground animate-pulse">+</span>
                    )}
                  </div>
                  <div className="text-muted-foreground">Inbox emails</div>
                </div>
                <div className="bg-background/50 rounded p-2">
                  <div className="font-semibold text-foreground flex items-center gap-1">
                    {importJob.sent_emails_scanned.toLocaleString()}
                    {importJob.status === 'scanning_sent' && (
                      <span className="text-muted-foreground animate-pulse">+</span>
                    )}
                  </div>
                  <div className="text-muted-foreground">Sent emails</div>
                </div>
              </div>

              {/* Show conversation threads after analysis */}
              {importJob.conversation_threads > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                  <p className="text-xs font-medium text-primary">
                    Found {importJob.conversation_threads.toLocaleString()} conversations with your replies
                  </p>
                  {importJob.status === 'fetching' && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Importing {importJob.bodies_fetched} of {importJob.conversation_threads}...
                    </p>
                  )}
                </div>
              )}

              {/* Progress bar */}
              {progress > 0 && progress < 100 && (
                <div className="space-y-1">
                  <Progress value={progress} className="h-2" />
                  <p className="text-xs text-center text-muted-foreground">
                    {progress}% complete
                  </p>
                </div>
              )}

              {/* Live indicator */}
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span>Actively importing</span>
              </div>

              {/* Stop button */}
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleStopSync}
                className="gap-1 text-xs"
              >
                <StopCircle className="h-3 w-3" />
                Stop & use imported emails
              </Button>

              <div className="text-center space-y-1">
                <p className="text-xs text-muted-foreground">
                  You can continue while we import in the background.
                </p>
                <p className="text-xs text-muted-foreground/70 italic">
                  ☕ Perfect time for a coffee break!
                </p>
              </div>
            </div>
          )}

          {/* Import Complete */}
          {importComplete && importJob && (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 p-3 bg-success/5 rounded-lg border border-success/20 text-success text-sm">
                <CheckCircle2 className="h-4 w-4" />
                <span>Import complete!</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-muted/30 rounded p-2">
                  <div className="font-semibold text-foreground">{importJob.inbox_emails_scanned.toLocaleString()}</div>
                  <div className="text-muted-foreground">Inbox scanned</div>
                </div>
                <div className="bg-muted/30 rounded p-2">
                  <div className="font-semibold text-foreground">{importJob.conversation_threads.toLocaleString()}</div>
                  <div className="text-muted-foreground">Conversations</div>
                </div>
                <div className="bg-muted/30 rounded p-2">
                  <div className="font-semibold text-foreground">{importJob.messages_created.toLocaleString()}</div>
                  <div className="text-muted-foreground">Messages</div>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button onClick={onNext} className="flex-1 gap-2">
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Import Mode Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">How many emails should we import?</Label>
            <RadioGroup
              value={importMode}
              onValueChange={(value) => setImportMode(value as ImportMode)}
              className="space-y-2"
            >
              {importModes.map((mode) => (
                <div 
                  key={mode.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    importMode === mode.value 
                      ? 'border-primary/50 bg-primary/5' 
                      : 'hover:bg-accent/50'
                  } ${mode.recommended ? 'ring-1 ring-primary/30' : ''}`}
                  onClick={() => setImportMode(mode.value)}
                >
                  <RadioGroupItem value={mode.value} id={mode.value} className="mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={mode.value} className="font-medium cursor-pointer">
                          {mode.label}
                        </Label>
                        {mode.recommended && (
                          <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            Recommended
                          </span>
                        )}
                      </div>
                      {'timeEstimate' in mode && mode.timeEstimate && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded whitespace-nowrap">
                          {mode.timeEstimate}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{mode.description}</p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Provider Selection */}
          <div className="grid grid-cols-2 gap-3">
            {emailProviders.map((provider) => (
              <Button
                key={provider.id}
                variant="outline"
                size="lg"
                className={`h-auto py-5 flex-col gap-2 relative ${
                  provider.comingSoon ? 'opacity-60 cursor-not-allowed' : ''
                }`}
                disabled={isConnecting || provider.comingSoon}
                onClick={() => provider.available && handleConnect(provider.id)}
              >
                {provider.comingSoon && (
                  <span className="absolute top-2 right-2 text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    Soon
                  </span>
                )}
                {isConnecting && selectedProvider === provider.id ? (
                  <Loader2 className="h-7 w-7 animate-spin" />
                ) : provider.icon ? (
                  <img src={provider.icon} alt={provider.name} className="h-7 w-7" />
                ) : (
                  <Mail className={`h-7 w-7 ${provider.iconColor || 'text-muted-foreground'}`} />
                )}
                <span className="font-medium text-sm">{provider.name}</span>
              </Button>
            ))}
          </div>

          {checkingConnection && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">Checking connection...</span>
            </div>
          )}

          <p className="text-xs text-center text-muted-foreground">
            We use secure OAuth - we never see your password.
            <br />
            You can disconnect anytime in Settings.
          </p>

          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button variant="ghost" onClick={onNext} className="flex-1">
              Skip for now
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
