import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Activity, 
  Bot, 
  Send, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  Zap,
  TrendingUp,
  Mail,
  MessageSquare
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { formatDistanceToNow } from 'date-fns';

interface RecentAction {
  id: string;
  type: 'sent' | 'auto_handled' | 'escalated' | 'drafted';
  title: string;
  timestamp: Date;
  channel: string;
}

interface LiveStats {
  activeNow: number;
  sentToday: number;
  autoHandledToday: number;
  escalatedToday: number;
  avgResponseTime: string;
  aiConfidence: number;
}

export const LiveAISummaryWidget = () => {
  const { workspace } = useWorkspace();
  const [stats, setStats] = useState<LiveStats>({
    activeNow: 0,
    sentToday: 0,
    autoHandledToday: 0,
    escalatedToday: 0,
    avgResponseTime: '--',
    aiConfidence: 0
  });
  const [recentActions, setRecentActions] = useState<RecentAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulseActive, setPulseActive] = useState(false);

  const fetchData = async () => {
    if (!workspace?.id) return;

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString();

      const [
        activeResult,
        sentResult,
        autoHandledResult,
        escalatedResult,
        recentResult,
        confidenceResult
      ] = await Promise.all([
        // Active/in-progress conversations
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .in('status', ['new', 'open', 'ai_handling', 'waiting_internal']),
        // Sent today
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .not('final_response', 'is', null)
          .gte('updated_at', todayStr),
        // Auto-handled today
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .eq('decision_bucket', 'auto_handled')
          .gte('auto_handled_at', todayStr),
        // Escalated today
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .eq('is_escalated', true)
          .gte('escalated_at', todayStr),
        // Recent actions (last 5)
        supabase
          .from('conversations')
          .select('id, title, channel, decision_bucket, final_response, auto_handled_at, is_escalated, escalated_at, updated_at')
          .eq('workspace_id', workspace.id)
          .order('updated_at', { ascending: false })
          .limit(5),
        // Average confidence
        supabase
          .from('conversations')
          .select('ai_confidence')
          .eq('workspace_id', workspace.id)
          .not('ai_confidence', 'is', null)
          .gte('created_at', todayStr)
      ]);

      // Calculate average confidence
      const confidences = confidenceResult.data?.filter(c => c.ai_confidence !== null) || [];
      const avgConfidence = confidences.length > 0
        ? confidences.reduce((sum, c) => sum + (c.ai_confidence || 0), 0) / confidences.length
        : 0;

      setStats({
        activeNow: activeResult.count || 0,
        sentToday: sentResult.count || 0,
        autoHandledToday: autoHandledResult.count || 0,
        escalatedToday: escalatedResult.count || 0,
        avgResponseTime: '--',
        aiConfidence: Math.round(avgConfidence)
      });

      // Map recent conversations to actions
      const actions: RecentAction[] = (recentResult.data || []).map(conv => {
        let type: RecentAction['type'] = 'drafted';
        if (conv.final_response) type = 'sent';
        else if (conv.decision_bucket === 'auto_handled') type = 'auto_handled';
        else if (conv.is_escalated) type = 'escalated';

        return {
          id: conv.id,
          type,
          title: conv.title || 'Untitled conversation',
          timestamp: new Date(conv.updated_at),
          channel: conv.channel || 'email'
        };
      });

      setRecentActions(actions);
    } catch (error) {
      console.error('Error fetching live stats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Set up realtime subscription
    const channel = supabase
      .channel('live-summary-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspace?.id}`
        },
        () => {
          // Trigger pulse animation on update
          setPulseActive(true);
          setTimeout(() => setPulseActive(false), 1000);
          fetchData();
        }
      )
      .subscribe();

    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [workspace?.id]);

  const getActionIcon = (type: RecentAction['type']) => {
    switch (type) {
      case 'sent': return <Send className="h-3 w-3 text-green-500" />;
      case 'auto_handled': return <Bot className="h-3 w-3 text-blue-500" />;
      case 'escalated': return <AlertCircle className="h-3 w-3 text-orange-500" />;
      case 'drafted': return <Mail className="h-3 w-3 text-muted-foreground" />;
    }
  };

  const getActionLabel = (type: RecentAction['type']) => {
    switch (type) {
      case 'sent': return 'Sent';
      case 'auto_handled': return 'Auto-handled';
      case 'escalated': return 'Escalated';
      case 'drafted': return 'Draft ready';
    }
  };

  if (loading) {
    return (
      <Card className="bg-gradient-to-r from-primary/5 via-background to-primary/5 border-primary/20">
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1">
              <div className="h-4 w-32 bg-muted rounded animate-pulse" />
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className={`bg-gradient-to-r from-primary/5 via-background to-primary/5 border-primary/20 transition-all ${pulseActive ? 'ring-2 ring-primary/30' : ''}`}>
      <div className="p-4">
        {/* Header with live indicator */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <div className="absolute inset-0 h-2 w-2 rounded-full bg-green-500 animate-ping" />
            </div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Live Status</span>
          </div>
          <Badge variant="outline" className="text-xs gap-1">
            <Zap className="h-3 w-3 text-amber-500" />
            {stats.aiConfidence}% AI confidence
          </Badge>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <MessageSquare className="h-4 w-4 text-blue-500" />
              <span className="text-lg font-bold">{stats.activeNow}</span>
            </div>
            <p className="text-[10px] text-muted-foreground uppercase">Active</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Send className="h-4 w-4 text-green-500" />
              <span className="text-lg font-bold">{stats.sentToday}</span>
            </div>
            <p className="text-[10px] text-muted-foreground uppercase">Sent</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Bot className="h-4 w-4 text-purple-500" />
              <span className="text-lg font-bold">{stats.autoHandledToday}</span>
            </div>
            <p className="text-[10px] text-muted-foreground uppercase">Auto</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <AlertCircle className="h-4 w-4 text-orange-500" />
              <span className="text-lg font-bold">{stats.escalatedToday}</span>
            </div>
            <p className="text-[10px] text-muted-foreground uppercase">Escalated</p>
          </div>
        </div>

        {/* Recent actions */}
        {recentActions.length > 0 && (
          <div className="border-t border-border/50 pt-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Recent AI Actions</p>
            <div className="space-y-1.5">
              {recentActions.slice(0, 3).map((action) => (
                <div key={action.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    {getActionIcon(action.type)}
                    <span className="truncate text-muted-foreground">{action.title}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {getActionLabel(action.type)}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(action.timestamp, { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
