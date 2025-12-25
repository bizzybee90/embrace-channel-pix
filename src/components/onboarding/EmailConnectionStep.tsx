import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Mail, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';

interface EmailConnectionStepProps {
  workspaceId: string;
  onNext: () => void;
  onBack: () => void;
  onEmailConnected: (email: string) => void;
}

type Provider = 'gmail' | 'outlook' | 'icloud' | 'yahoo';
type ImportMode = 'new_only' | 'unread_only' | 'all_historical_90_days';

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
    available: true  // Aurinko supports iCloud!
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
    value: 'unread_only' as ImportMode, 
    label: 'Unread emails only', 
    description: 'Import your current unread emails (recommended for quick start)' 
  },
  { 
    value: 'all_historical_90_days' as ImportMode, 
    label: 'Last 90 days', 
    description: 'Import all emails from the past 90 days for better AI learning' 
  },
  { 
    value: 'new_only' as ImportMode, 
    label: 'New emails only', 
    description: 'Only receive new emails going forward' 
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
  const [importMode, setImportMode] = useState<ImportMode>('unread_only');
  const [checkingConnection, setCheckingConnection] = useState(false);

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
        .select('email_address')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data?.email_address) {
        setConnectedEmail(data.email_address);
        onEmailConnected(data.email_address);
        toast.success(`Connected to ${data.email_address}`);
        localStorage.removeItem('onboarding_email_pending');
        localStorage.removeItem('onboarding_workspace_id');
      }
    } catch (error) {
      console.error('Error checking connection:', error);
    } finally {
      setCheckingConnection(false);
    }
  };

  // Check on mount if we have a pending connection
  useState(() => {
    if (localStorage.getItem('onboarding_email_pending') === 'true') {
      checkEmailConnection();
    }
  });

  return (
    <div className="space-y-6">
      <div className="text-center">
        <CardTitle className="text-xl">Connect Your Email</CardTitle>
        <CardDescription className="mt-2">
          BizzyBee will learn from your inbox to handle emails just like you would.
        </CardDescription>
      </div>

      {connectedEmail ? (
        <div className="space-y-6">
          <div className="flex items-center justify-center gap-3 p-4 bg-success/10 rounded-lg border border-success/30">
            <CheckCircle2 className="h-6 w-6 text-success" />
            <div className="text-center">
              <p className="font-medium text-foreground">Email Connected!</p>
              <p className="text-sm text-muted-foreground">{connectedEmail}</p>
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button onClick={onNext} className="flex-1">
              Continue
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
                  className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent/50 cursor-pointer"
                  onClick={() => setImportMode(mode.value)}
                >
                  <RadioGroupItem value={mode.value} id={mode.value} className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor={mode.value} className="font-medium cursor-pointer">
                      {mode.label}
                    </Label>
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
