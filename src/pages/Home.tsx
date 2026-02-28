import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNavigate } from 'react-router-dom';
import { 
  Mail, 
  Flame, 
  CheckCircle2, 
  Clock, 
  Sparkles,
  Activity,
  FileEdit,
  Users,
  ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { DraftMessages } from '@/components/dashboard/DraftMessages';
import { HumanAIActivityLog } from '@/components/dashboard/HumanAIActivityLog';
import { LearningInsightsWidget } from '@/components/dashboard/LearningInsightsWidget';
import { InsightsWidget } from '@/components/dashboard/InsightsWidget';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

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
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .or('decision_bucket.eq.auto_handled,status.eq.resolved')
            .gte('updated_at', today.toISOString()),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .eq('requires_reply', true)
            .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated'])
            .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .eq('decision_bucket', 'act_now')
            .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .eq('training_reviewed', false)
            .not('email_classification', 'is', null),
          supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace.id)
            .not('ai_draft_response', 'is', null)
            .is('final_response', null)
            .in('status', ['new', 'open', 'ai_handling'])
            .in('decision_bucket', ['quick_win', 'act_now'])
            .eq('requires_reply', true),
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
        () => { fetchStats(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [workspace?.id]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const handleNavigate = (path: string) => { navigate(path); };

  // Metric card config
  const metrics = [
    {
      label: 'Urgent',
      count: stats.atRiskCount,
      icon: Flame,
      iconColor: 'text-red-600',
      iconBoxBg: 'bg-red-100',
      cardBg: 'bg-gradient-to-b from-red-50/80 to-white',
      cardBorder: 'border border-red-100',
      onClick: () => navigate('/needs-action?filter=at-risk'),
    },
    {
      label: 'To Reply',
      count: stats.toReplyCount,
      icon: Mail,
      iconColor: 'text-blue-600',
      iconBoxBg: 'bg-blue-100',
      cardBg: 'bg-gradient-to-b from-blue-50/80 to-white',
      cardBorder: 'border border-blue-100',
      onClick: () => navigate('/needs-action?filter=needs-action'),
    },
    {
      label: 'Drafts',
      count: stats.draftCount,
      icon: FileEdit,
      iconColor: 'text-amber-600',
      iconBoxBg: 'bg-amber-100',
      cardBg: 'bg-gradient-to-b from-amber-50/80 to-white',
      cardBorder: 'border border-amber-100',
      onClick: () => navigate('/needs-action?filter=drafts'),
    },
    {
      label: 'Training',
      count: stats.reviewCount,
      icon: Sparkles,
      iconColor: 'text-amber-600',
      iconBoxBg: 'bg-amber-100',
      cardBg: 'bg-gradient-to-b from-amber-50/80 to-white',
      cardBorder: 'border border-amber-100',
      onClick: () => navigate('/review'),
    },
  ];

  const mainContent = (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="p-4 md:p-6 space-y-6 min-h-full" style={{ background: "hsl(40, 20%, 98%)" }}>
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-28 rounded-2xl" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
            </div>
          </div>
        ) : (
          <>
            {/* ── Hero Copilot Banner ── */}
            <div className="w-full rounded-2xl p-8 relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-2" style={{ background: "white", border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
              <div>
                <div className="flex items-center gap-3">
                  <span className="text-3xl">🐝</span>
                  <h1 className="text-3xl font-bold text-foreground tracking-tight">{getGreeting()}!</h1>
                </div>
                <p className="text-lg text-foreground/80 max-w-2xl mt-2 leading-relaxed">
                  {stats.atRiskCount > 0
                    ? `You have ${stats.atRiskCount} urgent item${stats.atRiskCount !== 1 ? 's' : ''} that need attention.`
                    : stats.toReplyCount > 0
                      ? `${stats.toReplyCount} conversation${stats.toReplyCount !== 1 ? 's' : ''} waiting for your reply.`
                      : 'Here is what BizzyBee has lined up for you.'}
                </p>
                {/* Frosted-glass AI Briefing Panel */}
                <div className="mt-6 p-5 rounded-xl text-foreground text-[15px] leading-relaxed" style={{ background: "hsl(40, 20%, 98%)", border: "1px solid #e5e7eb" }}>
                  {stats.clearedToday > 0 ? (
                    <p>
                      Since this morning, BizzyBee auto-handled <strong>{stats.clearedToday}</strong> message{stats.clearedToday !== 1 ? 's' : ''}
                      {stats.draftCount > 0 && <>, prepared <strong>{stats.draftCount}</strong> draft{stats.draftCount !== 1 ? 's' : ''} for your review</>}
                      {stats.reviewCount > 0 && <>, and flagged <strong>{stats.reviewCount}</strong> for training</>}.
                      {stats.toReplyCount === 0 && stats.atRiskCount === 0
                        ? ' Your inbox is clear — go grab a coffee ☕'
                        : ' Here\'s what still needs your attention.'}
                    </p>
                  ) : (
                    <p>
                      {stats.toReplyCount > 0
                        ? `You have ${stats.toReplyCount} conversation${stats.toReplyCount !== 1 ? 's' : ''} waiting. BizzyBee is learning your style — the more you review, the smarter it gets.`
                        : 'BizzyBee is monitoring your inbox. Nothing needs your attention right now — enjoy your day!'}
                    </p>
                  )}
                </div>
              </div>
              {stats.clearedToday > 0 && (
                <div className="border border-emerald-200 text-emerald-700 px-4 py-2 rounded-xl font-semibold flex items-center gap-2 text-sm whitespace-nowrap self-start md:self-center" style={{ background: "rgba(236,253,245,0.8)" }}>
                  <CheckCircle2 className="w-5 h-5" />
                  {stats.clearedToday} messages auto-handled today
                </div>
              )}
            </div>

            {/* ── Tinted Glass Metric Cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {metrics.map(m => {
                const active = m.count > 0;
                const Icon = m.icon;
                return (
                  <div
                    key={m.label}
                    onClick={m.onClick}
                    className={cn(
                      'rounded-2xl p-6 cursor-pointer transition-all duration-200',
                      active
                        ? `${m.cardBg} ${m.cardBorder} hover:-translate-y-0.5`
                        : 'bg-white border border-border opacity-50 grayscale'
                    )}
                  >
                    <div className={cn(
                      'w-12 h-12 rounded-2xl flex items-center justify-center ',
                      active ? m.iconBoxBg : 'bg-background-alt'
                    )}>
                      <Icon className={cn('h-5 w-5', active ? m.iconColor : 'text-muted-foreground/70')} />
                    </div>
                    <p className="text-5xl font-extrabold tracking-tight text-foreground mt-5 mb-1">{m.count}</p>
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{m.label}</p>
                  </div>
                );
              })}
            </div>

            {/* ── All caught up ── */}
            {stats.toReplyCount === 0 && stats.reviewCount === 0 && stats.atRiskCount === 0 && (
              <div className="flex flex-col items-center justify-center h-[60vh] text-center">
                <div className="w-24 h-24 rounded-full flex items-center justify-center mb-6 mx-auto" style={{ background: "rgba(236,253,245,0.6)" }}>
                  <Sparkles className="w-10 h-10 text-emerald-500" />
                </div>
                <h3 className="text-2xl font-bold text-foreground tracking-tight">You're all caught up!</h3>
                <p className="text-muted-foreground mt-2 max-w-sm mx-auto text-lg">BizzyBee is actively monitoring your inbox. Go grab a coffee.</p>
              </div>
            )}

            {/* ── Widget Grid ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Pending Drafts */}
              <div className="card-warm p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-4">
                  <FileEdit className="h-4 w-4 text-amber-500" />
                  <h2 className="font-semibold text-foreground">Pending Drafts</h2>
                </div>
                <div className="flex-1">
                  <DraftMessages onNavigate={handleNavigate} maxItems={4} />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground mt-3 hover:bg-background-alt"
                  onClick={() => navigate('/needs-action?filter=drafts')}
                >
                  View all drafts
                </Button>
              </div>

              {/* Recent Activity */}
              <div className="card-warm p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="h-4 w-4 text-blue-500" />
                  <h2 className="font-semibold text-foreground">Recent Activity</h2>
                </div>
                <div className="flex-1">
                  <ActivityFeed onNavigate={handleNavigate} maxItems={6} />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground mt-3 hover:bg-background-alt"
                  onClick={() => navigate('/activity')}
                >
                  View all activity
                </Button>
              </div>

              {/* Right Column */}
              <div className="space-y-6">
                {workspace?.id && <InsightsWidget workspaceId={workspace.id} />}
                <LearningInsightsWidget />
              </div>
            </div>

            {/* System Status Footer */}
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground/70 pt-4">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <span>System active</span>
              <span>•</span>
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
      <MobilePageLayout>
        {mainContent}
      </MobilePageLayout>
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
