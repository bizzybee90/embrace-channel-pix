import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation } from '@/lib/types';
import { ConversationCard } from './ConversationCard';
import { ConversationCardSkeleton } from './ConversationCardSkeleton';
import { ConversationFilters } from './ConversationFilters';
import { useIsTablet } from '@/hooks/use-tablet';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PullToRefresh from 'react-simple-pull-to-refresh';
import { useVirtualizer } from '@tanstack/react-virtual';

interface ConversationListProps {
  selectedId?: string;
  onSelect: (conversation: Conversation) => void;
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'completed' | 'sent' | 'high-priority' | 'vip-customers' | 'escalations';
  onConversationsChange?: (conversations: Conversation[]) => void;
  channelFilter?: string;
}

export const ConversationList = ({ selectedId, onSelect, filter = 'all-open', onConversationsChange, channelFilter: initialChannelFilter }: ConversationListProps) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const isTablet = useIsTablet();
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [channelFilter, setChannelFilter] = useState<string[]>(() => {
    return initialChannelFilter ? [initialChannelFilter] : [];
  });
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string>(() => {
    return localStorage.getItem('conversation-sort') || 'sla_urgent';
  });
  const parentRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 50;
  const lastUpdateRef = useRef<number>(0);

  // Persist sort preference
  useEffect(() => {
    localStorage.setItem('conversation-sort', sortBy);
  }, [sortBy]);

  const fetchConversations = useCallback(async (pageNum: number = 0, append: boolean = false) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let query = supabase
      .from('conversations')
      .select(`
        *,
        customer:customers(*),
        assigned_user:users(*)
      `, { count: 'exact' });

    // Apply sorting
    switch (sortBy) {
      case 'newest':
        query = query.order('created_at', { ascending: false });
        break;
      case 'oldest':
        query = query.order('created_at', { ascending: true });
        break;
      case 'priority_high':
        query = query.order('priority', { ascending: false }).order('created_at', { ascending: false });
        break;
      case 'priority_low':
        query = query.order('priority', { ascending: true }).order('created_at', { ascending: false });
        break;
      case 'sla_urgent':
      default:
        query = query.order('sla_due_at', { ascending: true, nullsFirst: false });
        break;
    }

    // Apply view filter
    if (filter === 'my-tickets') {
      query = query.eq('assigned_to', user.id).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal']);
    } else if (filter === 'unassigned') {
      query = query.is('assigned_to', null).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal']);
    } else if (filter === 'sla-risk') {
      query = query.in('sla_status', ['warning', 'breached']).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal']);
    } else if (filter === 'all-open') {
      query = query.in('status', ['new', 'open', 'waiting_customer', 'waiting_internal']);
    } else if (filter === 'completed') {
      query = query.eq('status', 'resolved');
    } else if (filter === 'sent') {
      const { data: sentConvIds } = await supabase
        .from('messages')
        .select('conversation_id')
        .eq('actor_id', user.id)
        .eq('direction', 'outbound')
        .eq('is_internal', false);
      
      if (sentConvIds && sentConvIds.length > 0) {
        const convIds = [...new Set(sentConvIds.map(m => m.conversation_id))];
        query = query.in('id', convIds);
      } else {
        setConversations([]);
        onConversationsChange?.([]);
        setLoading(false);
        setHasMore(false);
        return;
      }
    } else if (filter === 'high-priority') {
      query = query.in('priority', ['high', 'urgent']).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal']);
    } else if (filter === 'vip-customers') {
      query = query.eq('metadata->>tier', 'vip').in('status', ['new', 'open', 'waiting_customer', 'waiting_internal']);
    } else if (filter === 'escalations') {
      query = query.eq('is_escalated', true).in('status', ['new', 'in_progress', 'waiting']);
    }

    // Apply additional filters
    if (statusFilter.length > 0) {
      query = query.in('status', statusFilter);
    }
    if (priorityFilter.length > 0) {
      query = query.in('priority', priorityFilter);
    }
    if (channelFilter.length > 0) {
      query = query.in('channel', channelFilter);
    }
    if (categoryFilter.length > 0) {
      query = query.in('category', categoryFilter);
    }

    // Add pagination
    query = query.range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);

    const { data, count } = await query;
    if (data) {
      const conversationData = data as any;
      const activeConversations = conversationData.filter((conv: any) => {
        if (!conv.snoozed_until) return true;
        return new Date(conv.snoozed_until) <= new Date();
      });
      
      if (append) {
        setConversations(prev => [...prev, ...activeConversations]);
      } else {
        setConversations(activeConversations);
      }
      
      onConversationsChange?.(activeConversations);
      setHasMore(count ? (pageNum + 1) * PAGE_SIZE < count : false);
    }
    setLoading(false);
  }, [filter, statusFilter, priorityFilter, channelFilter, categoryFilter, sortBy, onConversationsChange]);

  useEffect(() => {
    setLoading(true);
    setPage(0);
    setHasMore(true);
    fetchConversations(0, false);

    // Debounced real-time subscription
    const channel = supabase
      .channel('conversations-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations'
        },
        () => {
          const now = Date.now();
          if (now - lastUpdateRef.current > 2000) {
            lastUpdateRef.current = now;
            setPage(0);
            fetchConversations(0, false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [filter, statusFilter, priorityFilter, channelFilter, categoryFilter, sortBy, fetchConversations]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchConversations(nextPage, true);
    }
  }, [loading, hasMore, page, fetchConversations]);

  const activeFilterCount = statusFilter.length + priorityFilter.length + channelFilter.length + categoryFilter.length;

  const handleRefresh = async () => {
    setLoading(true);
    setPage(0);
    await fetchConversations(0, false);
  };

  const isTouchDevice = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  };

  const skeletonList = (
    <div className={cn("flex-1 overflow-y-auto", isTablet ? "px-0" : "p-4")}>
      {Array.from({ length: 6 }).map((_, i) => (
        <ConversationCardSkeleton key={i} />
      ))}
    </div>
  );

  // Render skeleton while loading
  if (loading) {
    return (
      <div className={cn(
        "flex flex-col h-full",
        isTablet ? "bg-transparent" : "bg-muted/30 min-w-[300px]"
      )}>
        {skeletonList}
      </div>
    );
  }

  const rowVirtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 5,
  });

  const conversationListContent = (
    <div 
      ref={parentRef}
      className={cn(
        "flex-1 overflow-y-auto",
        isTablet ? "px-0" : "p-4"
      )}
      onScroll={(e) => {
        const bottom = e.currentTarget.scrollHeight - e.currentTarget.scrollTop <= e.currentTarget.clientHeight + 100;
        if (bottom && !loading && hasMore) {
          loadMore();
        }
      }}
    >
      {conversations.length === 0 && !loading ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <p className={cn(
            "font-medium",
            isTablet ? "text-sm" : "text-lg"
          )}>No conversations found</p>
          <p className="text-xs mt-1">Try adjusting your filters</p>
        </div>
      ) : (
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const conversation = conversations[virtualRow.index];
            return (
              <div
                key={conversation.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <ConversationCard
                  conversation={conversation}
                  selected={selectedId === conversation.id}
                  onClick={() => onSelect(conversation)}
                  onUpdate={handleRefresh}
                />
              </div>
            );
          })}
        </div>
      )}
      {loading && conversations.length > 0 && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );

  return (
    <div className={cn(
      "flex flex-col h-full",
      isTablet ? "bg-transparent" : "bg-muted/30 min-w-[300px]"
    )}>
      {/* Filter and Sort Controls */}
      <div className={cn(
        "py-3 border-b border-border/50 bg-background/80 backdrop-blur-sm space-y-2",
        isTablet ? "px-0 mb-4" : "px-4"
      )}>
        <div className="flex gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                className="flex-1 justify-between h-9 text-sm font-medium"
              >
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  <span>Filters</span>
                </div>
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-auto h-5 min-w-5 px-1.5 text-[10px] font-semibold">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-4" align="start">
              <ConversationFilters
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                priorityFilter={priorityFilter}
                setPriorityFilter={setPriorityFilter}
                channelFilter={channelFilter}
                setChannelFilter={setChannelFilter}
                categoryFilter={categoryFilter}
                setCategoryFilter={setCategoryFilter}
              />
            </PopoverContent>
          </Popover>
        </div>
        
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-full h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sla_urgent">🚨 SLA Urgent First</SelectItem>
            <SelectItem value="newest">🆕 Newest First</SelectItem>
            <SelectItem value="oldest">⏰ Oldest First</SelectItem>
            <SelectItem value="priority_high">🔴 High Priority First</SelectItem>
            <SelectItem value="priority_low">🟢 Low Priority First</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Pull-to-refresh wrapper (only on touch devices and tablet) */}
      {isTouchDevice() && isTablet ? (
        <PullToRefresh
          onRefresh={handleRefresh}
          pullingContent={
            <div className="text-center py-4 text-sm text-muted-foreground">
              Pull to refresh
            </div>
          }
          refreshingContent={
            <div className="text-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground mt-2">Refreshing...</p>
            </div>
          }
        >
          {conversationListContent}
        </PullToRefresh>
      ) : (
        conversationListContent
      )}
    </div>
  );
};
