import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation } from '@/lib/types';
import { SearchInput } from './SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, RefreshCw, Mail, MessageSquare, Phone, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface JaceStyleInboxProps {
  onSelect: (conversation: Conversation) => void;
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'awaiting-reply' | 'completed' | 'sent' | 'high-priority' | 'vip-customers' | 'escalations' | 'triaged' | 'needs-me' | 'snoozed' | 'cleared' | 'fyi';
}

interface GroupedConversations {
  today: Conversation[];
  yesterday: Conversation[];
  older: Conversation[];
}

export const JaceStyleInbox = ({ onSelect, filter = 'needs-me' }: JaceStyleInboxProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const queryClient = useQueryClient();
  const PAGE_SIZE = 50;

  const fetchConversations = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data: userData } = await supabase
      .from('users')
      .select('workspace_id')
      .eq('id', user.id)
      .single();

    if (!userData?.workspace_id) return [];

    let query = supabase
      .from('conversations')
      .select(`
        *,
        customer:customers(*),
        assigned_user:users!conversations_assigned_to_fkey(*)
      `)
      .eq('workspace_id', userData.workspace_id)
      .order('updated_at', { ascending: false });

    // Apply view filter
    if (filter === 'needs-me') {
      query = query
        .in('decision_bucket', ['act_now', 'quick_win'])
        .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (filter === 'fyi') {
      query = query
        .eq('decision_bucket', 'wait')
        .in('status', ['new', 'open', 'waiting_internal', 'ai_handling']);
    } else if (filter === 'cleared') {
      query = query.or('decision_bucket.eq.auto_handled,status.eq.resolved');
    }

    query = query.limit(PAGE_SIZE);

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).filter((conv: any) => {
      if (!conv.snoozed_until) return true;
      return new Date(conv.snoozed_until) <= new Date();
    });
  };

  const { data: autoHandledCount = 0 } = useQuery({
    queryKey: ['auto-handled-count'],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const { count } = await supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .gte('auto_handled_at', today.toISOString());
      
      return count || 0;
    },
    staleTime: 60000,
  });

  const { data: conversations = [], isLoading, isFetching } = useQuery({
    queryKey: ['jace-inbox', filter],
    queryFn: async () => {
      const result = await fetchConversations();
      setLastUpdated(new Date());
      return result;
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  // Filter by search
  const filteredConversations = conversations.filter((conv: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      conv.title?.toLowerCase().includes(q) ||
      conv.summary_for_human?.toLowerCase().includes(q) ||
      conv.customer?.name?.toLowerCase().includes(q) ||
      conv.customer?.email?.toLowerCase().includes(q)
    );
  });

  // Group by date
  const groupedConversations: GroupedConversations = {
    today: [],
    yesterday: [],
    older: []
  };

  filteredConversations.forEach((conv: any) => {
    const date = new Date(conv.updated_at || conv.created_at);
    if (isToday(date)) {
      groupedConversations.today.push(conv as Conversation);
    } else if (isYesterday(date)) {
      groupedConversations.yesterday.push(conv as Conversation);
    } else {
      groupedConversations.older.push(conv as Conversation);
    }
  });

  const handleRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['jace-inbox'] });
  };

  const getTimeSinceUpdate = () => {
    const seconds = Math.floor((new Date().getTime() - lastUpdated.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'email': return <Mail className="h-3.5 w-3.5" />;
      case 'sms': return <MessageSquare className="h-3.5 w-3.5" />;
      case 'whatsapp': return <MessageCircle className="h-3.5 w-3.5" />;
      case 'phone': return <Phone className="h-3.5 w-3.5" />;
      default: return <Mail className="h-3.5 w-3.5" />;
    }
  };

  const getBucketConfig = (bucket: string) => {
    switch (bucket) {
      case 'act_now':
        return { 
          border: 'border-l-red-500', 
          badge: <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5">Act Now</Badge>
        };
      case 'quick_win':
        return { 
          border: 'border-l-amber-500', 
          badge: <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 hover:bg-amber-500/30 text-[10px] px-1.5 py-0 h-5">Quick Win</Badge>
        };
      case 'auto_handled':
        return { 
          border: 'border-l-green-500', 
          badge: <Badge className="bg-green-500/20 text-green-700 dark:text-green-400 hover:bg-green-500/30 text-[10px] px-1.5 py-0 h-5">Handled</Badge>
        };
      case 'wait':
        return { 
          border: 'border-l-blue-500', 
          badge: <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-400 hover:bg-blue-500/30 text-[10px] px-1.5 py-0 h-5">Can Wait</Badge>
        };
      default:
        return { border: 'border-l-transparent', badge: null };
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return format(date, 'h:mm a');
  };

  const ConversationRow = ({ conversation }: { conversation: Conversation }) => {
    const conv = conversation as any;
    const customerName = conv.customer?.name || conv.customer?.email?.split('@')[0] || 'Unknown';
    const hasAiDraft = !!conv.ai_draft_response;
    const bucketConfig = getBucketConfig(conv.decision_bucket);
    const messageCount = conv.message_count || 0;

    return (
      <div
        onClick={() => onSelect(conversation)}
        className={cn(
          "flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-border/30 transition-all group",
          "border-l-4 hover:bg-muted/50",
          bucketConfig.border
        )}
      >
        {/* Sender */}
        <div className="w-[140px] flex-shrink-0">
          <span className="font-medium text-sm text-foreground truncate block">
            {customerName}
          </span>
        </div>

        {/* Subject + Preview */}
        <div className="flex-1 min-w-0">
          <span className="text-sm text-foreground">
            <span className="font-medium">{conv.title || 'No subject'}</span>
            {conv.summary_for_human && (
              <span className="text-muted-foreground ml-1.5 hidden md:inline">
                · {conv.summary_for_human}
              </span>
            )}
          </span>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {bucketConfig.badge}
          {hasAiDraft && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 border-primary/30 text-primary">
              Draft
            </Badge>
          )}
          {conv.category && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 capitalize hidden lg:inline-flex">
              {conv.category}
            </Badge>
          )}
        </div>

        {/* Thread Count */}
        <div className="w-[32px] flex-shrink-0 text-center">
          {messageCount > 1 && (
            <span className="inline-flex items-center justify-center text-[10px] font-medium text-muted-foreground bg-muted rounded-full h-5 min-w-5 px-1.5">
              {messageCount}
            </span>
          )}
        </div>

        {/* Time */}
        <div className="w-[70px] text-right flex-shrink-0">
          <span className="text-xs text-muted-foreground">
            {formatTime(conv.updated_at || conv.created_at)}
          </span>
        </div>
      </div>
    );
  };

  const DateSection = ({ title, conversations }: { title: string; conversations: Conversation[] }) => {
    if (conversations.length === 0) return null;
    return (
      <div>
        <div className="px-4 py-2 bg-muted/30 border-b border-border/50">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {title}
          </span>
        </div>
        {conversations.map((conv) => (
          <ConversationRow key={conv.id} conversation={conv} />
        ))}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header with metrics */}
      {filter === 'needs-me' && autoHandledCount > 0 && (
        <div className="px-6 py-4 bg-gradient-to-r from-primary/5 to-transparent border-b border-border/50">
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-foreground/80">
              🐝 BizzyBee cleared <span className="font-semibold text-primary">{autoHandledCount}</span> messages for you today
            </span>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-4">
          <div className="flex-1 max-w-2xl">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search or ask BizzyBee a question..."
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Updated {getTimeSinceUpdate()}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isFetching}
              className="h-7 w-7 p-0"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Sparkles className="h-12 w-12 mb-4 opacity-20" />
            <p className="text-lg font-medium">You're all caught up!</p>
            <p className="text-sm mt-1 opacity-75">No messages need your attention right now</p>
          </div>
        ) : (
          <>
            <DateSection title="Today" conversations={groupedConversations.today} />
            <DateSection title="Yesterday" conversations={groupedConversations.yesterday} />
            <DateSection title="Earlier" conversations={groupedConversations.older} />
          </>
        )}
      </div>
    </div>
  );
};
