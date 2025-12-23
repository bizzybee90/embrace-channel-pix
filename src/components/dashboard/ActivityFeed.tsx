import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { formatDistanceToNow } from 'date-fns';
import { 
  CheckCircle2, 
  Send, 
  Clock, 
  Bot, 
  User, 
  AlertCircle,
  FileEdit
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActivityItem {
  id: string;
  type: 'auto_handled' | 'sent' | 'draft_ready' | 'escalated' | 'reviewed';
  title: string;
  description: string;
  timestamp: Date;
  conversationId?: string;
  category?: string;
}

interface ActivityFeedProps {
  onNavigate?: (path: string) => void;
}

export function ActivityFeed({ onNavigate }: ActivityFeedProps) {
  const { workspace } = useWorkspace();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchActivities = async () => {
      if (!workspace?.id) return;

      try {
        // Get recent auto-handled conversations
        const { data: autoHandled } = await supabase
          .from('conversations')
          .select('id, title, summary_for_human, auto_handled_at, email_classification')
          .eq('workspace_id', workspace.id)
          .eq('decision_bucket', 'auto_handled')
          .not('auto_handled_at', 'is', null)
          .order('auto_handled_at', { ascending: false })
          .limit(5);

        // Get recent sent messages (outbound)
        const { data: sentMessages } = await supabase
          .from('messages')
          .select(`
            id,
            created_at,
            body,
            conversation_id,
            conversations!inner(
              id,
              title,
              workspace_id
            )
          `)
          .eq('direction', 'outbound')
          .eq('is_internal', false)
          .order('created_at', { ascending: false })
          .limit(5);

        // Get draft responses
        const { data: drafts } = await supabase
          .from('conversations')
          .select('id, title, summary_for_human, updated_at')
          .eq('workspace_id', workspace.id)
          .not('ai_draft_response', 'is', null)
          .is('final_response', null)
          .in('status', ['new', 'open', 'ai_handling'])
          .order('updated_at', { ascending: false })
          .limit(5);

        // Get recently reviewed
        const { data: reviewed } = await supabase
          .from('conversations')
          .select('id, title, reviewed_at, review_outcome')
          .eq('workspace_id', workspace.id)
          .not('reviewed_at', 'is', null)
          .order('reviewed_at', { ascending: false })
          .limit(3);

        // Combine into activities
        const allActivities: ActivityItem[] = [];

        autoHandled?.forEach(c => {
          allActivities.push({
            id: `auto-${c.id}`,
            type: 'auto_handled',
            title: c.title || 'Auto-handled',
            description: c.email_classification?.replace(/_/g, ' ') || 'Notification',
            timestamp: new Date(c.auto_handled_at!),
            conversationId: c.id,
            category: c.email_classification,
          });
        });

        sentMessages?.forEach(m => {
          if ((m.conversations as any)?.workspace_id === workspace.id) {
            allActivities.push({
              id: `sent-${m.id}`,
              type: 'sent',
              title: (m.conversations as any)?.title || 'Message sent',
              description: m.body?.substring(0, 60) + (m.body && m.body.length > 60 ? '...' : ''),
              timestamp: new Date(m.created_at!),
              conversationId: m.conversation_id || undefined,
            });
          }
        });

        drafts?.forEach(c => {
          allActivities.push({
            id: `draft-${c.id}`,
            type: 'draft_ready',
            title: c.title || 'Draft ready',
            description: 'AI response pending review',
            timestamp: new Date(c.updated_at!),
            conversationId: c.id,
          });
        });

        reviewed?.forEach(c => {
          allActivities.push({
            id: `review-${c.id}`,
            type: 'reviewed',
            title: c.title || 'Reviewed',
            description: c.review_outcome === 'confirmed' ? 'AI confirmed' : 'AI corrected',
            timestamp: new Date(c.reviewed_at!),
            conversationId: c.id,
          });
        });

        // Sort by timestamp and take top 10
        allActivities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setActivities(allActivities.slice(0, 10));
      } catch (error) {
        console.error('Error fetching activities:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchActivities();

    // Realtime subscription
    const channel = supabase
      .channel('activity-feed')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspace?.id}`
        },
        () => fetchActivities()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace?.id]);

  const getActivityIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'auto_handled':
        return <Bot className="h-4 w-4 text-success" />;
      case 'sent':
        return <Send className="h-4 w-4 text-primary" />;
      case 'draft_ready':
        return <FileEdit className="h-4 w-4 text-warning" />;
      case 'escalated':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'reviewed':
        return <CheckCircle2 className="h-4 w-4 text-purple-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getActivityLabel = (type: ActivityItem['type']) => {
    switch (type) {
      case 'auto_handled':
        return 'Auto-handled';
      case 'sent':
        return 'Sent';
      case 'draft_ready':
        return 'Draft';
      case 'escalated':
        return 'Escalated';
      case 'reviewed':
        return 'Reviewed';
      default:
        return 'Activity';
    }
  };

  const getCategoryLabel = (category?: string) => {
    if (!category) return null;
    const labels: Record<string, { label: string; color: string }> = {
      'payment_confirmation': { label: 'Payment', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
      'receipt': { label: 'Payment', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
      'marketing': { label: 'Marketing', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
      'newsletter': { label: 'Newsletter', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
      'notification': { label: 'Notification', color: 'bg-muted text-muted-foreground' },
      'automated_notification': { label: 'Automated', color: 'bg-muted text-muted-foreground' },
      'recruitment': { label: 'Recruitment', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
      'hr': { label: 'HR', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
      'invoice': { label: 'Invoice', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
      'booking': { label: 'Booking', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
      'enquiry': { label: 'Enquiry', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
      'complaint': { label: 'Complaint', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
      'cancellation': { label: 'Cancellation', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
      'fyi': { label: 'FYI', color: 'bg-muted text-muted-foreground' },
    };
    
    // Try exact match first, then partial match
    const key = Object.keys(labels).find(k => 
      category.toLowerCase().includes(k) || k.includes(category.toLowerCase())
    );
    
    return key ? labels[key] : { label: category.replace(/_/g, ' '), color: 'bg-muted text-muted-foreground' };
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 animate-pulse">
            <div className="h-8 w-8 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 bg-muted rounded" />
              <div className="h-3 w-1/2 bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {activities.map(activity => (
        <div
          key={activity.id}
          className={cn(
            "flex items-start gap-3 p-3 rounded-lg transition-colors",
            activity.conversationId && "cursor-pointer hover:bg-accent/50",
            activity.type === 'draft_ready' && "bg-warning/5 border border-warning/20"
          )}
          onClick={() => {
            if (activity.conversationId && onNavigate) {
              if (activity.type === 'draft_ready') {
                onNavigate(`/to-reply?id=${activity.conversationId}`);
              } else {
                onNavigate(`/done?id=${activity.conversationId}`);
              }
            }
          }}
        >
          <div className="flex-shrink-0 mt-0.5">
            {getActivityIcon(activity.type)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground">
                {getActivityLabel(activity.type)}
              </span>
              {activity.category && (() => {
                const categoryInfo = getCategoryLabel(activity.category);
                return categoryInfo ? (
                  <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", categoryInfo.color)}>
                    {categoryInfo.label}
                  </span>
                ) : null;
              })()}
              <span className="text-xs text-muted-foreground/60">
                {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm font-medium text-foreground truncate">
              {activity.title}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {activity.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
