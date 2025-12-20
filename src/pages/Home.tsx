import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNavigate } from 'react-router-dom';
import { 
  Mail, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Sparkles,
  Brain,
  TrendingUp,
  BookOpen
} from 'lucide-react';
import beeLogo from '@/assets/bee-logo.png';
import { formatDistanceToNow } from 'date-fns';

interface HomeStats {
  clearedToday: number;
  toReplyCount: number;
  atRiskCount: number;
  reviewCount: number;
  lastHandled: Date | null;
}

interface LearningMetrics {
  rulesLearnedThisMonth: number;
  accuracyRate: number;
  totalReviewed: number;
}

export const Home = () => {
  const { workspace } = useWorkspace();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [stats, setStats] = useState<HomeStats>({
    clearedToday: 0,
    toReplyCount: 0,
    atRiskCount: 0,
    reviewCount: 0,
    lastHandled: null,
  });
  const [learningMetrics, setLearningMetrics] = useState<LearningMetrics>({
    rulesLearnedThisMonth: 0,
    accuracyRate: 0,
    totalReviewed: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      if (!workspace?.id) return;

      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        const [
          clearedResult, 
          toReplyResult, 
          atRiskResult, 
          reviewResult,
          lastHandledResult,
          rulesResult,
          reviewedResult
        ] = await Promise.all([
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
          // Review queue count
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .eq('needs_review', true)
            .is('reviewed_at', null),
          // Last handled conversation
          supabase
            .from('conversations')
            .select('auto_handled_at')
            .eq('workspace_id', workspace.id)
            .eq('decision_bucket', 'auto_handled')
            .order('auto_handled_at', { ascending: false })
            .limit(1),
          // Rules learned this month
          supabase
            .from('sender_rules')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .gte('created_at', monthStart.toISOString()),
          // Review accuracy
          supabase
            .from('conversations')
            .select('review_outcome')
            .eq('workspace_id', workspace.id)
            .not('reviewed_at', 'is', null)
            .gte('reviewed_at', monthStart.toISOString()),
        ]);

        // Calculate accuracy rate
        const reviewedConversations = reviewedResult.data || [];
        const confirmed = reviewedConversations.filter(c => c.review_outcome === 'confirmed').length;
        const total = reviewedConversations.length;
        const accuracy = total > 0 ? Math.round((confirmed / total) * 100) : 0;

        setStats({
          clearedToday: clearedResult.count || 0,
          toReplyCount: toReplyResult.count || 0,
          atRiskCount: atRiskResult.count || 0,
          reviewCount: reviewResult.count || 0,
          lastHandled: lastHandledResult.data?.[0]?.auto_handled_at 
            ? new Date(lastHandledResult.data[0].auto_handled_at) 
            : null,
        });

        setLearningMetrics({
          rulesLearnedThisMonth: rulesResult.count || 0,
          accuracyRate: accuracy,
          totalReviewed: total,
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

  // Get time-appropriate greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const mainContent = (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-8">
      {loading ? (
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      ) : (
        <div className="w-full max-w-lg space-y-8">
          {/* Executive Briefing - Jace-inspired */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <img src={beeLogo} alt="BizzyBee" className="h-16 w-16 rounded-2xl" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-foreground">
                {getGreeting()}
              </h1>
              <p className="text-lg text-muted-foreground">
                {stats.clearedToday > 0 ? (
                  <>BizzyBee handled <span className="font-semibold text-foreground">{stats.clearedToday} messages</span> for you today</>
                ) : (
                  'BizzyBee is ready to help'
                )}
              </p>
              {stats.toReplyCount > 0 && (
                <p className="text-base text-muted-foreground">
                  <span className="font-semibold text-destructive">{stats.toReplyCount}</span> need{stats.toReplyCount === 1 ? 's' : ''} your attention
                </p>
              )}
              {stats.lastHandled && (
                <p className="text-sm text-muted-foreground/70">
                  Last message handled {formatDistanceToNow(stats.lastHandled, { addSuffix: true })}
                </p>
              )}
            </div>
          </div>

          {/* Action Cards */}
          <div className="grid grid-cols-1 gap-4">
            {/* To Reply */}
            {stats.toReplyCount > 0 && (
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
            )}

            {/* Review Queue */}
            {stats.reviewCount > 0 && (
              <Card 
                className="p-5 cursor-pointer hover:bg-accent/50 transition-colors border-l-4 border-l-purple-500"
                onClick={() => navigate('/review')}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-purple-500/10">
                      <Sparkles className="h-5 w-5 text-purple-500" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Review Queue</p>
                      <p className="text-sm text-muted-foreground">Help BizzyBee learn</p>
                    </div>
                  </div>
                  <span className="text-2xl font-bold text-purple-500">{stats.reviewCount}</span>
                </div>
              </Card>
            )}

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

            {/* All caught up state */}
            {stats.toReplyCount === 0 && stats.reviewCount === 0 && stats.atRiskCount === 0 && (
              <Card className="p-6 text-center border-l-4 border-l-green-500">
                <div className="flex flex-col items-center gap-3">
                  <div className="p-3 rounded-full bg-green-500/10">
                    <CheckCircle2 className="h-6 w-6 text-green-500" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">You're all caught up!</p>
                    <p className="text-sm text-muted-foreground">
                      BizzyBee is handling your inbox
                    </p>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Learning Metrics - QuickBooks-inspired */}
          {(learningMetrics.rulesLearnedThisMonth > 0 || learningMetrics.totalReviewed > 0) && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Brain className="h-4 w-4" />
                <span>BizzyBee is learning</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted/30 rounded-lg p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-lg font-semibold text-foreground">
                    <BookOpen className="h-4 w-4 text-purple-500" />
                    {learningMetrics.rulesLearnedThisMonth}
                  </div>
                  <p className="text-xs text-muted-foreground">Rules learned</p>
                </div>
                {learningMetrics.totalReviewed > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-lg font-semibold text-foreground">
                      <TrendingUp className="h-4 w-4 text-green-500" />
                      {learningMetrics.accuracyRate}%
                    </div>
                    <p className="text-xs text-muted-foreground">Accuracy</p>
                  </div>
                )}
                <div className="bg-muted/30 rounded-lg p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-lg font-semibold text-foreground">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    {learningMetrics.totalReviewed}
                  </div>
                  <p className="text-xs text-muted-foreground">Reviewed</p>
                </div>
              </div>
            </div>
          )}

          {/* System Status */}
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