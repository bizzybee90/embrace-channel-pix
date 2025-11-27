import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  RefreshCw, 
  Database, 
  CheckCircle, 
  XCircle, 
  Clock,
  Copy,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface SyncLog {
  id: string;
  sync_type: string;
  tables_synced: string[];
  started_at: string;
  completed_at: string | null;
  status: string;
  records_fetched: number;
  records_inserted: number;
  records_updated: number;
  records_unchanged: number;
  error_message: string | null;
  details: any;
}

export function DataSyncPanel() {
  const [syncing, setSyncing] = useState(false);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/receive-apify-data`;

  useEffect(() => {
    loadSyncLogs();
  }, []);

  const loadSyncLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('sync_logs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setLogs(data || []);
    } catch (error) {
      console.error('Error loading sync logs:', error);
      toast({
        title: 'Error',
        description: 'Failed to load sync history',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (tables?: string[]) => {
    setSyncing(true);
    try {
      const tablesToSync = tables || ['faq_database', 'price_list', 'business_facts', 'conversations'];
      const params = new URLSearchParams({
        tables: tablesToSync.join(','),
        full: 'true',
      });

      const { data, error } = await supabase.functions.invoke('sync-external-data', {
        body: { tables: tablesToSync, full: true },
      });

      if (error) throw error;

      toast({
        title: 'Sync Complete',
        description: `Synced ${data.totals.fetched} records (${data.totals.inserted} new, ${data.totals.updated} updated)`,
      });

      // Reload logs
      await loadSyncLogs();
    } catch (error) {
      console.error('Error syncing:', error);
      toast({
        title: 'Sync Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast({
      title: 'Copied',
      description: 'Webhook URL copied to clipboard',
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'running':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      success: 'default',
      failed: 'destructive',
      running: 'secondary',
    };
    return <Badge variant={variants[status] || 'secondary'}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold mb-2">Data Sync</h2>
            <p className="text-muted-foreground">
              Sync your knowledge base from BizzyBee 1 to Lovable Cloud. Customer data is synced via Apify webhooks.
            </p>
          </div>
          <Database className="h-8 w-8 text-primary" />
        </div>

        {/* Sync Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div className="space-y-2">
            <h3 className="font-semibold">Quick Sync</h3>
            <Button 
              onClick={() => handleSync()}
              disabled={syncing}
              className="w-full"
            >
              {syncing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync All Tables
                </>
              )}
            </Button>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold">Selective Sync</h3>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSync(['faq_database'])}
                disabled={syncing}
              >
                FAQs
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSync(['price_list'])}
                disabled={syncing}
              >
                Pricing
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSync(['business_facts'])}
                disabled={syncing}
              >
                Facts
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSync(['conversations'])}
                disabled={syncing}
              >
                Conversations
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Apify Webhook Configuration */}
      <Card className="p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          Apify Webhook Configuration
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          Configure this webhook URL in your Apify scraper to send customer data directly to Lovable Cloud:
        </p>
        <div className="flex gap-2">
          <code className="flex-1 px-3 py-2 bg-muted rounded text-sm break-all">
            {webhookUrl}
          </code>
          <Button variant="outline" size="icon" onClick={copyWebhookUrl}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      {/* Sync History */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Sync History</h3>
          <Button variant="ghost" size="sm" onClick={loadSyncLogs}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Database className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No sync history yet</p>
            <p className="text-sm">Click "Sync All Tables" to start syncing data</p>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(log.status)}
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {log.sync_type === 'full' ? 'Full Sync' : 'Incremental Sync'}
                        {getStatusBadge(log.status)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(log.started_at), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mt-3">
                  <div>
                    <div className="text-muted-foreground">Fetched</div>
                    <div className="font-semibold">{log.records_fetched}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Inserted</div>
                    <div className="font-semibold text-green-600">{log.records_inserted}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Updated</div>
                    <div className="font-semibold text-blue-600">{log.records_updated}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Unchanged</div>
                    <div className="font-semibold">{log.records_unchanged}</div>
                  </div>
                </div>

                {log.tables_synced && log.tables_synced.length > 0 && (
                  <div className="mt-3 flex gap-2">
                    {log.tables_synced.map((table) => (
                      <Badge key={table} variant="outline">
                        {table.replace('_', ' ')}
                      </Badge>
                    ))}
                  </div>
                )}

                {log.error_message && (
                  <div className="mt-3 text-sm text-destructive bg-destructive/10 p-2 rounded">
                    {log.error_message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Schedule Info */}
      <Card className="p-6 bg-muted/50">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Automatic Sync Schedule
        </h3>
        <p className="text-sm text-muted-foreground">
          Knowledge base data (FAQs, pricing, business facts, conversations) syncs automatically daily at 3:00 AM UTC.
          Customer data is synced in real-time via Apify webhooks every 8-12 hours.
        </p>
      </Card>
    </div>
  );
}
