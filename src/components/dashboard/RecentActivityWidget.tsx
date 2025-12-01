import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, User, Bot } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { Skeleton } from '@/components/ui/skeleton';

interface RecentActivity {
  id: string;
  body: string;
  actor_name: string | null;
  actor_type: string;
  channel: string;
  created_at: string;
  conversation_id: string;
}

export const RecentActivityWidget = () => {
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRecentActivity();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('recent-activity')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: 'direction=eq.outbound'
        },
        (payload) => {
          const newMessage = payload.new as RecentActivity;
          setActivities((prev) => [newMessage, ...prev].slice(0, 10));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchRecentActivity = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('messages')
      .select('id, body, actor_name, actor_type, channel, created_at, conversation_id')
      .eq('direction', 'outbound')
      .eq('is_internal', false)
      .order('created_at', { ascending: false })
      .limit(10);

    if (data) {
      setActivities(data as RecentActivity[]);
    }
    setLoading(false);
  };

  const getActorIcon = (actorType: string) => {
    if (actorType === 'ai_agent') {
      return <Bot className="h-4 w-4 text-blue-600" />;
    }
    return <User className="h-4 w-4 text-green-600" />;
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
                  className="flex items-start gap-3 pb-3 border-b last:border-0"
                >
                  <div className="flex-shrink-0 mt-1">
                    {getActorIcon(activity.actor_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium truncate">
                        {activity.actor_name || 'Unknown'}
                      </p>
                      <ChannelIcon channel={activity.channel} className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="text-xs text-muted-foreground capitalize">
                        {activity.channel}
                      </span>
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