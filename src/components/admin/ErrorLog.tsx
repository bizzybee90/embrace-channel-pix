import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface LogEntry {
  id: string;
  level: string;
  function_name: string | null;
  workspace_id: string | null;
  message: string;
  details: unknown;
  stack_trace: string | null;
  created_at: string;
}

export function ErrorLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('system_logs')
        .select('*')
        .in('level', ['error', 'warn'])
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setLogs(data || []);
    } catch (error) {
      console.error('Error fetching logs:', error);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getLevelBadge = (level: string) => {
    switch (level) {
      case 'error':
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Error</Badge>;
      case 'warn':
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Warning</Badge>;
      case 'info':
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">Info</Badge>;
      default:
        return <Badge variant="outline">{level}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Error Log</CardTitle>
        <Button variant="ghost" size="sm" onClick={fetchLogs} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No errors logged</p>
            <p className="text-xs mt-1">System is running smoothly</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {logs.map((log) => (
              <Collapsible key={log.id} open={expandedLogs.has(log.id)}>
                <div className="p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                  <CollapsibleTrigger 
                    className="w-full"
                    onClick={() => toggleExpand(log.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-2 text-left">
                        {getLevelBadge(log.level)}
                        <div>
                          <p className="text-sm font-medium line-clamp-1">{log.message}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            {log.function_name && (
                              <span className="font-mono bg-muted px-1 rounded">{log.function_name}</span>
                            )}
                            <span>{formatDistanceToNow(new Date(log.created_at))} ago</span>
                          </div>
                        </div>
                      </div>
                      {(log.stack_trace || (log.details && typeof log.details === 'object' && Object.keys(log.details).length > 0)) && (
                        expandedLogs.has(log.id) ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )
                      )}
                    </div>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent>
                    <div className="mt-3 pt-3 border-t space-y-2">
                      {log.workspace_id && (
                        <div>
                          <span className="text-xs text-muted-foreground">Workspace: </span>
                          <span className="text-xs font-mono">{log.workspace_id}</span>
                        </div>
                      )}
                      
                      {log.details && typeof log.details === 'object' && Object.keys(log.details).length > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground">Details:</span>
                          <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        </div>
                      )}
                      
                      {log.stack_trace && (
                        <div>
                          <span className="text-xs text-muted-foreground">Stack Trace:</span>
                          <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto whitespace-pre-wrap">
                            {log.stack_trace}
                          </pre>
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
