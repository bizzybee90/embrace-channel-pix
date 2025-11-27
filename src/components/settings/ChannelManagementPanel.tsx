import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/hooks/useWorkspace';
import { MessageSquare, Phone, Mail, Globe } from 'lucide-react';

interface Channel {
  id: string;
  channel: string;
  enabled: boolean;
}

export const ChannelManagementPanel = () => {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    fetchChannels();
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
      toast({
        title: 'Error',
        description: 'Failed to load channel settings',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
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
      toast({
        title: 'Error',
        description: 'Failed to update channel',
        variant: 'destructive'
      });
    }
  };

  if (loading) {
    return <div className="p-6">Loading channels...</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Channel Management</h3>
        <p className="text-sm text-muted-foreground">
          Enable or disable communication channels for your workspace
        </p>
      </div>

      <div className="space-y-3">
        {channels.map((channel) => {
          const Icon = channelIcons[channel.channel];
          return (
            <Card key={channel.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    channel.enabled ? 'bg-primary/10 text-primary' : 'bg-muted'
                  }`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{channelLabels[channel.channel]}</span>
                      {channel.enabled && (
                        <Badge variant="secondary" className="text-xs">Active</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {channel.channel === 'sms' && 'Text message communication'}
                      {channel.channel === 'whatsapp' && 'WhatsApp Business messaging'}
                      {channel.channel === 'email' && 'Email support (requires Postmark)'}
                      {channel.channel === 'webchat' && 'Website chat widget (coming soon)'}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={channel.enabled}
                  onCheckedChange={() => toggleChannel(channel.id, channel.enabled)}
                  disabled={channel.channel === 'email' || channel.channel === 'webchat'}
                  aria-label={`Toggle ${channelLabels[channel.channel]} channel`}
                />
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-4 bg-muted/50">
        <p className="text-sm text-muted-foreground">
          <strong>Note:</strong> Email and Web Chat channels require additional configuration. 
          Contact support to enable these channels for your workspace.
        </p>
      </Card>
    </div>
  );
};
