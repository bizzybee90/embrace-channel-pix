import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Mail, RefreshCw, Trash2, Clock, CheckCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface EmailConfig {
  id: string;
  email_address: string;
  provider: string;
  import_mode: string;
  last_sync_at: string | null;
  connected_at: string;
  workspace_id: string;
}

interface EmailAccountCardProps {
  config: EmailConfig;
  onDisconnect: () => void;
  onUpdate: () => void;
}

const providerIcons: Record<string, string> = {
  'Google': '📧',
  'Office365': '📬',
  'iCloud': '🍎',
  'IMAP': '📨',
};

const providerLabels: Record<string, string> = {
  'Google': 'Gmail',
  'Office365': 'Outlook',
  'iCloud': 'Apple Mail',
  'IMAP': 'IMAP',
};

export const EmailAccountCard = ({ config, onDisconnect, onUpdate }: EmailAccountCardProps) => {
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      // For now, just update the last_sync_at timestamp
      // In a full implementation, this would trigger a sync via Aurinko API
      const { error } = await supabase
        .from('email_provider_configs')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', config.id);

      if (error) throw error;
      
      toast({ title: 'Sync complete', description: 'Email account synced successfully' });
      onUpdate();
    } catch (error) {
      console.error('Error syncing email:', error);
      toast({ title: 'Sync failed', variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { error } = await supabase
        .from('email_provider_configs')
        .delete()
        .eq('id', config.id);

      if (error) throw error;
      
      toast({ title: 'Email disconnected', description: 'Account has been removed' });
      onDisconnect();
    } catch (error) {
      console.error('Error disconnecting email:', error);
      toast({ title: 'Failed to disconnect', variant: 'destructive' });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{config.email_address}</span>
              <Badge variant="secondary" className="text-xs">
                {providerIcons[config.provider] || '📧'} {providerLabels[config.provider] || config.provider}
              </Badge>
              <Badge variant="outline" className="text-xs text-green-600">
                <CheckCircle className="h-3 w-3 mr-1" />
                Connected
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Connected {formatDistanceToNow(new Date(config.connected_at), { addSuffix: true })}
              </span>
              {config.last_sync_at && (
                <span>
                  Last synced {formatDistanceToNow(new Date(config.last_sync_at), { addSuffix: true })}
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync'}
          </Button>
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect email account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove {config.email_address} from your workspace. 
                  You won't receive new emails from this account, but existing conversations will be preserved.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </Card>
  );
};
