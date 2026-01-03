import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Mail, CheckCircle2, Loader2, RefreshCw, ArrowRight, AlertCircle, RotateCcw, StopCircle, Inbox, Send } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { EmailImportPreview } from '@/components/email/EmailImportPreview';

interface EmailConnectionStepProps {
  workspaceId: string;
  onNext: () => void;
  onBack: () => void;
  onEmailConnected: (email: string) => void;
}

type Provider = 'gmail' | 'outlook' | 'icloud' | 'yahoo';
type ImportMode = 'new_only' | 'unread_only' | 'all_historical_30_days' | 'all_historical_90_days' | 'last_1000' | 'all_history';

interface ImportProgress {
  current_phase: string | null;
  phase1_status: string | null;
  phase2_status: string | null;
  phase3_status: string | null;
  emails_received: number | null;
  emails_classified: number | null;
  conversations_found: number | null;
  conversations_with_replies: number | null;
  pairs_analyzed: number | null;
  voice_profile_complete: boolean | null;
  playbook_complete: boolean | null;
  last_error: string | null;
  started_at: string | null;
  // New folder tracking fields
  current_import_folder: string | null;
  sent_import_complete: boolean | null;
  inbox_import_complete: boolean | null;
  sent_email_count: number | null;
  inbox_email_count: number | null;
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

// Calculate progress based on 3-phase system with folder awareness
function calculateProgress(progress: ImportProgress): number {
  const phase = progress.current_phase;
  
  if (phase === 'complete') return 100;
  if (phase === 'error') return -1;
  if (phase === 'ready') return 0;
  
  // Phase 1: Importing (0-40%)
  if (phase === 'importing') {
    const sentComplete = progress.sent_import_complete ?? false;
    const inboxComplete = progress.inbox_import_complete ?? false;
    
    if (sentComplete && inboxComplete) return 40;
    if (sentComplete) return 25; // SENT done, INBOX in progress
    
    // SENT in progress
    const sentCount = progress.sent_email_count || 0;
    return Math.min(20, Math.floor((sentCount / 500) * 20));
  }
  
  // Phase 2: Classifying (40-60%)
  if (phase === 'classifying') {
    const received = progress.emails_received || 1;
    const classified = progress.emails_classified || 0;
    const classifyProgress = classified / received;
    return 40 + Math.floor(classifyProgress * 20);
  }
  
  // Phase 3: Analyzing/Learning (60-100%)
  if (phase === 'analyzing' || phase === 'learning') {
    const voiceComplete = progress.voice_profile_complete ?? false;
    const playbookComplete = progress.playbook_complete ?? false;
    
    if (voiceComplete && playbookComplete) return 100;
    if (voiceComplete) return 85;
    
    const pairs = progress.pairs_analyzed || 0;
    const totalPairs = progress.conversations_with_replies || 1;
    const analyzeProgress = pairs / totalPairs;
    return 60 + Math.floor(analyzeProgress * 25);
  }
  
  return 0;
}

// Check if import is stuck (rate limited or stalled)
function isImportStuck(progress: ImportProgress): boolean {
  if (!progress.last_error) return false;
  return progress.last_error.toLowerCase().includes('rate limit') || 
         progress.last_error.toLowerCase().includes('resume');
}

// Get human-readable status message with folder awareness
function getStatusMessage(progress: ImportProgress): string {
  const phase = progress.current_phase;
  
  if (phase === 'ready') {
    return 'Ready to import';
  }
  
  if (phase === 'importing') {
    const currentFolder = progress.current_import_folder || 'SENT';
    const sentComplete = progress.sent_import_complete ?? false;
    const sentCount = progress.sent_email_count || 0;
    const inboxCount = progress.inbox_email_count || 0;
    const received = progress.emails_received || 0;
    
    if (isImportStuck(progress)) {
      return `Fetching paused at ${received.toLocaleString()} emails (rate limited)`;
    }
    
    if (!sentComplete) {
      return `Importing SENT folder... ${sentCount.toLocaleString()} emails (priority for voice learning)`;
    }
    
    return `Importing INBOX... ${inboxCount.toLocaleString()} emails (SENT: ${sentCount.toLocaleString()} ✓)`;
  }
  
  if (phase === 'classifying') {
    const classified = progress.emails_classified || 0;
    const received = progress.emails_received || 0;
    return `Classifying emails... ${classified.toLocaleString()} of ${received.toLocaleString()}`;
  }
  
  if (phase === 'analyzing' || phase === 'learning') {
    const pairs = progress.pairs_analyzed || 0;
    const total = progress.conversations_with_replies || 0;
    if (progress.voice_profile_complete) {
      return 'Building response playbook...';
    }
    return `Learning your style... ${pairs} of ${total} conversations`;
  }
  
  if (phase === 'complete') {
    const conversations = progress.conversations_found || 0;
    return `Done! Learned from ${conversations.toLocaleString()} conversations`;
  }
  
  if (phase === 'error') {
    return progress.last_error || 'Import failed';
  }
  
  return 'Preparing...';
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
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('last_1000');
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [importStarted, setImportStarted] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  
  // New progress tracking
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

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

  // Start historical import after email is connected
  const startHistoricalImport = async () => {
    if (!workspaceId || importStarted) return;
    
    console.log('[EmailConnection] Starting historical import...');
    setImportStarted(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('start-historical-import', {
        body: { workspaceId }
      });
      
      if (error) {
        console.error('[EmailConnection] Historical import error:', error);
        toast.error('Failed to start email import');
        return;
      }
      
      console.log('[EmailConnection] Historical import started:', data);
      toast.success('Starting email import...');
    } catch (error) {
      console.error('[EmailConnection] Error starting import:', error);
    }
  };

  const checkEmailConnection = async (isInitialLoad = false) => {
    setCheckingConnection(true);
    try {
      // Fetch both email config and import progress in parallel
      const [configResult, progressResult] = await Promise.all([
        supabase
          .from('email_provider_configs')
          .select('id, import_mode, email_address, sync_status, sync_error')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('email_import_progress')
          .select('*')
          .eq('workspace_id', workspaceId)
          .maybeSingle()
      ]);

      // Set import progress immediately if it exists
      if (!progressResult.error && progressResult.data) {
        setImportProgress(progressResult.data as ImportProgress);
        // If import is already in progress, mark it as started
        const phase = progressResult.data.current_phase;
        if (phase && phase !== 'idle' && phase !== 'connecting' && phase !== 'ready') {
          setImportStarted(true);
        }
      }

      if (configResult.error) throw configResult.error;
      const data = configResult.data;

      if (data?.email_address) {
        setConnectedEmail(data.email_address);
        setConnectedConfigId(data.id);
        onEmailConnected(data.email_address);

        if (connectTimeoutRef.current) window.clearTimeout(connectTimeoutRef.current);
        if (popupPollRef.current) window.clearInterval(popupPollRef.current);
        connectTimeoutRef.current = undefined;
        popupPollRef.current = undefined;
        popupRef.current = null;

        // Check if we should show preview or start import
        const hasExistingProgress = progressResult.data?.current_phase && 
          progressResult.data.current_phase !== 'idle' &&
          progressResult.data.current_phase !== 'ready';
        
        if (!hasExistingProgress && !importStarted) {
          // Show preview first if newly connected
          setShowPreview(true);
        }

        if (!connectedEmail && !isInitialLoad) {
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

  const fetchImportProgress = async () => {
    const { data, error } = await supabase
      .from('email_import_progress')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!error && data) {
      setImportProgress(data as ImportProgress);
      // Mark as started if there's active progress
      const phase = data.current_phase;
      if (phase && phase !== 'idle' && phase !== 'connecting' && phase !== 'ready') {
        setImportStarted(true);
      }
    }
  };

  const handleStartImportFromPreview = async () => {
    setShowPreview(false);
    await startHistoricalImport();
  };

  const handleSkipPreview = () => {
    setShowPreview(false);
    onNext();
  };

  const handleStopSync = async () => {
    try {
      toast.message('Stopping import…');
      
      await supabase
        .from('email_import_progress')
        .update({ 
          current_phase: 'complete',
          last_error: 'Stopped by user'
        })
        .eq('workspace_id', workspaceId);
      
      toast.success('Import stopped. You can continue with the imported emails.');
      await fetchImportProgress();
    } catch (e) {
      console.error(e);
      toast.error('Could not stop the import.');
    }
  };

  const handleRetrySync = async () => {
    try {
      toast.message('Restarting import…');
      setImportStarted(false);
      
      // Reset progress and start again
      await supabase
        .from('email_import_progress')
        .delete()
        .eq('workspace_id', workspaceId);
      
      await startHistoricalImport();
      toast.success('Import restarted!');
    } catch (e: any) {
      console.error(e);
      const msg = typeof e?.message === 'string' ? e.message : 'Could not restart the import.';
      toast.error(msg);
    }
  };

  // Resume a stuck/rate-limited import
  const handleResumeImport = async () => {
    try {
      toast.message('Resuming import…');
      
      // Clear the error and trigger resume
      await supabase
        .from('email_import_progress')
        .update({ 
          last_error: null,
          updated_at: new Date().toISOString()
        })
        .eq('workspace_id', workspaceId);
      
      const { error } = await supabase.functions.invoke('start-historical-import', {
        body: { workspaceId }
      });
      
      if (error) {
        throw error;
      }
      
      toast.success('Import resumed!');
    } catch (e: any) {
      console.error(e);
      toast.error('Could not resume import');
    }
  };

  // Subscribe to realtime updates for import progress
  useEffect(() => {
    if (!workspaceId) return;

    const channel = supabase
      .channel('email-import-progress')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'email_import_progress',
          filter: `workspace_id=eq.${workspaceId}`
        },
        (payload) => {
          console.log('[EmailConnection] Progress update:', payload);
          if (payload.new) {
            setImportProgress(payload.new as ImportProgress);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  // Initial check and polling for connection
  useEffect(() => {
    checkEmailConnection(true); // Pass true for initial load

    const pending = localStorage.getItem('onboarding_email_pending') === 'true';

    let connectInterval: number | undefined;
    if (isConnecting || pending) {
      connectInterval = window.setInterval(() => {
        checkEmailConnection(false);
      }, 2000);

      window.setTimeout(() => {
        if (connectInterval) window.clearInterval(connectInterval);
      }, 120000);
    }

    return () => {
      if (connectInterval) window.clearInterval(connectInterval);
    };
  }, [isConnecting]);

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

  const phase = importProgress?.current_phase || 'idle';
  const isImporting = ['importing', 'classifying', 'analyzing', 'learning'].includes(phase);
  const importComplete = phase === 'complete' && !importProgress?.last_error;
  const importError = phase === 'error' || (phase === 'complete' && importProgress?.last_error);
  const progress = importProgress ? calculateProgress(importProgress) : 0;
  const statusMessage = importProgress ? getStatusMessage(importProgress) : '';

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

          {/* Show Preview before import */}
          {showPreview && !importStarted && (
            <EmailImportPreview 
              workspaceId={workspaceId}
              onStartImport={handleStartImportFromPreview}
              onSkip={handleSkipPreview}
            />
          )}

          {/* Error State */}
          {importError && importProgress && !showPreview && (
            <div className="space-y-4 p-4 bg-destructive/10 rounded-lg border border-destructive/30">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <span className="font-medium">Import encountered an error</span>
              </div>
              
              {importProgress.last_error && (
                <p className="text-sm text-muted-foreground">
                  {importProgress.last_error}
                </p>
              )}
              
              <div className="text-sm text-muted-foreground">
                <p>Progress before error:</p>
                <p className="font-medium">
                  {(importProgress.emails_received || 0).toLocaleString()} emails received
                </p>
              </div>
              
              <Button onClick={handleRetrySync} className="w-full gap-2">
                <RotateCcw className="h-4 w-4" />
                Retry Import
              </Button>
            </div>
          )}

          {/* Import Progress */}
          {isImporting && importProgress && !showPreview && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg border">
              {/* Current phase indicator */}
              <div className="flex items-center gap-2">
                {isImportStuck(importProgress) ? (
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                )}
                <span className="font-medium text-sm">{statusMessage}</span>
              </div>

              {/* Rate limit warning and resume button */}
              {isImportStuck(importProgress) && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-3">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    The email provider paused the import due to rate limits. 
                    It should auto-resume in ~60 seconds, or you can manually resume now.
                  </p>
                  <Button 
                    onClick={handleResumeImport} 
                    size="sm"
                    className="w-full gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Resume Import Now
                  </Button>
                </div>
              )}

              {/* Folder progress (during importing phase) */}
              {phase === 'importing' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className={`p-2 rounded border text-center text-xs ${
                    importProgress.sent_import_complete 
                      ? 'bg-success/10 border-success/30' 
                      : importProgress.current_import_folder === 'SENT'
                        ? 'bg-primary/10 border-primary/30'
                        : 'bg-muted'
                  }`}>
                    <Send className="h-4 w-4 mx-auto mb-1 text-green-500" />
                    <div className="font-semibold">SENT</div>
                    <div className="text-muted-foreground">
                      {(importProgress.sent_email_count || 0).toLocaleString()}
                      {importProgress.sent_import_complete && ' ✓'}
                    </div>
                  </div>
                  <div className={`p-2 rounded border text-center text-xs ${
                    importProgress.inbox_import_complete 
                      ? 'bg-success/10 border-success/30' 
                      : importProgress.current_import_folder === 'INBOX'
                        ? 'bg-primary/10 border-primary/30'
                        : 'bg-muted'
                  }`}>
                    <Inbox className="h-4 w-4 mx-auto mb-1 text-blue-500" />
                    <div className="font-semibold">INBOX</div>
                    <div className="text-muted-foreground">
                      {(importProgress.inbox_email_count || 0).toLocaleString()}
                      {importProgress.inbox_import_complete && ' ✓'}
                    </div>
                  </div>
                </div>
              )}

              {/* Phase indicators */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className={`p-2 rounded text-center ${phase === 'importing' ? 'bg-primary/10 border border-primary/30' : phase === 'classifying' || phase === 'analyzing' || phase === 'learning' ? 'bg-success/10' : 'bg-muted'}`}>
                  <div className="font-semibold">Phase 1</div>
                  <div className="text-muted-foreground">Import</div>
                  {importProgress.emails_received !== null && (
                    <div className="font-medium text-foreground mt-1">
                      {importProgress.emails_received.toLocaleString()}
                    </div>
                  )}
                </div>
                <div className={`p-2 rounded text-center ${phase === 'classifying' ? 'bg-primary/10 border border-primary/30' : phase === 'analyzing' || phase === 'learning' ? 'bg-success/10' : 'bg-muted'}`}>
                  <div className="font-semibold">Phase 2</div>
                  <div className="text-muted-foreground">Classify</div>
                  {importProgress.emails_classified !== null && (
                    <div className="font-medium text-foreground mt-1">
                      {importProgress.emails_classified.toLocaleString()}
                    </div>
                  )}
                </div>
                <div className={`p-2 rounded text-center ${phase === 'analyzing' || phase === 'learning' ? 'bg-primary/10 border border-primary/30' : 'bg-muted'}`}>
                  <div className="font-semibold">Phase 3</div>
                  <div className="text-muted-foreground">Learn</div>
                  {importProgress.pairs_analyzed !== null && (
                    <div className="font-medium text-foreground mt-1">
                      {importProgress.pairs_analyzed}
                    </div>
                  )}
                </div>
              </div>

              {/* Show conversation stats after phase 2 */}
              {importProgress.conversations_with_replies !== null && importProgress.conversations_with_replies > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                  <p className="text-xs font-medium text-primary">
                    Found {importProgress.conversations_with_replies.toLocaleString()} conversations with your replies
                  </p>
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

              {/* Live indicator - only show when not stuck */}
              {!isImportStuck(importProgress) && (
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  <span>Actively importing</span>
                </div>
              )}

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
          {importComplete && importProgress && !showPreview && (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 p-3 bg-success/5 rounded-lg border border-success/20 text-success text-sm">
                <CheckCircle2 className="h-4 w-4" />
                <span>Import complete!</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                <div className="bg-muted/30 rounded p-2">
                  <Send className="h-4 w-4 mx-auto mb-1 text-green-500" />
                  <div className="font-semibold text-foreground">{(importProgress.sent_email_count || 0).toLocaleString()}</div>
                  <div className="text-muted-foreground">Sent emails</div>
                </div>
                <div className="bg-muted/30 rounded p-2">
                  <Inbox className="h-4 w-4 mx-auto mb-1 text-blue-500" />
                  <div className="font-semibold text-foreground">{(importProgress.inbox_email_count || 0).toLocaleString()}</div>
                  <div className="text-muted-foreground">Inbox emails</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                <div className="bg-muted/30 rounded p-2">
                  <div className="font-semibold text-foreground">{(importProgress.conversations_found || 0).toLocaleString()}</div>
                  <div className="text-muted-foreground">Conversations</div>
                </div>
                <div className="bg-muted/30 rounded p-2">
                  <div className="font-semibold text-foreground">{(importProgress.pairs_analyzed || 0).toLocaleString()}</div>
                  <div className="text-muted-foreground">Patterns learned</div>
                </div>
              </div>
              {importProgress.voice_profile_complete && (
                <div className="text-xs text-center text-success">
                  ✓ Voice profile built • ✓ Response playbook ready
                </div>
              )}
            </div>
          )}

          {!showPreview && (
            <div className="flex gap-3">
              <Button variant="outline" onClick={onBack} className="flex-1">
                Back
              </Button>
              <Button onClick={onNext} className="flex-1 gap-2">
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
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
