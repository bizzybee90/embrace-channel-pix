import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Mail, CheckCircle2, Loader2, RefreshCw, ArrowRight } from 'lucide-react';
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
    timeEstimate: '30-45 mins',
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
    timeEstimate: '10-20 mins'
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
  const [syncStatus, setSyncStatus] = useState<{
    status: string;
    stage: string;
    progress: number;
    total: number;
    inboundFound: number;
    outboundFound: number;
    inboundTotal: number;
    outboundTotal: number;
    threadsLinked: number;
    voiceProfileStatus: string;
    activeJobId?: string | null;
    lastSyncAt?: string | null;
    syncStartedAt?: string | null;
    syncError?: string | null;
  } | null>(null);

  const [onboardingProgress, setOnboardingProgress] = useState<{
    emailImportStatus: string;
    emailImportProgress: number;
    threadMatchingStatus: string;
    threadMatchingProgress: number;
    pairsMatched: number;
    categorizationStatus: string;
    categorizationProgress: number;
    styleAnalysisStatus: string;
    fewShotStatus: string;
    responseRatePercent: number | null;
    avgResponseTimeHours: number | null;
    topCategories: Array<{ category: string; count: number }>;
  } | null>(null);

  const connectedEmailRef = useRef<string | null>(null);
  const connectTimeoutRef = useRef<number | undefined>(undefined);
  const popupRef = useRef<Window | null>(null);
  const popupPollRef = useRef<number | undefined>(undefined);
  const lastProgressRef = useRef<{ progress: number; at: number }>({ progress: 0, at: Date.now() });

  useEffect(() => {
    connectedEmailRef.current = connectedEmail;
  }, [connectedEmail]);

  const parseTopCategories = (value: unknown): Array<{ category: string; count: number }> => {
    if (!Array.isArray(value)) return [];
    return value
      .map((v) => ({
        category: typeof (v as any)?.category === 'string' ? (v as any).category : '',
        count: typeof (v as any)?.count === 'number' ? (v as any).count : 0,
      }))
      .filter((v) => v.category);
  };

  const handleConnect = async (provider: Provider) => {
    setIsConnecting(true);
    setSelectedProvider(provider);

    // Clear any previous attempt timers
    if (connectTimeoutRef.current) window.clearTimeout(connectTimeoutRef.current);
    if (popupPollRef.current) window.clearInterval(popupPollRef.current);
    popupPollRef.current = undefined;
    connectTimeoutRef.current = undefined;
    popupRef.current = null;

    try {
      // Use Gmail direct API for Gmail, Aurinko for others
      const authEndpoint = provider === 'gmail' ? 'gmail-auth-start' : 'aurinko-auth-start';
      
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
        // Store that we're expecting a callback
        localStorage.setItem('onboarding_email_pending', 'true');
        localStorage.setItem('onboarding_workspace_id', workspaceId);

        // Open OAuth in popup
        const popup = window.open(data.authUrl, 'email_oauth', 'width=600,height=700,left=200,top=100');
        popupRef.current = popup;

        // Check if popup was blocked
        if (!popup || popup.closed || typeof popup.closed === 'undefined') {
          toast.info('Opening in new tab instead...');
          window.open(data.authUrl, '_blank');
          setIsConnecting(false);
          return;
        }

        // Poll for completion
        popupPollRef.current = window.setInterval(async () => {
          if (popup?.closed) {
            if (popupPollRef.current) window.clearInterval(popupPollRef.current);
            popupPollRef.current = undefined;
            setIsConnecting(false);
            await checkEmailConnection();
          }
        }, 1000);

        // Timeout after 5 minutes (but don't false-alarm if it actually succeeded)
        connectTimeoutRef.current = window.setTimeout(async () => {
          if (popupPollRef.current) window.clearInterval(popupPollRef.current);
          popupPollRef.current = undefined;

          // One last check before showing any error
          await checkEmailConnection();
          const stillPending = localStorage.getItem('onboarding_email_pending') === 'true';
          if (stillPending && !connectedEmailRef.current) {
            setIsConnecting(false);
            toast.error('Connection timed out. Please try again.');
          }
        }, 300000);
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
        .select('id, import_mode, email_address, sync_status, sync_stage, sync_progress, sync_total, inbound_emails_found, outbound_emails_found, inbound_total, outbound_total, threads_linked, voice_profile_status, last_sync_at, sync_started_at, sync_error, active_job_id')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;

      if (data?.email_address) {
        setConnectedEmail(data.email_address);
        setConnectedConfigId(data.id);
        setConnectedImportMode((data.import_mode as ImportMode) || null);
        onEmailConnected(data.email_address);

        // Stop any connection timers (prevents false "timed out" toasts)
        if (connectTimeoutRef.current) window.clearTimeout(connectTimeoutRef.current);
        if (popupPollRef.current) window.clearInterval(popupPollRef.current);
        connectTimeoutRef.current = undefined;
        popupPollRef.current = undefined;
        popupRef.current = null;

        // Update sync status with detailed info
        if (data.sync_status) {
          const next = {
            status: data.sync_status,
            stage: data.sync_stage || 'pending',
            progress: data.sync_progress || 0,
            total: data.sync_total || 0,
            inboundFound: data.inbound_emails_found || 0,
            outboundFound: data.outbound_emails_found || 0,
            inboundTotal: data.inbound_total || 0,
            outboundTotal: data.outbound_total || 0,
            threadsLinked: data.threads_linked || 0,
            voiceProfileStatus: data.voice_profile_status || 'pending',
            activeJobId: data.active_job_id || null,
            lastSyncAt: data.last_sync_at || null,
            syncStartedAt: data.sync_started_at || null,
            syncError: data.sync_error || null,
          };

          setSyncStatus(next);

          // Track last progress movement to detect stalls
          if (next.progress !== lastProgressRef.current.progress) {
            lastProgressRef.current = { progress: next.progress, at: Date.now() };
          }
        }

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

  const handleResumeSync = async () => {
    if (!connectedConfigId || !syncStatus?.activeJobId) return;
    try {
      toast.message('Resuming email scan…');
      const { error } = await supabase.functions.invoke('email-sync-worker', {
        body: { jobId: syncStatus.activeJobId, configId: connectedConfigId },
      });
      if (error) throw error;
      lastProgressRef.current = { progress: syncStatus.progress ?? 0, at: Date.now() };
    } catch (e) {
      console.error(e);
      toast.error('Could not resume the email scan.');
    }
  };

  // Check on mount and poll for sync progress
  useEffect(() => {
    // Always check for an existing connection on mount (restores state when navigating back)
    checkEmailConnection();

    const pending = localStorage.getItem('onboarding_email_pending') === 'true';

    // While connecting, keep checking in case the OAuth flow redirected in-tab
    // (popup not closed => previous polling never fires).
    let connectInterval: number | undefined;
    if (isConnecting || pending) {
      connectInterval = window.setInterval(() => {
        checkEmailConnection();
      }, 2000);

      // stop after 2 minutes to avoid infinite polling
      window.setTimeout(() => {
        if (connectInterval) window.clearInterval(connectInterval);
      }, 120000);
    }

    // Poll for sync progress when connected (every 2 seconds)
    if (connectedEmail) {
      const interval = setInterval(async () => {
        // Fetch both email config and onboarding progress
        const [configResult, progressResult] = await Promise.all([
          supabase
            .from('email_provider_configs')
            .select('sync_status, sync_stage, sync_progress, sync_total, inbound_emails_found, outbound_emails_found, inbound_total, outbound_total, threads_linked, voice_profile_status, last_sync_at, sync_started_at, sync_error, active_job_id')
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single(),
          supabase
            .from('onboarding_progress')
            .select('*')
            .eq('workspace_id', workspaceId)
            .single(),
        ]);

        if (configResult.data) {
          const next = {
            status: configResult.data.sync_status || 'pending',
            stage: configResult.data.sync_stage || 'pending',
            progress: configResult.data.sync_progress || 0,
            total: configResult.data.sync_total || 0,
            inboundFound: configResult.data.inbound_emails_found || 0,
            outboundFound: configResult.data.outbound_emails_found || 0,
            inboundTotal: configResult.data.inbound_total || 0,
            outboundTotal: configResult.data.outbound_total || 0,
            threadsLinked: configResult.data.threads_linked || 0,
            voiceProfileStatus: configResult.data.voice_profile_status || 'pending',
            activeJobId: configResult.data.active_job_id || null,
            lastSyncAt: configResult.data.last_sync_at || null,
            syncStartedAt: configResult.data.sync_started_at || null,
            syncError: configResult.data.sync_error || null,
          };

          setSyncStatus(next);

          if (next.progress !== lastProgressRef.current.progress) {
            lastProgressRef.current = { progress: next.progress, at: Date.now() };
          }

          // Stop polling when complete
          if (configResult.data.voice_profile_status === 'complete' || configResult.data.sync_status === 'error') {
            clearInterval(interval);
          }
        }

        if (progressResult.data) {
          setOnboardingProgress({
            emailImportStatus: progressResult.data.email_import_status || 'pending',
            emailImportProgress: progressResult.data.email_import_progress || 0,
            threadMatchingStatus: progressResult.data.thread_matching_status || 'pending',
            threadMatchingProgress: progressResult.data.thread_matching_progress || 0,
            pairsMatched: progressResult.data.pairs_matched || 0,
            categorizationStatus: progressResult.data.categorization_status || 'pending',
            categorizationProgress: progressResult.data.categorization_progress || 0,
            styleAnalysisStatus: progressResult.data.style_analysis_status || 'pending',
            fewShotStatus: progressResult.data.few_shot_status || 'pending',
            responseRatePercent: progressResult.data.response_rate_percent,
            avgResponseTimeHours: progressResult.data.avg_response_time_hours,
            topCategories: parseTopCategories(progressResult.data.top_categories),
          });
        }
      }, 2000); // 2-second polling

      return () => {
        clearInterval(interval);
        if (connectInterval) window.clearInterval(connectInterval);
      };
    }

    return () => {
      if (connectInterval) window.clearInterval(connectInterval);
    };
  }, [isConnecting, connectedEmail, workspaceId, connectedConfigId, connectedImportMode]);

  // If OAuth redirected back to the app (no postMessage), show a toast on success/error.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const aurinko = params.get('aurinko');
    if (aurinko === 'success') {
      toast.success('Email connected');
      params.delete('aurinko');
      params.delete('message');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', newUrl);
    }
    if (aurinko === 'error') {
      toast.error(params.get('message') || 'Email connection failed');
      params.delete('aurinko');
      params.delete('message');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', newUrl);
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

  // Show loading state while checking for existing connection
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

  return (
    <div className="space-y-6">
      <div className="text-center">
        <CardTitle className="text-xl">Connect Your Email</CardTitle>
        <CardDescription className="mt-2">
          BizzyBee will learn from your inbox to handle emails just like you would.
        </CardDescription>
      </div>

      {/* Popup guidance - shown when not connected */}
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

          {/* Multi-Phase Sync Progress Indicator */}
          {syncStatus && (syncStatus.status !== 'completed' || syncStatus.voiceProfileStatus !== 'complete') && syncStatus.status !== 'error' && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg border">
              {/* Current phase indicator */}
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="font-medium text-sm">
                  {syncStatus.stage === 'fetching_inbox' && 'Phase 1 of 5: Scanning inbox...'}
                  {syncStatus.stage === 'fetching_sent' && 'Phase 1 of 5: Scanning sent emails...'}
                  {syncStatus.stage === 'matching_threads' && 'Phase 2 of 5: Matching conversations...'}
                  {syncStatus.stage === 'categorizing_emails' && 'Phase 3 of 5: Categorizing emails...'}
                  {syncStatus.stage === 'analyzing_style' && 'Phase 4 of 5: Learning your writing style...'}
                  {syncStatus.stage === 'building_examples' && 'Phase 5 of 5: Building AI training data...'}
                  {syncStatus.stage === 'pending' && 'Starting import...'}
                  {!['fetching_inbox', 'fetching_sent', 'matching_threads', 'categorizing_emails', 'analyzing_style', 'building_examples', 'pending'].includes(syncStatus.stage) && 'Processing...'}
                </span>
              </div>

              {/* Always show email counts with real progress */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-background/50 rounded p-2">
                  <div className="font-semibold text-foreground flex items-center gap-1">
                    {syncStatus.inboundFound.toLocaleString()}
                    {syncStatus.inboundTotal > 0 && (
                      <span className="text-muted-foreground">/ {syncStatus.inboundTotal.toLocaleString()}</span>
                    )}
                    {syncStatus.stage === 'fetching_inbox' && (
                      <span className="text-muted-foreground animate-pulse">+</span>
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    Inbox emails {syncStatus.inboundTotal > 0 && syncStatus.stage === 'fetching_inbox' 
                      ? `(${Math.round((syncStatus.inboundFound / syncStatus.inboundTotal) * 100)}%)` 
                      : syncStatus.stage === 'fetching_inbox' ? 'scanned' : ''}
                  </div>
                </div>
                <div className="bg-background/50 rounded p-2">
                  <div className="font-semibold text-foreground flex items-center gap-1">
                    {syncStatus.outboundFound.toLocaleString()}
                    {syncStatus.outboundTotal > 0 && (
                      <span className="text-muted-foreground">/ {syncStatus.outboundTotal.toLocaleString()}</span>
                    )}
                    {syncStatus.stage === 'fetching_sent' && (
                      <span className="text-muted-foreground animate-pulse">+</span>
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    Sent emails {syncStatus.outboundTotal > 0 && syncStatus.stage === 'fetching_sent'
                      ? `(${Math.round((syncStatus.outboundFound / syncStatus.outboundTotal) * 100)}%)`
                      : syncStatus.stage === 'fetching_sent' ? 'scanned' : syncStatus.stage === 'fetching_inbox' ? '(next)' : ''}
                  </div>
                </div>
              </div>

              {/* Real progress bar - only when we have totals for accurate percentage */}
              {(syncStatus.stage === 'fetching_inbox' || syncStatus.stage === 'fetching_sent') && (
                <div className="space-y-1">
                  {syncStatus.inboundTotal > 0 || syncStatus.outboundTotal > 0 ? (
                    <>
                      <Progress value={syncStatus.progress} className="h-2" />
                      <p className="text-xs text-center text-muted-foreground">
                        {syncStatus.progress}% complete
                      </p>
                    </>
                  ) : (
                    /* Indeterminate progress when totals not available (Aurinko fallback) */
                    <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                      <div className="absolute inset-0 bg-primary/30 animate-pulse" />
                      <div className="absolute h-full w-1/3 bg-primary rounded-full animate-[slide_1.5s_ease-in-out_infinite]" 
                           style={{ animation: 'slide 1.5s ease-in-out infinite' }} />
                    </div>
                  )}
                </div>
              )}

              {/* Insights preview when available */}
              {onboardingProgress?.responseRatePercent != null && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1">
                  <p className="text-xs font-medium text-primary">Email Insights</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>Response rate: <strong>{onboardingProgress.responseRatePercent}%</strong></div>
                    {onboardingProgress.avgResponseTimeHours != null && (
                      <div>Avg response: <strong>{onboardingProgress.avgResponseTimeHours}h</strong></div>
                    )}
                  </div>
                  {onboardingProgress.pairsMatched > 0 && (
                    <div className="text-muted-foreground">
                      {onboardingProgress.pairsMatched.toLocaleString()} conversations matched
                    </div>
                  )}
                </div>
              )}

              {/* Live activity indicator */}
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span>Actively syncing</span>
              </div>

              <div className="text-center space-y-1">
                <p className="text-xs text-muted-foreground">
                  You can continue while we build your AI clone in the background.
                </p>
                <p className="text-xs text-muted-foreground/70 italic">
                  ☕ Perfect time for a coffee break!
                </p>
              </div>
            </div>
          )}

          {syncStatus?.status === 'completed' && syncStatus.voiceProfileStatus === 'complete' && (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 p-3 bg-success/5 rounded-lg border border-success/20 text-success text-sm">
                <CheckCircle2 className="h-4 w-4" />
                <span>Import complete!</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-muted/30 rounded p-2">
                  <div className="font-semibold text-foreground">{syncStatus.inboundFound}</div>
                  <div className="text-muted-foreground">Inbox emails</div>
                </div>
                <div className="bg-muted/30 rounded p-2">
                  <div className="font-semibold text-foreground">{syncStatus.outboundFound}</div>
                  <div className="text-muted-foreground">Your replies</div>
                </div>
                <div className="bg-muted/30 rounded p-2">
                  <div className="font-semibold text-foreground">✓</div>
                  <div className="text-muted-foreground">Style learned</div>
                </div>
              </div>
            </div>
          )}

          {syncStatus?.voiceProfileStatus === 'insufficient_data' && syncStatus.status === 'completed' && (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 p-3 bg-success/5 rounded-lg border border-success/20 text-success text-sm">
                <CheckCircle2 className="h-4 w-4" />
                <span>Import complete! {syncStatus.inboundFound} emails imported.</span>
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Not enough sent emails to learn your style yet. BizzyBee will learn as you use it!
              </p>
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
