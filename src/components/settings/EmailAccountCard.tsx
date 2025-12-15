import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Mail, RefreshCw, Trash2, Clock, CheckCircle, Plus, X } from 'lucide-react';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface EmailConfig {
  id: string;
  email_address: string;
  provider: string;
  import_mode: string;
  last_sync_at: string | null;
  connected_at: string;
  workspace_id: string;
  aliases?: string[];
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
  const [aliasesOpen, setAliasesOpen] = useState(false);
  const [newAlias, setNewAlias] = useState('');
  const [addingAlias, setAddingAlias] = useState(false);

  const aliases = config.aliases || [];

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('email-sync', {
        body: { configId: config.id, mode: config.import_mode },
      });

      if (error) throw error;

      toast({
        title: 'Sync complete',
        description: `Processed ${data?.messagesProcessed || 0} messages`,
      });
      onUpdate();
    } catch (error: any) {
      console.error('Error syncing email:', error);
      const message =
        (typeof error?.message === 'string' && error.message) ||
        (typeof error?.details === 'string' && error.details) ||
        'Unknown error';
      toast({
        title: 'Sync failed',
        description: message,
        variant: 'destructive',
      });
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

  const handleAddAlias = async () => {
    if (!newAlias.trim()) return;
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newAlias.trim())) {
      toast({ title: 'Invalid email', description: 'Please enter a valid email address', variant: 'destructive' });
      return;
    }

    // Check if alias already exists
    if (aliases.includes(newAlias.trim().toLowerCase())) {
      toast({ title: 'Alias exists', description: 'This alias is already added', variant: 'destructive' });
      return;
    }

    setAddingAlias(true);
    try {
      const updatedAliases = [...aliases, newAlias.trim().toLowerCase()];
      const { error } = await supabase
        .from('email_provider_configs')
        .update({ aliases: updatedAliases })
        .eq('id', config.id);

      if (error) throw error;
      
      toast({ title: 'Alias added', description: `${newAlias} added as an alias` });
      setNewAlias('');
      onUpdate();
    } catch (error) {
      console.error('Error adding alias:', error);
      toast({ title: 'Failed to add alias', variant: 'destructive' });
    } finally {
      setAddingAlias(false);
    }
  };

  const handleRemoveAlias = async (aliasToRemove: string) => {
    try {
      const updatedAliases = aliases.filter(a => a !== aliasToRemove);
      const { error } = await supabase
        .from('email_provider_configs')
        .update({ aliases: updatedAliases })
        .eq('id', config.id);

      if (error) throw error;
      
      toast({ title: 'Alias removed', description: `${aliasToRemove} removed` });
      onUpdate();
    } catch (error) {
      console.error('Error removing alias:', error);
      toast({ title: 'Failed to remove alias', variant: 'destructive' });
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

      {/* Aliases Section */}
      <Collapsible open={aliasesOpen} onOpenChange={setAliasesOpen} className="mt-4">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground">
            <span className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email Aliases ({aliases.length})
            </span>
            <span className="text-xs">{aliasesOpen ? 'Hide' : 'Manage'}</span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Add email aliases that route to this account. Replies will be sent from the address the customer originally emailed.
          </p>
          
          {/* Existing aliases */}
          {aliases.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {aliases.map((alias) => (
                <Badge key={alias} variant="secondary" className="flex items-center gap-1 pr-1">
                  {alias}
                  <button
                    onClick={() => handleRemoveAlias(alias)}
                    className="ml-1 p-0.5 rounded-full hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          
          {/* Add new alias */}
          <div className="flex gap-2">
            <Input
              placeholder="Enter alias email (e.g., info@maccleaning.uk)"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddAlias()}
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={handleAddAlias}
              disabled={addingAlias || !newAlias.trim()}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};
