import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Mail, CheckCircle2, Loader2, RefreshCw, ArrowRight, AlertCircle, RotateCcw, StopCircle, Inbox, Send, Clock } from 'lucide-react';
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
type ImportMode =
  | 'new_only'
  | 'unread_only'
  | 'all_historical_30_days'
  | 'all_historical_90_days'
  | 'last_1000'
  | 'last_10000'
  | 'last_30000'
  | 'all_history';

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
  current_import_folder: string | null;
  sent_import_complete: boolean | null;
  inbox_import_complete: boolean | null;
  sent_email_count: number | null;
  inbox_email_count: number | null;
  run_id: string | null;
  resume_after: string | null;
  paused_reason: string | null;
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
    value: 'all_historical_90_days' as ImportMode, 
    label: 'Last 90 days', 
    description: 'Import all emails from the past 3 months',
    timeEstimate: '~45 mins'
  },
  { 
    value: 'all_historical_30_days' as ImportMode, 
    label: 'Last 30 days', 
    description: 'A lighter import for smaller inboxes',
    timeEstimate: '~20 mins'
  },
  { 
    value: 'unread_only' as ImportMode, 
    label: 'Unread emails only', 
    description: 'Quick start — just your current unread messages',
    timeEstimate: '~8 mins'
  },
  { 
    value: 'new_only' as ImportMode, 
    label: 'New emails only', 
    description: 'Only receive new emails going forward (no history)',
    timeEstimate: 'Instant'
  },
];

// Calculate progress - make it monotonic (never go backwards)
function calculateProgress(progress: ImportProgress, maxProgressRef: React.MutableRefObject<number>): number {
  const phase = progress.current_phase;
  
  if (phase === 'complete') return 100;
  if (phase === 'error') return maxProgressRef.current; // Keep current on error
  if (phase === 'ready') return 0;
  
  let calculatedProgress = 0;
  
  // Phase 1: Importing (0-40%)
  if (phase === 'importing') {
    const sentComplete = progress.sent_import_complete ?? false;
    const inboxComplete = progress.inbox_import_complete ?? false;
    
    if (sentComplete && inboxComplete) {
      calculatedProgress = 40;
    } else if (sentComplete) {
      const inboxCount = progress.inbox_email_count || 0;
      calculatedProgress = 20 + Math.min(20, Math.floor((inboxCount / 5000) * 20));
    } else {
      const sentCount = progress.sent_email_count || 0;
      calculatedProgress = Math.min(20, Math.floor((sentCount / 5000) * 20));
    }
  }
  
  // Phase 2: Classifying (40-60%)
  else if (phase === 'classifying') {
    const received = progress.emails_received || 1;
    const classified = progress.emails_classified || 0;
    const classifyProgress = classified / received;
    calculatedProgress = 40 + Math.floor(classifyProgress * 20);
  }
  
  // Phase 3: Analyzing/Learning (60-100%)
  else if (phase === 'analyzing' || phase === 'learning') {
    const voiceComplete = progress.voice_profile_complete ?? false;
    const playbookComplete = progress.playbook_complete ?? false;
    
    if (voiceComplete && playbookComplete) {
      calculatedProgress = 100;
    } else if (voiceComplete) {
      calculatedProgress = 85;
    } else {
      const pairs = progress.pairs_analyzed || 0;
      const totalPairs = progress.conversations_with_replies || 1;
      const analyzeProgress = pairs / totalPairs;
      calculatedProgress = 60 + Math.floor(analyzeProgress * 25);
    }
  }
  
  // Make monotonic - never decrease
  const result = Math.max(calculatedProgress, maxProgressRef.current);
  maxProgressRef.current = result;
  return result;
}

// Check if import is paused for rate limiting
function isPaused(progress: ImportProgress): boolean {
  if (progress.paused_reason === 'rate_limit') return true;
  if (progress.resume_after) {
    const resumeTime = new Date(progress.resume_after).getTime();
    return resumeTime > Date.now();
  }
  return false;
}

// Get seconds until resume
function getSecondsUntilResume(progress: ImportProgress): number {
  if (!progress.resume_after) return 0;
  const resumeTime = new Date(progress.resume_after).getTime();
  return Math.max(0, Math.ceil((resumeTime - Date.now()) / 1000));
}

// Get human-readable status message
function getStatusMessage(progress: ImportProgress): string {
  const phase = progress.current_phase;
  
  if (phase === 'ready') return 'Ready to import';
  
  if (phase === 'importing') {
    const currentFolder = progress.current_import_folder || 'SENT';
    const sentComplete = progress.sent_import_complete ?? false;
    const sentCount = progress.sent_email_count || 0;
    const inboxCount = progress.inbox_email_count || 0;
    
    if (isPaused(progress)) {
      const seconds = getSecondsUntilResume(progress);
      if (seconds > 0) {
        return `Paused (rate limit) - resuming in ${seconds}s`;
      }
      return 'Paused - click Resume to continue';
    }
    
    if (!sentComplete) {
      return `Importing SENT... ${sentCount.toLocaleString()} emails`;
    }
    
    return `Importing INBOX... ${inboxCount.toLocaleString()} emails`;
  }
  
  if (phase === 'classifying') {
    const classified = progress.emails_classified || 0;
    const received = progress.emails_received || 0;
    return `Classifying... ${classified.toLocaleString()} of ${received.toLocaleString()}`;
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
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [resumeCountdown, setResumeCountdown] = useState(0);

  // Refs for deduplication and monotonic progress
  const connectedEmailRef = useRef<string | null>(null);
  const toastedEmailRef = useRef<string | null>(null);
  const maxProgressRef = useRef<number>(0);
  const connectTimeoutRef = useRef<number | undefined>(undefined);
  const popupRef = useRef<Window | null>(null);
  const popupPollRef = useRef<number | undefined>(undefined);
  const autoResumeTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    connectedEmailRef.current = connectedEmail;
  }, [connectedEmail]);

  // Auto-resume countdown and trigger
  useEffect(() => {
    if (!importProgress) return;
    
    const seconds = getSecondsUntilResume(importProgress);
    if (seconds > 0) {
      setResumeCountdown(seconds);
      
      // Clear existing timer
      if (autoResumeTimerRef.current) {
        window.clearInterval(autoResumeTimerRef.current);
      }
      
      // Countdown timer
      autoResumeTimerRef.current = window.setInterval(() => {
        setResumeCountdown(prev => {
          if (prev <= 1) {
            window.clearInterval(autoResumeTimerRef.current);
            // Auto-resume when countdown hits 0
            handleResumeImport();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      return () => {
        if (autoResumeTimerRef.current) {
          window.clearInterval(autoResumeTimerRef.current);
        }
      };
    } else {
      setResumeCountdown(0);
    }
  }, [importProgress?.resume_after]);

  const handleConnect = async (provider: Provider) => {
    setIsConnecting(true);
    setSelectedProvider(provider);

    if (connectTimeoutRef.current) window.clearTimeout(connectTimeoutRef.current);
    if (popupPollRef.current) window.clearInterval(popupPollRef.current);
    popupPollRef.current = undefined;
    connectTimeoutRef.current = undefined;
    popupRef.current = null;

    try {
      const { data, error } = await supabase.functions.invoke('aurinko-auth-start', {
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

  const startHistoricalImport = async () => {
    if (!workspaceId || importStarted) return;
    
    console.log('[EmailConnection] Starting historical import...');
    setImportStarted(true);
    maxProgressRef.current = 0; // Reset progress tracking
    
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

      if (!progressResult.error && progressResult.data) {
        setImportProgress(progressResult.data as ImportProgress);
        const phase = progressResult.data.current_phase;
        if (phase && phase !== 'idle' && phase !== 'connecting' && phase !== 'ready') {
          setImportStarted(true);
        }
      }

      if (configResult.error) throw configResult.error;
      const data = configResult.data;

      if (data?.email_address) {
        const newEmail = data.email_address;
        setConnectedEmail(newEmail);
        setConnectedConfigId(data.id);
        onEmailConnected(newEmail);

        if (connectTimeoutRef.current) window.clearTimeout(connectTimeoutRef.current);
        if (popupPollRef.current) window.clearInterval(popupPollRef.current);
        connectTimeoutRef.current = undefined;
        popupPollRef.current = undefined;
        popupRef.current = null;

        const hasExistingProgress = progressResult.data?.current_phase && 
          progressResult.data.current_phase !== 'idle' &&
          progressResult.data.current_phase !== 'ready';
        
        if (!hasExistingProgress && !importStarted) {
          setShowPreview(true);
        }

        // Only toast once per email address
        if (toastedEmailRef.current !== newEmail && !isInitialLoad) {
          toastedEmailRef.current = newEmail;
          toast.success(`Connected to ${newEmail}`);
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
          last_error: 'Stopped by user',
          resume_after: null,
          paused_reason: null
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
      maxProgressRef.current = 0; // Reset monotonic progress
      
      // Delete old progress (new run_id will be generated)
      await supabase
        .from('email_import_progress')
        .delete()
        .eq('workspace_id', workspaceId);
      
      // Delete raw emails to start fresh
      await supabase
        .from('raw_emails')
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

  const handleResumeImport = async () => {
    if (!importProgress) return;
    
    try {
      toast.message('Resuming import…');
      
      // Clear pause state and trigger import with current run_id
      await supabase
        .from('email_import_progress')
        .update({ 
          last_error: null,
          resume_after: null,
          paused_reason: null,
          updated_at: new Date().toISOString()
        })
        .eq('workspace_id', workspaceId);
      
      // Resume from current folder
      const currentFolder = importProgress.current_import_folder || 
        (importProgress.sent_import_complete ? 'INBOX' : 'SENT');
      
      const { error } = await supabase.functions.invoke('start-historical-import', {
        body: { 
          workspaceId, 
          folder: currentFolder,
          runId: importProgress.run_id 
        }
      });
      
      if (error) throw error;
      
      toast.success('Import resumed!');
    } catch (e: any) {
      console.error(e);
      toast.error('Could not resume import');
    }
  };

  const handleRepairLearning = async () => {
    try {
      toast.message('Repairing learning…');
      // Rebuild conversations/messages from already-classified emails
      const { error } = await supabase.functions.invoke('email-queue-processor', {
        body: { workspaceId, rebuild: true }
      });
      if (error) throw error;
      toast.success('Repair started — learning will continue automatically.');
    } catch (e: any) {
      console.error(e);
      toast.error('Could not start repair');
    }
  };

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
    checkEmailConnection(true);

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
  const progress = importProgress ? calculateProgress(importProgress, maxProgressRef) : 0;
  const statusMessage = importProgress ? getStatusMessage(importProgress) : '';
  const paused = importProgress ? isPaused(importProgress) : false;

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
              onClick={async () => {
                try {
                  const { error: cfgErr } = await supabase
                    .from('email_provider_configs')
                    .delete()
                    .eq('workspace_id', workspaceId);

                  const { error: progErr } = await supabase
                    .from('email_import_progress')
                    .delete()
                    .eq('workspace_id', workspaceId);

                  if (cfgErr || progErr) throw cfgErr || progErr;

                  setConnectedEmail(null);
                  setImportProgress(null);
                  setImportStarted(false);
                  setShowPreview(false);
                  toastedEmailRef.current = null;
                  maxProgressRef.current = 0;
                  toast.success('Email disconnected');
                } catch (error) {
                  toast.error('Failed to disconnect');
                }
              }}
            >
              Disconnect
            </Button>
          </div>

          {/* Show Preview before import */}
          {showPreview && !importStarted && (
            <>
              <EmailImportPreview 
                workspaceId={workspaceId}
                importMode={importMode}
                onStartImport={handleStartImportFromPreview}
                onSkip={handleSkipPreview}
              />
              <Button variant="outline" onClick={onBack} className="w-full">
                Back
              </Button>
            </>
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
                {paused ? (
                  <Clock className="h-4 w-4 text-amber-500" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                )}
                <span className="font-medium text-sm">{statusMessage}</span>
              </div>

              {/* Repair CTA (when classified emails exist but no conversations were built) */}
              {(phase === 'analyzing' || phase === 'learning') &&
                (importProgress.emails_classified || 0) > 0 &&
                (importProgress.conversations_found || 0) === 0 && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-2">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      We imported and classified your emails, but couldn’t build conversation threads needed for “Learn Your Style”.
                    </p>
                    <Button onClick={handleRepairLearning} size="sm" className="w-full gap-2" variant="outline">
                      <RefreshCw className="h-4 w-4" />
                      Repair Learning
                    </Button>
                  </div>
                )}


              {/* Rate limit pause UI with countdown */}
              {paused && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      Paused due to provider rate limits
                    </p>
                    {resumeCountdown > 0 && (
                      <span className="text-sm font-mono bg-amber-100 dark:bg-amber-900 px-2 py-1 rounded">
                        {resumeCountdown}s
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {resumeCountdown > 0 
                      ? `Auto-resuming in ${resumeCountdown} seconds...`
                      : 'Ready to resume'}
                  </p>
                  <Button 
                    onClick={handleResumeImport} 
                    size="sm"
                    className="w-full gap-2"
                    variant={resumeCountdown > 0 ? "outline" : "default"}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Resume Now
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

              {/* Live indicator - only show when not paused */}
              {!paused && (
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
                  <div className="font-semibold text-foreground">{(importProgress.conversations_with_replies || 0).toLocaleString()}</div>
                  <div className="text-muted-foreground">With replies</div>
                </div>
              </div>
            </div>
          )}

          {/* Continue buttons */}
          {!showPreview && (isImporting || importComplete || importError) && (
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
