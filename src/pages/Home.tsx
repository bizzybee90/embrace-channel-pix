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
  Activity,
  FileEdit,
  Users,
  ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import beeLogo from '@/assets/bee-logo.png';
import { formatDistanceToNow } from 'date-fns';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { DraftMessages } from '@/components/dashboard/DraftMessages';
import { HumanAIActivityLog } from '@/components/dashboard/HumanAIActivityLog';
import { AIBriefingWidget } from '@/components/dashboard/AIBriefingWidget';
import { LearningInsightsWidget } from '@/components/dashboard/LearningInsightsWidget';
import { ScrollArea } from '@/components/ui/scroll-area';

interface HomeStats {
  clearedToday: number;
  toReplyCount: number;
  atRiskCount: number;
  reviewCount: number;
  draftCount: number;
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
    reviewCount: 0,
    draftCount: 0,
    lastHandled: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      if (!workspace?.id) return;

      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [
          clearedResult, 
          toReplyResult, 
          atRiskResult, 
          reviewResult,
          draftResult,
          lastHandledResult
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
          // Draft count
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .not('ai_draft_response', 'is', null)
            .is('final_response', null)
            .in('status', ['new', 'open', 'ai_handling'])
            .in('decision_bucket', ['quick_win', 'act_now'])
            .eq('requires_reply', true),
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
          reviewCount: reviewResult.count || 0,
          draftCount: draftResult.count || 0,
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

  // Get time-appropriate greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  const mainContent = (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="p-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header with greeting */}
            <div className="flex items-center gap-4">
              <img src={beeLogo} alt="BizzyBee" className="h-12 w-12 rounded-xl" />
              <div>
                <h1 className="text-xl font-semibold text-foreground">
                  {getGreeting()}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {stats.clearedToday > 0 ? (
                    <>BizzyBee handled <span className="font-medium text-foreground">{stats.clearedToday}</span> messages today</>
                  ) : (
                    'BizzyBee is ready to help'
                  )}
                  {stats.lastHandled && (
                    <> • Last: {formatDistanceToNow(stats.lastHandled, { addSuffix: true })}</>
                  )}
                </p>
              </div>
            </div>

            {/* Summary Banner - Calm, structured framing */}
            {(stats.atRiskCount > 0 || stats.reviewCount > 0 || stats.toReplyCount > 0 || stats.draftCount > 0) && (
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Here's what BizzyBee has lined up for you</p>
                <p>Sorted by urgency and effort</p>
              </div>
            )}

            {/* AI Briefing Widget */}
            <AIBriefingWidget />

            {/* Action Cards - Priority order with visual hierarchy */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* At Risk - Most urgent, prominent styling */}
              <Card 
                className={`p-5 cursor-pointer transition-all hover:scale-[1.02] ${
                  stats.atRiskCount > 0 
                    ? 'bg-gradient-to-br from-destructive/10 via-destructive/5 to-background border-destructive/30 shadow-lg shadow-destructive/10' 
                    : 'hover:bg-accent/50'
                }`}
                onClick={() => navigate('/to-reply?filter=at-risk')}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-xl ${stats.atRiskCount > 0 ? 'bg-destructive/20' : 'bg-destructive/10'}`}>
                      <AlertTriangle className={`h-6 w-6 ${stats.atRiskCount > 0 ? 'text-destructive animate-pulse' : 'text-destructive/70'}`} />
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-foreground">{stats.atRiskCount}</p>
                      <p className="text-sm font-medium text-muted-foreground">At Risk</p>
                    </div>
                  </div>
                  {stats.atRiskCount > 0 && (
                    <span className="text-xs font-medium text-destructive bg-destructive/10 px-2 py-1 rounded-full">
                      Urgent reply needed
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  {stats.atRiskCount > 0 ? 'Handle these first' : 'No SLA issues right now'}
                </p>
              </Card>

              {/* Training - Help BizzyBee learn */}
              <Card 
                className={`p-5 cursor-pointer transition-all hover:scale-[1.02] ${
                  stats.reviewCount > 0 
                    ? 'bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-background border-purple-500/30 shadow-lg shadow-purple-500/10' 
                    : 'hover:bg-accent/50'
                }`}
                onClick={() => navigate('/review')}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-xl ${stats.reviewCount > 0 ? 'bg-purple-500/20' : 'bg-purple-500/10'}`}>
                      <Sparkles className={`h-6 w-6 ${stats.reviewCount > 0 ? 'text-purple-500' : 'text-purple-500/70'}`} />
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-foreground">{stats.reviewCount}</p>
                      <p className="text-sm font-medium text-muted-foreground">Training</p>
                    </div>
                  </div>
                  {stats.reviewCount > 0 && (
                    <span className="text-xs font-medium text-purple-500 bg-purple-500/10 px-2 py-1 rounded-full">
                      AI checking confidence
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  {stats.reviewCount > 0 ? 'Help BizzyBee learn new patterns' : 'BizzyBee is confident on all items'}
                </p>
              </Card>

              {/* To Reply - Primary work queue */}
              <Card 
                className={`p-5 cursor-pointer transition-all hover:scale-[1.02] ${
                  stats.toReplyCount > 0 
                    ? 'bg-gradient-to-br from-primary/10 via-primary/5 to-background border-primary/30' 
                    : 'hover:bg-accent/50'
                }`}
                onClick={() => navigate('/to-reply?filter=to-reply')}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-xl ${stats.toReplyCount > 0 ? 'bg-primary/20' : 'bg-primary/10'}`}>
                      <Mail className={`h-6 w-6 ${stats.toReplyCount > 0 ? 'text-primary' : 'text-primary/70'}`} />
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-foreground">{stats.toReplyCount}</p>
                      <p className="text-sm font-medium text-muted-foreground">To Reply</p>
                    </div>
                  </div>
                  {stats.toReplyCount > 0 && (
                    <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded-full">
                      Ready for you
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  {stats.toReplyCount > 0 ? "Clear these and you're done for today" : 'Inbox clear'}
                </p>
              </Card>

              {/* Drafts Ready - Actionable, quick wins */}
              <Card 
                className={`p-5 cursor-pointer transition-all hover:scale-[1.02] ${
                  stats.draftCount > 0 
                    ? 'bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-background border-amber-500/30' 
                    : 'hover:bg-accent/50'
                }`}
                onClick={() => navigate('/to-reply?filter=drafts')}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-xl ${stats.draftCount > 0 ? 'bg-amber-500/20' : 'bg-amber-500/10'}`}>
                      <FileEdit className={`h-6 w-6 ${stats.draftCount > 0 ? 'text-amber-500' : 'text-amber-500/70'}`} />
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-foreground">{stats.draftCount}</p>
                      <p className="text-sm font-medium text-muted-foreground">Drafts Ready</p>
                    </div>
                  </div>
                  {stats.draftCount > 0 && (
                    <span className="text-xs font-medium text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full">
                      Ready to send
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  {stats.draftCount > 0 ? 'AI drafted, you approve' : 'No drafts pending'}
                </p>
              </Card>
            </div>

            {/* All caught up banner */}
            {stats.toReplyCount === 0 && stats.reviewCount === 0 && stats.atRiskCount === 0 && (
              <Card className="p-4 border-l-4 border-l-success bg-success/5">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  <div>
                    <p className="font-medium text-foreground">You're all caught up!</p>
                    <p className="text-sm text-muted-foreground">BizzyBee is handling your inbox</p>
                  </div>
                </div>
              </Card>
            )}

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Drafts Section */}
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <FileEdit className="h-4 w-4 text-warning" />
                  <h2 className="font-semibold text-foreground">Pending Drafts</h2>
                </div>
                <DraftMessages onNavigate={handleNavigate} maxItems={4} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground mt-2"
                  onClick={() => navigate('/to-reply?filter=drafts')}
                >
                  View all drafts
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Card>

              {/* Activity Feed */}
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="h-4 w-4 text-primary" />
                  <h2 className="font-semibold text-foreground">Recent Activity</h2>
                </div>
                <ActivityFeed onNavigate={handleNavigate} maxItems={6} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground mt-2"
                  onClick={() => navigate('/activity')}
                >
                  View all activity
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Card>

              {/* Right Column: Learning + Activity Log */}
              <div className="space-y-4">
                {/* Enhanced Learning Insights */}
                <LearningInsightsWidget />

                {/* Human + AI Activity Log */}
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="h-4 w-4 text-success" />
                    <h2 className="font-semibold text-foreground">Human + AI Log</h2>
                  </div>
                  <HumanAIActivityLog onNavigate={handleNavigate} maxItems={6} />
                </Card>
              </div>
            </div>

            {/* System Status Footer */}
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-4">
              <CheckCircle2 className="h-3 w-3 text-success" />
              <span>System active</span>
              <span className="text-muted-foreground/50">•</span>
              <Clock className="h-3 w-3" />
              <span>Checking every minute</span>
            </div>
          </>
        )}
      </div>
    </ScrollArea>
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
