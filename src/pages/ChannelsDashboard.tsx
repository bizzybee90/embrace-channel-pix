import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Mail, MessageCircle, Phone, Smartphone, Monitor } from 'lucide-react';
import { format } from 'date-fns';
import { useWorkspace } from '@/hooks/useWorkspace';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';

interface ChannelStats {
  channel: string;
  unread: number;
  total: number;
  avgResponseTime: number | null;
  recentConversations: Array<{
    id: string;
    title: string;
    status: string;
    created_at: string;
  }>;
}

const channelConfig = {
  email: {
    icon: Mail,
    label: 'Email',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-950/20',
    emoji: '📧'
  },
  whatsapp: {
    icon: MessageCircle,
    label: 'WhatsApp',
    color: 'text-green-600',
    bgColor: 'bg-green-50 dark:bg-green-950/20',
    emoji: '💬'
  },
  sms: {
    icon: Smartphone,
    label: 'SMS',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-950/20',
    emoji: '📱'
  },
  phone: {
    icon: Phone,
    label: 'Phone',
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 dark:bg-orange-950/20',
    emoji: '📞'
  },
  webchat: {
    icon: Monitor,
    label: 'Web Chat',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50 dark:bg-indigo-950/20',
    emoji: '💻'
  }
};

export default function ChannelsDashboard() {
  const { workspace } = useWorkspace();
  const [channelStats, setChannelStats] = useState<ChannelStats[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchChannelStats = async () => {
    if (!workspace?.id) return;

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString();

      // Fetch all conversations
      const { data: conversations, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('workspace_id', workspace.id)
        .gte('created_at', todayStr)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (conversations) {
        const channels = ['email', 'whatsapp', 'sms', 'phone', 'webchat'];
        const stats = channels.map(channel => {
          const channelConvos = conversations.filter(c => c.channel === channel);
          const unread = channelConvos.filter(c => c.status === 'new').length;
          
          // Calculate average response time (in minutes)
          const withResponseTimes = channelConvos.filter(
            c => c.first_response_at && c.created_at
          );
          const avgResponseTime = withResponseTimes.length > 0
            ? withResponseTimes.reduce((acc, c) => {
                const created = new Date(c.created_at).getTime();
                const responded = new Date(c.first_response_at!).getTime();
                return acc + (responded - created) / 1000 / 60; // convert to minutes
              }, 0) / withResponseTimes.length
            : null;

          return {
            channel,
            unread,
            total: channelConvos.length,
            avgResponseTime,
            recentConversations: channelConvos.slice(0, 5).map(c => ({
              id: c.id,
              title: c.title || 'Untitled',
              status: c.status || 'new',
              created_at: c.created_at
            }))
          };
        });

        setChannelStats(stats);
      }
    } catch (error) {
      console.error('Error fetching channel stats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChannelStats();

    // Set up realtime subscription
    const channel = supabase
      .channel('channels-dashboard-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspace?.id}`
        },
        () => {
          fetchChannelStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace?.id]);

  const formatResponseTime = (minutes: number | null) => {
    if (minutes === null) return 'N/A';
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'resolved': return 'default';
      case 'in_progress': return 'secondary';
      case 'new': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <ThreeColumnLayout
      sidebar={<Sidebar />}
      main={
        loading ? (
          <div className="flex items-center justify-center min-h-screen">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading channels...</p>
            </div>
          </div>
        ) : (
          <div className="p-8 space-y-6">
            <div>
              <h1 className="text-3xl font-bold">Channels Dashboard</h1>
              <p className="text-muted-foreground">Monitor activity across all communication channels</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {channelStats.map((stat) => {
                const config = channelConfig[stat.channel as keyof typeof channelConfig];
                const Icon = config.icon;

                return (
                  <Card key={stat.channel} className={`p-6 ${config.bgColor}`}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-3 rounded-lg bg-background">
                          <Icon className={`h-6 w-6 ${config.color}`} />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold flex items-center gap-2">
                            {config.emoji} {config.label}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {stat.total} conversation{stat.total !== 1 ? 's' : ''} today
                          </p>
                        </div>
                      </div>
                      {stat.unread > 0 && (
                        <Badge variant="destructive" className="text-lg px-3 py-1">
                          {stat.unread}
                        </Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4 p-4 bg-background rounded-lg">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Unread</p>
                        <p className={`text-2xl font-bold ${config.color}`}>
                          {stat.unread}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Avg Response</p>
                        <p className="text-2xl font-bold">
                          {formatResponseTime(stat.avgResponseTime)}
                        </p>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold mb-2">Recent Activity</h4>
                      <ScrollArea className="h-[200px]">
                        {stat.recentConversations.length > 0 ? (
                          <div className="space-y-2">
                            {stat.recentConversations.map((conv) => (
                              <div
                                key={conv.id}
                                className="p-3 bg-background rounded-lg hover:bg-accent/50 transition-colors"
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <p className="font-medium text-sm truncate flex-1">
                                    {conv.title}
                                  </p>
                                  <Badge variant={getStatusColor(conv.status)} className="ml-2">
                                    {conv.status}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {format(new Date(conv.created_at), 'HH:mm')}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-8">
                            No conversations yet today
                          </p>
                        )}
                      </ScrollArea>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )
      }
    />
  );
}
