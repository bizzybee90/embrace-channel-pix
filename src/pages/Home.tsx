import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNavigate } from 'react-router-dom';
import { Mail, AlertTriangle, Star, CheckCircle2, Clock } from 'lucide-react';
import beeLogo from '@/assets/bee-logo.png';
import { formatDistanceToNow } from 'date-fns';

interface HomeStats {
  clearedToday: number;
  toReplyCount: number;
  atRiskCount: number;
  vipWaiting: number;
  lastHandled: Date | null;
}

export const Home = () => {
  const { workspace } = useWorkspace();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [stats, setStats] = useState<HomeStats>({
    clearedToday: 0,
    toReplyCount: 0,
    atRiskCount: 0,
    vipWaiting: 0,
    lastHandled: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      if (!workspace?.id) return;

      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [clearedResult, toReplyResult, atRiskResult, lastHandledResult] = await Promise.all([
          // Cleared today (auto_handled + resolved)
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .or('decision_bucket.eq.auto_handled,status.eq.resolved')
            .gte('updated_at', today.toISOString()),
          // To Reply count
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .in('decision_bucket', ['act_now', 'quick_win'])
            .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']),
          // At Risk (SLA breached or warning)
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .in('sla_status', ['warning', 'breached'])
            .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']),
          // Last handled conversation
          supabase
            .from('conversations')
            .select('auto_handled_at')
            .eq('workspace_id', workspace.id)
            .eq('decision_bucket', 'auto_handled')
            .order('auto_handled_at', { ascending: false })
            .limit(1),
        ]);

        setStats({
          clearedToday: clearedResult.count || 0,
          toReplyCount: toReplyResult.count || 0,
          atRiskCount: atRiskResult.count || 0,
          vipWaiting: 0, // TODO: Add VIP logic if needed
          lastHandled: lastHandledResult.data?.[0]?.auto_handled_at 
            ? new Date(lastHandledResult.data[0].auto_handled_at) 
            : null,
        });
      } catch (error) {
        console.error('Error fetching home stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();

    // Realtime subscription
    const channel = supabase
      .channel('home-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspace?.id}`
        },
        () => {
          fetchStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace?.id]);

  const mainContent = (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-8">
      {loading ? (
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      ) : (
        <div className="w-full max-w-lg space-y-8">
          {/* Hero Metric - Calm and reassuring */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <img src={beeLogo} alt="BizzyBee" className="h-16 w-16 rounded-2xl" />
            </div>
            <div className="space-y-2">
              <h1 className="text-4xl font-bold text-foreground">
                {stats.clearedToday}
              </h1>
              <p className="text-lg text-muted-foreground">
                🐝 BizzyBee cleared {stats.clearedToday} messages for you today
              </p>
              {stats.lastHandled && (
                <p className="text-sm text-muted-foreground/70">
                  Last message handled {formatDistanceToNow(stats.lastHandled, { addSuffix: true })}
                </p>
              )}
            </div>
          </div>

          {/* Quick Glance Cards */}
          <div className="grid grid-cols-1 gap-4">
            {/* To Reply */}
            <Card 
              className="p-5 cursor-pointer hover:bg-accent/50 transition-colors border-l-4 border-l-destructive"
              onClick={() => navigate('/to-reply')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <Mail className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">To Reply</p>
                    <p className="text-sm text-muted-foreground">Needs your attention</p>
                  </div>
                </div>
                <span className="text-2xl font-bold text-destructive">{stats.toReplyCount}</span>
              </div>
            </Card>

            {/* At Risk */}
            {stats.atRiskCount > 0 && (
              <Card 
                className="p-5 cursor-pointer hover:bg-accent/50 transition-colors border-l-4 border-l-amber-500"
                onClick={() => navigate('/to-reply')}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-amber-500/10">
                      <AlertTriangle className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">At Risk</p>
                      <p className="text-sm text-muted-foreground">SLA approaching</p>
                    </div>
                  </div>
                  <span className="text-2xl font-bold text-amber-500">{stats.atRiskCount}</span>
                </div>
              </Card>
            )}
          </div>

          {/* System Status - Trust building */}
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>System active</span>
            <span className="text-muted-foreground/50">•</span>
            <Clock className="h-4 w-4" />
            <span>Checking every minute</span>
          </div>
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div className="min-h-screen bg-background">
        {mainContent}
      </div>
    );
  }

  return (
    <ThreeColumnLayout
      sidebar={<Sidebar />}
      main={mainContent}
    />
  );
};

export default Home;
