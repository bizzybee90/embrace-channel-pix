import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, User, Bot, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface RecentActivity {
  id: string;
  type: 'message' | 'escalation' | 'resolution';
  body: string;
  actor_name: string | null;
  actor_type: string;
  channel: string;
  created_at: string;
  conversation_id: string;
  category?: string;
}

export const RecentActivityWidget = () => {
  const navigate = useNavigate();
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecentActivity = async () => {
    setLoading(true);
    
    // Fetch recent outbound messages with conversation data for category
    const { data: messages } = await supabase
      .from('messages')
      .select(`
        id, body, actor_name, actor_type, channel, created_at, conversation_id,
        conversations(email_classification)
      `)
      .eq('direction', 'outbound')
      .eq('is_internal', false)
      .order('created_at', { ascending: false })
      .limit(5);

    // Fetch recent escalations (today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data: escalations } = await supabase
      .from('conversations')
      .select('id, title, channel, escalated_at, email_classification')
      .eq('is_escalated', true)
      .gte('escalated_at', today.toISOString())
      .order('escalated_at', { ascending: false })
      .limit(5);

    // Fetch recent resolutions (today)
    const { data: resolutions } = await supabase
      .from('conversations')
      .select('id, title, channel, resolved_at, email_classification')
      .eq('status', 'resolved')
      .gte('resolved_at', today.toISOString())
      .order('resolved_at', { ascending: false })
      .limit(5);

    // Merge and sort by timestamp
    const combined: RecentActivity[] = [
      ...(messages?.map(m => ({ 
        ...m, 
        type: 'message' as const,
        category: (m.conversations as any)?.email_classification
      })) || []),
      ...(escalations?.map(e => ({ 
        id: e.id, 
        type: 'escalation' as const,
        body: e.title || 'New escalation',
        actor_name: null,
        actor_type: 'system',
        channel: e.channel,
        created_at: e.escalated_at!,
        conversation_id: e.id,
        category: e.email_classification
      })) || []),
      ...(resolutions?.map(r => ({ 
        id: r.id, 
        type: 'resolution' as const,
        body: r.title || 'Conversation resolved',
        actor_name: null,
        actor_type: 'system',
        channel: r.channel,
        created_at: r.resolved_at!,
        conversation_id: r.id,
        category: r.email_classification
      })) || [])
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
     .slice(0, 10);

    setActivities(combined);
    setLoading(false);
  };

  useEffect(() => {
    fetchRecentActivity();

    // Subscribe to real-time updates for messages
    const messageChannel = supabase
      .channel('recent-activity-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: 'direction=eq.outbound'
        },
        (payload) => {
          const newMessage = payload.new as any;
          if (!newMessage.is_internal) {
            setActivities((prev) => [{
              ...newMessage,
              type: 'message'
            }, ...prev].slice(0, 10));
          }
        }
      )
      .subscribe();

    // Subscribe to conversation status changes
    const conversationChannel = supabase
      .channel('recent-activity-conversations')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations'
        },
        (payload) => {
          const conv = payload.new as any;
          const oldConv = payload.old as any;
          
          // New escalation
          if (conv.is_escalated && !oldConv.is_escalated) {
            const newActivity: RecentActivity = {
              id: conv.id,
              type: 'escalation',
              body: conv.title || 'New escalation',
              actor_name: null,
              actor_type: 'system',
              channel: conv.channel,
              created_at: conv.escalated_at || conv.updated_at,
              conversation_id: conv.id
            };
            setActivities((prev) => [newActivity, ...prev].slice(0, 10));
          }
          
          // New resolution
          if (conv.status === 'resolved' && oldConv.status !== 'resolved') {
            const newActivity: RecentActivity = {
              id: conv.id,
              type: 'resolution',
              body: conv.title || 'Conversation resolved',
              actor_name: null,
              actor_type: 'system',
              channel: conv.channel,
              created_at: conv.resolved_at || conv.updated_at,
              conversation_id: conv.id
            };
            setActivities((prev) => [newActivity, ...prev].slice(0, 10));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messageChannel);
      supabase.removeChannel(conversationChannel);
    };
  }, []);

  const getActivityIcon = (activity: RecentActivity) => {
    if (activity.type === 'escalation') {
      return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    }
    if (activity.type === 'resolution') {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    }
    if (activity.actor_type === 'ai_agent') {
      return <Bot className="h-4 w-4 text-blue-600" />;
    }
    return <User className="h-4 w-4 text-green-600" />;
  };

  const getActivityLabel = (activity: RecentActivity) => {
    if (activity.type === 'escalation') return 'Escalated';
    if (activity.type === 'resolution') return 'Resolved';
    if (activity.actor_type === 'ai_agent') return 'AI Reply';
    return 'Reply Sent';
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
    
    const key = Object.keys(labels).find(k => 
      category.toLowerCase().includes(k) || k.includes(category.toLowerCase())
    );
    
    return key ? labels[key] : { label: category.replace(/_/g, ' '), color: 'bg-muted text-muted-foreground' };
  };

  const handleActivityClick = (activity: RecentActivity) => {
    if (activity.conversation_id) {
      // Navigate to the appropriate page with the conversation selected
      if (activity.type === 'escalation') {
        navigate(`/to-reply?id=${activity.conversation_id}`);
      } else {
        navigate(`/done?id=${activity.conversation_id}`);
      }
    }
  };

  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No recent activity</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className={cn(
                    "flex items-start gap-3 pb-3 border-b last:border-0 transition-colors rounded-lg p-2 -mx-2",
                    activity.conversation_id && "cursor-pointer hover:bg-accent/50"
                  )}
                  onClick={() => handleActivityClick(activity)}
                >
                  <div className="flex-shrink-0 mt-1">
                    {getActivityIcon(activity)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-medium text-muted-foreground">
                        {getActivityLabel(activity)}
                      </span>
                      {activity.category && (() => {
                        const categoryInfo = getCategoryLabel(activity.category);
                        return categoryInfo ? (
                          <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", categoryInfo.color)}>
                            {categoryInfo.label}
                          </span>
                        ) : null;
                      })()}
                      {activity.type === 'message' && (
                        <>
                          <span className="text-xs text-muted-foreground">•</span>
                          <p className="text-sm font-medium truncate">
                            {activity.actor_name || 'Unknown'}
                          </p>
                        </>
                      )}
                      <ChannelIcon channel={activity.channel} className="h-3.5 w-3.5 flex-shrink-0 ml-auto" />
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-1">
                      {activity.body}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};