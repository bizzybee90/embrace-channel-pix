import { useState, useEffect } from 'react';
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
    description: 'Import everything — best for maximum AI accuracy (may take longer for large inboxes)',
    recommended: false
  },
  { 
    value: 'last_1000' as ImportMode, 
    label: 'Last 1,000 emails', 
    description: 'Great balance of learning data and speed',
    recommended: true
  },
  { 
    value: 'all_historical_90_days' as ImportMode, 
    label: 'Last 90 days', 
    description: 'Import all emails from the past 3 months' 
  },
  { 
    value: 'all_historical_30_days' as ImportMode, 
    label: 'Last 30 days', 
    description: 'A lighter import for smaller inboxes' 
  },
  { 
    value: 'unread_only' as ImportMode, 
    label: 'Unread emails only', 
    description: 'Quick start — just your current unread messages' 
  },
  { 
    value: 'new_only' as ImportMode, 
    label: 'New emails only', 
    description: 'Only receive new emails going forward (no history)' 
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
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('last_1000');
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    status: string;
    stage: string;
    progress: number;
    total: number;
    inboundFound: number;
    outboundFound: number;
    threadsLinked: number;
    voiceProfileStatus: string;
  } | null>(null);

  const handleConnect = async (provider: Provider) => {
    setIsConnecting(true);
    setSelectedProvider(provider);
    
    try {
      const { data, error } = await supabase.functions.invoke('aurinko-auth-start', {
        body: { 
          workspaceId,
          provider,
          importMode,
          origin: window.location.origin
        }
      });

      if (error) throw error;
      
      if (data?.authUrl) {
        // Store that we're expecting a callback
        localStorage.setItem('onboarding_email_pending', 'true');
        localStorage.setItem('onboarding_workspace_id', workspaceId);
        
        // Open OAuth in popup
        const popup = window.open(
          data.authUrl, 
          'email_oauth', 
          'width=600,height=700,left=200,top=100'
        );
        
        // Check if popup was blocked
        if (!popup || popup.closed || typeof popup.closed === 'undefined') {
          toast.info('Opening in new tab instead...');
          // Fallback: open in new tab (will redirect back to onboarding on success)
          window.open(data.authUrl, '_blank');
          setIsConnecting(false);
          return;
        }
        
        // Poll for completion
        const pollInterval = setInterval(async () => {
          if (popup?.closed) {
            clearInterval(pollInterval);
            setIsConnecting(false);
            
            // Check if connection was successful
            await checkEmailConnection();
          }
        }, 1000);
        
        // Timeout after 5 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          if (!connectedEmail) {
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
        .select('email_address, sync_status, sync_stage, sync_progress, sync_total, inbound_emails_found, outbound_emails_found, threads_linked, voice_profile_status')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data?.email_address) {
        setConnectedEmail(data.email_address);
        onEmailConnected(data.email_address);
        
        // Update sync status with detailed info
        if (data.sync_status) {
          setSyncStatus({
            status: data.sync_status,
            stage: data.sync_stage || 'pending',
            progress: data.sync_progress || 0,
            total: data.sync_total || 0,
            inboundFound: data.inbound_emails_found || 0,
            outboundFound: data.outbound_emails_found || 0,
            threadsLinked: data.threads_linked || 0,
            voiceProfileStatus: data.voice_profile_status || 'pending',
          });
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
    }
  };

  // Check on mount and poll for sync progress
  useEffect(() => {
    if (localStorage.getItem('onboarding_email_pending') === 'true') {
      checkEmailConnection();
    }
    
    // Poll for sync progress when connected
    if (connectedEmail) {
      const interval = setInterval(async () => {
        const { data } = await supabase
          .from('email_provider_configs')
          .select('sync_status, sync_stage, sync_progress, sync_total, inbound_emails_found, outbound_emails_found, threads_linked, voice_profile_status')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        
        if (data) {
          setSyncStatus({
            status: data.sync_status || 'pending',
            stage: data.sync_stage || 'pending',
            progress: data.sync_progress || 0,
            total: data.sync_total || 0,
            inboundFound: data.inbound_emails_found || 0,
            outboundFound: data.outbound_emails_found || 0,
            threadsLinked: data.threads_linked || 0,
            voiceProfileStatus: data.voice_profile_status || 'pending',
          });
          
          // Stop polling when complete (including voice profile)
          if (data.sync_status === 'completed' && data.voice_profile_status === 'complete') {
            clearInterval(interval);
          }
          if (data.sync_status === 'error') {
            clearInterval(interval);
          }
        }
      }, 2000);
      
      return () => clearInterval(interval);
    }
  }, [connectedEmail, workspaceId]);

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

          {/* Sync Progress Indicator */}
          {syncStatus && (syncStatus.status !== 'completed' || syncStatus.voiceProfileStatus !== 'complete') && syncStatus.status !== 'error' && (
            <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="font-medium">
                    {syncStatus.stage === 'fetching_inbox' && 'Importing inbox...'}
                    {syncStatus.stage === 'fetching_sent' && 'Importing sent emails...'}
                    {syncStatus.stage === 'analyzing_voice' && 'Learning your writing style...'}
                    {syncStatus.stage === 'complete' && syncStatus.voiceProfileStatus === 'analyzing' && 'Analyzing your writing style...'}
                    {syncStatus.stage === 'pending' && 'Starting import...'}
                    {!['fetching_inbox', 'fetching_sent', 'analyzing_voice', 'complete', 'pending'].includes(syncStatus.stage) && 'Processing...'}
                  </span>
                </div>
                <span className="text-muted-foreground">
                  {syncStatus.stage === 'fetching_inbox' && syncStatus.inboundFound > 0 && `${syncStatus.inboundFound} emails`}
                  {syncStatus.stage === 'fetching_sent' && syncStatus.outboundFound > 0 && `${syncStatus.outboundFound} sent`}
                  {syncStatus.stage === 'analyzing_voice' && syncStatus.outboundFound > 0 && `Analyzing ${syncStatus.outboundFound} emails`}
                </span>
              </div>
              {syncStatus.inboundFound > 0 && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex justify-between">
                    <span>Inbox emails:</span>
                    <span>{syncStatus.inboundFound}</span>
                  </div>
                  {syncStatus.outboundFound > 0 && (
                    <div className="flex justify-between">
                      <span>Your replies found:</span>
                      <span>{syncStatus.outboundFound}</span>
                    </div>
                  )}
                  {syncStatus.threadsLinked > 0 && (
                    <div className="flex justify-between">
                      <span>Conversations linked:</span>
                      <span>{syncStatus.threadsLinked}</span>
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {syncStatus.voiceProfileStatus === 'analyzing' 
                  ? 'BizzyBee is learning how you write so it can match your style.'
                  : 'You can continue while we import your emails in the background.'}
              </p>
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
