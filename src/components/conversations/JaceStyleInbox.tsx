import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation } from '@/lib/types';
import { SearchInput } from './SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, isToday, isYesterday } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
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

  // Channel icon is now handled by ChannelIcon component

  // Fixed width for all status badges to ensure consistent alignment
  const BADGE_CLASS = "text-[10px] px-2 py-0 h-5 min-w-[90px] text-center justify-center";
  
  // State-based labels: what does the user need to DO, not how hard is it
  const getStateConfig = (bucket: string, hasAiDraft: boolean) => {
    if (bucket === 'act_now') {
      return { 
        border: 'border-l-red-500', 
        badge: <Badge variant="destructive" className={`${BADGE_CLASS} font-medium`}>Needs attention</Badge>,
        rowClass: 'bg-red-50/50 dark:bg-red-950/20' // Subtle urgency tint
      };
    }
    if (bucket === 'quick_win' && hasAiDraft) {
      return { 
        border: 'border-l-purple-500', 
        badge: <Badge className={`bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 hover:bg-purple-200 ${BADGE_CLASS}`}>Draft ready</Badge>,
        rowClass: ''
      };
    }
    if (bucket === 'quick_win') {
      return { 
        border: 'border-l-amber-500', 
        badge: <Badge className={`bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 hover:bg-amber-200 ${BADGE_CLASS}`}>Needs reply</Badge>,
        rowClass: ''
      };
    }
    if (bucket === 'wait') {
      return { 
        border: 'border-l-slate-400', 
        badge: <Badge className={`bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 ${BADGE_CLASS}`}>FYI</Badge>,
        rowClass: ''
      };
    }
    if (bucket === 'auto_handled') {
      return { 
        border: 'border-l-green-500', 
        badge: <Badge className={`bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 hover:bg-green-200 ${BADGE_CLASS}`}>Done</Badge>,
        rowClass: ''
      };
    }
    return { border: 'border-l-transparent', badge: null, rowClass: '' };
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return format(date, 'h:mm a');
  };

  const ConversationRow = ({ conversation }: { conversation: Conversation }) => {
    const conv = conversation as any;
    const customerName = conv.customer?.name || conv.customer?.email?.split('@')[0] || 'Unknown';
    const hasAiDraft = !!conv.ai_draft_response;
    const stateConfig = getStateConfig(conv.decision_bucket, hasAiDraft);
    const messageCount = conv.message_count || 0;
    const isUrgent = conv.decision_bucket === 'act_now';

    return (
      <div
        onClick={() => onSelect(conversation)}
        className={cn(
          "flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-border/30 transition-all",
          "border-l-4 hover:bg-muted/50",
          stateConfig.border,
          stateConfig.rowClass
        )}
      >
        {/* Channel icon + Sender - fixed width, truncate */}
        <div className="w-28 flex-shrink-0 min-w-0 flex items-center gap-1.5">
          <ChannelIcon channel={conv.channel} className="h-3 w-3 flex-shrink-0 opacity-60" />
          <span className={cn(
            "text-sm text-foreground truncate",
            isUrgent ? "font-semibold" : "font-medium"
          )}>
            {customerName}
          </span>
        </div>

        {/* Subject + Preview - fills remaining space, single line with truncation */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <p className="text-sm text-foreground truncate">
            <span className={cn(isUrgent ? "font-semibold" : "font-medium")}>
              {conv.title || 'No subject'}
            </span>
            {conv.summary_for_human && (
              <span className="text-muted-foreground ml-1">· {conv.summary_for_human}</span>
            )}
          </p>
        </div>

        {/* State badge - single badge, no separate Draft badge */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {stateConfig.badge}
        </div>

        {/* Thread Count + Time - compact */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {messageCount > 1 && (
            <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded-full h-4 min-w-4 px-1 flex items-center justify-center">
              {messageCount}
            </span>
          )}
          <span className="text-xs text-muted-foreground whitespace-nowrap">
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
