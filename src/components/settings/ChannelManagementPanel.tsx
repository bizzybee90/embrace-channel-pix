import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/hooks/useWorkspace';
import { MessageSquare, Phone, Mail, Globe, Plus, Cloud, Info, CheckCircle } from 'lucide-react';
import { EmailAccountCard } from './EmailAccountCard';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Channel {
  id: string;
  channel: string;
  enabled: boolean;
}

interface EmailConfig {
  id: string;
  email_address: string;
  provider: string;
  import_mode: string;
  last_sync_at: string | null;
  connected_at: string;
  workspace_id: string;
}

export const ChannelManagementPanel = () => {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [emailConfigs, setEmailConfigs] = useState<EmailConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('gmail');
  const [selectedImportMode, setSelectedImportMode] = useState<string>('all_historical_90_days');

  const importModeLabels: Record<string, string> = {
    new_only: 'New emails only',
    unread_only: 'Unread emails + new',
    all_historical_90_days: 'Last 90 days + new',
  };

  const importModeDescriptions: Record<string, string> = {
    new_only: 'Only receive emails after connecting',
    unread_only: 'Import existing unread emails, then all new',
    all_historical_90_days: 'Import all emails from the last 90 days, then all new',
  };

  const channelIcons: Record<string, any> = {
    sms: Phone,
    whatsapp: MessageSquare,
    email: Mail,
    webchat: Globe
  };

  const channelLabels: Record<string, string> = {
    sms: 'SMS',
    whatsapp: 'WhatsApp',
    email: 'Email',
    webchat: 'Web Chat'
  };

  const providerLabels: Record<string, string> = {
    gmail: 'Gmail',
    outlook: 'Outlook / Microsoft 365',
    icloud: 'Apple Mail / iCloud',
    imap: 'Other (IMAP)',
  };

  useEffect(() => {
    fetchChannels();
    fetchEmailConfigs();

    // Set up realtime subscription for email configs
    if (!workspace?.id) return;
    
    const channel = supabase
      .channel('email-configs-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'email_provider_configs',
          filter: `workspace_id=eq.${workspace.id}`,
        },
        (payload) => {
          console.log('Email config change detected:', payload);
          fetchEmailConfigs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace?.id]);

  const fetchChannels = async () => {
    if (!workspace?.id) return;

    try {
      const { data, error } = await supabase
        .from('workspace_channels')
        .select('*')
        .eq('workspace_id', workspace.id)
        .order('channel');

      if (error) throw error;
      setChannels(data || []);
    } catch (error) {
      console.error('Error fetching channels:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmailConfigs = async () => {
    if (!workspace?.id) return;

    try {
      const { data, error } = await supabase
        .from('email_provider_configs')
        .select('*')
        .eq('workspace_id', workspace.id);

      if (error) throw error;
      setEmailConfigs(data || []);
    } catch (error) {
      console.error('Error fetching email configs:', error);
    }
  };

  const handleConnectEmail = async () => {
    if (!workspace?.id) return;
    
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('aurinko-auth-start', {
        body: { 
          workspaceId: workspace.id,
          provider: selectedProvider,
          importMode: selectedImportMode
        },
      });

      if (error) throw error;
      if (data?.authUrl) {
        window.open(data.authUrl, '_blank', 'width=600,height=700');
        
        // Listen for success/cancel/error message from popup
        const handleMessage = (event: MessageEvent) => {
          if (event.data?.type === 'aurinko-auth-success') {
            toast({ title: 'Email account connected successfully!' });
            fetchEmailConfigs();
            setConnecting(false);
            window.removeEventListener('message', handleMessage);
          } else if (event.data?.type === 'aurinko-auth-cancelled') {
            // User cancelled - just reset state silently
            setConnecting(false);
            window.removeEventListener('message', handleMessage);
          } else if (event.data?.type === 'aurinko-auth-error') {
            toast({ 
              title: 'Failed to connect email', 
              description: event.data.error,
              variant: 'destructive' 
            });
            setConnecting(false);
            window.removeEventListener('message', handleMessage);
          }
        };
        window.addEventListener('message', handleMessage);
        
        // Timeout after 5 minutes
        setTimeout(() => {
          window.removeEventListener('message', handleMessage);
          setConnecting(false);
        }, 300000);
      }
    } catch (error) {
      console.error('Error starting email OAuth:', error);
      toast({ title: 'Failed to connect email', variant: 'destructive' });
      setConnecting(false);
    }
  };

  const toggleChannel = async (channelId: string, currentState: boolean) => {
    try {
      const { error } = await supabase
        .from('workspace_channels')
        .update({ enabled: !currentState })
        .eq('id', channelId);

      if (error) throw error;

      setChannels(channels.map(c => 
        c.id === channelId ? { ...c, enabled: !currentState } : c
      ));

      toast({
        title: 'Channel updated',
        description: `Channel ${!currentState ? 'enabled' : 'disabled'} successfully`
      });
    } catch (error) {
      console.error('Error toggling channel:', error);
      toast({ title: 'Error', description: 'Failed to update channel', variant: 'destructive' });
    }
  };

  if (loading) {
    return <div className="p-6">Loading channels...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Email Integration Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Accounts
          </h3>
          <p className="text-sm text-muted-foreground">
            Connect email accounts to receive and send emails directly. Supports Gmail, Outlook, Apple Mail, and more.
          </p>
        </div>

        {emailConfigs.length > 0 && (
          <div className="space-y-3">
            {emailConfigs.map(config => (
              <EmailAccountCard
                key={config.id}
                config={config}
                onDisconnect={fetchEmailConfigs}
                onUpdate={fetchEmailConfigs}
              />
            ))}
          </div>
        )}

        <Card className="p-6 border-dashed">
          <div className="text-center space-y-4">
            <Cloud className="h-10 w-10 mx-auto text-muted-foreground" />
            <div>
              <p className="font-medium">
                {emailConfigs.length > 0 ? 'Add another email account' : 'No email account connected'}
              </p>
              <p className="text-sm text-muted-foreground">
                Connect your email to handle conversations across providers
              </p>
            </div>
            
            <div className="flex flex-col items-center gap-3">
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gmail">Gmail</SelectItem>
                    <SelectItem value="outlook">Outlook / Microsoft 365</SelectItem>
                    <SelectItem value="icloud">Apple Mail / iCloud</SelectItem>
                    <SelectItem value="imap">Other (IMAP)</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-1">
                  <Select value={selectedImportMode} onValueChange={setSelectedImportMode}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Import mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_historical_90_days">Last 90 days + new</SelectItem>
                      <SelectItem value="unread_only">Unread + new</SelectItem>
                      <SelectItem value="new_only">New emails only</SelectItem>
                    </SelectContent>
                  </Select>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="font-medium">{importModeLabels[selectedImportMode]}</p>
                      <p className="text-xs text-muted-foreground">{importModeDescriptions[selectedImportMode]}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              
              <Button onClick={handleConnectEmail} disabled={connecting}>
                <Plus className="h-4 w-4 mr-2" />
                {connecting ? 'Connecting...' : `Connect ${providerLabels[selectedProvider]}`}
              </Button>

              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle className="h-3 w-3 text-green-500" />
                Real-time sync enabled - new emails arrive instantly
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Other Channels Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Other Channels</h3>
          <p className="text-sm text-muted-foreground">
            Enable or disable communication channels for your workspace
          </p>
        </div>

        <div className="space-y-3">
          {channels.filter(c => c.channel !== 'email').map((channel) => {
            const Icon = channelIcons[channel.channel];
            return (
              <Card key={channel.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${channel.enabled ? 'bg-primary/10 text-primary' : 'bg-muted'}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{channelLabels[channel.channel]}</span>
                        {channel.enabled && <Badge variant="secondary" className="text-xs">Active</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {channel.channel === 'sms' && 'Text message communication'}
                        {channel.channel === 'whatsapp' && 'WhatsApp Business messaging'}
                        {channel.channel === 'webchat' && 'Website chat widget (coming soon)'}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={channel.enabled}
                    onCheckedChange={() => toggleChannel(channel.id, channel.enabled)}
                    disabled={channel.channel === 'webchat'}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
};
