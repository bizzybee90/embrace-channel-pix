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
      iconBg: 'bg-red-50',
      iconColor: 'text-red-500',
      onClick: () => navigate('/to-reply?filter=at-risk'),
    },
    {
      label: 'Training',
      count: stats.reviewCount,
      icon: Sparkles,
      iconBg: 'bg-purple-50',
      iconColor: 'text-purple-500',
      onClick: () => navigate('/review'),
    },
    {
      label: 'To Reply',
      count: stats.toReplyCount,
      icon: Mail,
      iconBg: 'bg-blue-50',
      iconColor: 'text-blue-500',
      onClick: () => navigate('/to-reply?filter=to-reply'),
    },
    {
      label: 'Drafts',
      count: stats.draftCount,
      icon: FileEdit,
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-500',
      onClick: () => navigate('/to-reply?filter=drafts'),
    },
  ];

  const mainContent = (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="p-4 md:p-6 space-y-6 bg-slate-50/50 min-h-full">
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
            {/* ── Hero Banner ── */}
            <div className="w-full bg-gradient-to-br from-indigo-50/50 via-white to-purple-50/50 rounded-2xl p-6 ring-1 ring-indigo-100/50 shadow-sm relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-indigo-500" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">{getGreeting()}</h1>
                  <p className="text-slate-600 mt-1 text-sm">
                    {stats.atRiskCount > 0
                      ? `You have ${stats.atRiskCount} urgent item${stats.atRiskCount !== 1 ? 's' : ''} that need attention.`
                      : stats.toReplyCount > 0
                        ? `${stats.toReplyCount} conversation${stats.toReplyCount !== 1 ? 's' : ''} waiting for your reply.`
                        : 'BizzyBee is keeping your inbox under control.'}
                  </p>
                </div>
              </div>
              {stats.clearedToday > 0 && (
                <div className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-full text-sm font-medium shadow-sm whitespace-nowrap self-start md:self-center">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  {stats.clearedToday} messages auto-handled
                </div>
              )}
            </div>

            {/* ── Bento Metric Cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {metrics.map(m => {
                const active = m.count > 0;
                const Icon = m.icon;
                return (
                  <div
                    key={m.label}
                    onClick={m.onClick}
                    className={cn(
                      'rounded-2xl p-5 cursor-pointer transition-all duration-200',
                      active
                        ? 'bg-white ring-1 ring-slate-900/5 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] hover:-translate-y-1 hover:shadow-md'
                        : 'bg-slate-50/50 ring-1 ring-slate-200 opacity-50 grayscale shadow-none'
                    )}
                  >
                    <div className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center',
                      active ? m.iconBg : 'bg-slate-100'
                    )}>
                      <Icon className={cn('h-5 w-5', active ? m.iconColor : 'text-slate-400')} />
                    </div>
                    <p className="text-4xl font-bold tracking-tight text-slate-900 mt-4">{m.count}</p>
                    <p className="text-sm font-medium text-slate-500 uppercase tracking-wide mt-1">{m.label}</p>
                  </div>
                );
              })}
            </div>

            {/* ── All caught up ── */}
            {stats.toReplyCount === 0 && stats.reviewCount === 0 && stats.atRiskCount === 0 && (
              <div className="bg-white rounded-2xl ring-1 ring-slate-900/5 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] p-4 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <div>
                  <p className="font-medium text-slate-900">You're all caught up!</p>
                  <p className="text-sm text-slate-500">BizzyBee is handling your inbox</p>
                </div>
              </div>
            )}

            {/* ── Widget Grid ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Pending Drafts */}
              <div className="bg-white rounded-2xl ring-1 ring-slate-900/5 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-4">
                  <FileEdit className="h-4 w-4 text-amber-500" />
                  <h2 className="font-semibold text-slate-900">Pending Drafts</h2>
                </div>
                <div className="flex-1">
                  <DraftMessages onNavigate={handleNavigate} maxItems={4} />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-slate-500 mt-3 hover:bg-slate-50"
                  onClick={() => navigate('/to-reply?filter=drafts')}
                >
                  View all drafts
                </Button>
              </div>

              {/* Recent Activity */}
              <div className="bg-white rounded-2xl ring-1 ring-slate-900/5 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] p-5 flex flex-col">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="h-4 w-4 text-blue-500" />
                  <h2 className="font-semibold text-slate-900">Recent Activity</h2>
                </div>
                <div className="flex-1">
                  <ActivityFeed onNavigate={handleNavigate} maxItems={6} />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-slate-500 mt-3 hover:bg-slate-50"
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
            <div className="flex items-center justify-center gap-2 text-xs text-slate-400 pt-4">
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
