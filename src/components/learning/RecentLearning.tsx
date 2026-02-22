import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, Sparkles } from 'lucide-react';

interface LearningEvent {
  id: string;
  description: string;
  timestamp: string;
}

const formatClassification = (str: string) =>
  str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

export const RecentLearning = () => {
  const { workspace } = useWorkspace();
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      if (!workspace?.id) return;

      const [corrections, rules, reviews] = await Promise.all([
        supabase
          .from('triage_corrections')
          .select('id, original_classification, new_classification, sender_email, corrected_at')
          .eq('workspace_id', workspace.id)
          .order('corrected_at', { ascending: false })
          .limit(10),
        supabase
          .from('sender_rules')
          .select('id, sender_pattern, default_classification, created_at')
          .eq('workspace_id', workspace.id)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('conversations')
          .select('id, title, email_classification, reviewed_at, review_outcome')
          .eq('workspace_id', workspace.id)
          .eq('training_reviewed', true)
          .not('reviewed_at', 'is', null)
          .order('reviewed_at', { ascending: false })
          .limit(10),
      ]);

      const all: LearningEvent[] = [];

      (corrections.data || []).forEach(c => {
        all.push({
          id: `corr-${c.id}`,
          description: `Learned that emails from ${c.sender_email || 'unknown'} are ${formatClassification(c.new_classification || 'unknown')}`,
          timestamp: c.corrected_at || '',
        });
      });

      (rules.data || []).forEach(r => {
        all.push({
          id: `rule-${r.id}`,
          description: `New rule: auto-handle ${r.sender_pattern} as ${formatClassification(r.default_classification || 'unknown')}`,
          timestamp: r.created_at || '',
        });
      });

      (reviews.data || []).forEach(r => {
        if (r.review_outcome === 'confirmed') {
          all.push({
            id: `rev-${r.id}`,
            description: `Confirmed: ${r.title || 'an email'} is ${formatClassification(r.email_classification || 'unknown')}`,
            timestamp: r.reviewed_at || '',
          });
        }
      });

      all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEvents(all.slice(0, 15));
      setLoading(false);
    };
    fetch();
  }, [workspace?.id]);

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold text-foreground">Recent learning</h2>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          Start reviewing emails in the Training queue to help BizzyBee learn your preferences.
        </p>
      ) : (
        <div className="space-y-0">
          {events.map((event, i) => (
            <div key={event.id} className="flex gap-3 py-2.5">
              <div className="flex flex-col items-center">
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-2" />
                {i < events.length - 1 && (
                  <div className="w-px flex-1 bg-border mt-1" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground leading-relaxed">{event.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {event.timestamp ? formatDistanceToNow(new Date(event.timestamp), { addSuffix: true }) : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
