import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Zap, Target, Clock, Loader2 } from 'lucide-react';

interface Stats {
  autoHandled: number;
  totalEmails: number;
  correctionsCount: number;
  totalReviewed: number;
}

export const HowBizzyBeeIsDoing = () => {
  const { workspace } = useWorkspace();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      if (!workspace?.id) return;
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const [convos, corrections, reviewed] = await Promise.all([
        supabase
          .from('conversations')
          .select('decision_bucket')
          .eq('workspace_id', workspace.id)
          .gte('created_at', weekAgo.toISOString()),
        supabase
          .from('triage_corrections')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .gte('corrected_at', weekAgo.toISOString()),
        supabase
          .from('conversations')
          .select('review_outcome')
          .eq('workspace_id', workspace.id)
          .not('reviewed_at', 'is', null)
          .gte('reviewed_at', weekAgo.toISOString()),
      ]);

      const all = convos.data || [];
      const auto = all.filter(c => c.decision_bucket === 'auto_handled').length;
      const rev = reviewed.data || [];
      const confirmed = rev.filter(c => c.review_outcome === 'confirmed').length;

      setStats({
        autoHandled: auto,
        totalEmails: all.length,
        correctionsCount: corrections.count || 0,
        totalReviewed: rev.length,
      });
      setLoading(false);
    };
    fetch();
  }, [workspace?.id]);

  if (loading || !stats) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </Card>
    );
  }

  const automationPct = stats.totalEmails > 0
    ? Math.round((stats.autoHandled / stats.totalEmails) * 100)
    : 0;
  const accuracyPct = stats.totalReviewed > 0
    ? Math.round(((stats.totalReviewed - stats.correctionsCount) / stats.totalReviewed) * 100)
    : 100;
  const timeSavedHours = Math.round((stats.autoHandled * 2) / 60);

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-foreground mb-5">How BizzyBee is doing</h2>

      <div className="space-y-5">
        {/* Automation rate */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10 mt-0.5">
            <Zap className="h-4 w-4 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-sm text-foreground font-medium">Emails handled automatically</span>
              <span className="text-sm font-semibold text-foreground">{stats.autoHandled} of {stats.totalEmails} ({automationPct}%)</span>
            </div>
            <Progress value={automationPct} className="h-2" />
          </div>
        </div>

        {/* Accuracy */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-green-500/10 mt-0.5">
            <Target className="h-4 w-4 text-green-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-foreground font-medium">Accuracy</span>
              <span className="text-sm font-semibold text-foreground">{accuracyPct}%</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {stats.correctionsCount === 0
                ? '0 corrections needed'
                : `${stats.correctionsCount} correction${stats.correctionsCount !== 1 ? 's' : ''} this week`}
            </p>
          </div>
        </div>

        {/* Time saved */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10 mt-0.5">
            <Clock className="h-4 w-4 text-purple-500" />
          </div>
          <div className="flex-1">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-foreground font-medium">Time saved this week</span>
              <span className="text-sm font-semibold text-foreground">~{timeSavedHours > 0 ? `${timeSavedHours} hour${timeSavedHours !== 1 ? 's' : ''}` : 'a few minutes'}</span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-5 leading-relaxed">
        BizzyBee is handling most of your email automatically. The more you review, the smarter it gets.
      </p>
    </Card>
  );
};
