import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation } from '@/lib/types';
import { ConversationCard } from './ConversationCard';
import { ConversationCardSkeleton } from './ConversationCardSkeleton';
import { ConversationFilters } from './ConversationFilters';
import { SearchInput } from './SearchInput';
import { useIsTablet } from '@/hooks/use-tablet';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PullToRefresh from 'react-simple-pull-to-refresh';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface ConversationListProps {
  selectedId?: string;
  onSelect: (conversation: Conversation) => void;
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'awaiting-reply' | 'completed' | 'sent' | 'high-priority' | 'vip-customers' | 'escalations';
  onConversationsChange?: (conversations: Conversation[]) => void;
  channelFilter?: string;
}

export const ConversationList = ({ selectedId, onSelect, filter = 'all-open', onConversationsChange, channelFilter: initialChannelFilter }: ConversationListProps) => {
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
  const [searchQuery, setSearchQuery] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 50;
  const queryClient = useQueryClient();

  // Persist sort preference
  useEffect(() => {
    localStorage.setItem('conversation-sort', sortBy);
  }, [sortBy]);

  const fetchConversations = async (pageNum: number = 0) => {
    const { data: { user } } = await supabase.auth.getUser();
    console.log('🔍 [ConversationList] Fetching conversations for user:', user?.id);
    
    if (!user) {
      console.error('❌ [ConversationList] No authenticated user');
      return { data: [], count: 0 };
    }

    // Use optimized RPC for "sent" filter
    if (filter === 'sent') {
      const { data, error } = await supabase.rpc('get_sent_conversations', {
        p_user_id: user.id,
        p_limit: PAGE_SIZE,
        p_offset: pageNum * PAGE_SIZE
      });

      if (error) throw error;
      
      const activeConversations = (data || []).filter((conv: any) => {
        if (!conv.snoozed_until) return true;
        return new Date(conv.snoozed_until) <= new Date();
      });

      console.log('✅ [ConversationList] Sent conversations fetched:', activeConversations.length);
      return { data: activeConversations, count: activeConversations.length };
    }

    // Get workspace from user
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('workspace_id')
      .eq('id', user.id)
      .single();
    
    console.log('🏢 [ConversationList] User workspace data:', userData);
    
    if (userError) {
      console.error('❌ [ConversationList] Error fetching user workspace:', userError);
      return { data: [], count: 0 };
    }
    
    if (!userData?.workspace_id) {
      console.error('❌ [ConversationList] User has no workspace_id assigned');
      return { data: [], count: 0 };
    }
    
    console.log('✅ [ConversationList] Using workspace_id:', userData.workspace_id);

    let query = supabase
      .from('conversations')
      .select(`
        *,
        customer:customers(*),
        assigned_user:users(*)
      `, { count: 'exact' })
      .eq('workspace_id', userData.workspace_id);

    // Apply sorting
    switch (sortBy) {
      case 'newest':
        query = query.order('updated_at', { ascending: false });
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
        query = query
          .order('sla_due_at', { ascending: true, nullsFirst: false })
          .order('updated_at', { ascending: false });
        break;
    }

    // Apply view filter
    if (filter === 'my-tickets') {
      query = query.eq('assigned_to', user.id).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (filter === 'unassigned') {
      query = query.is('assigned_to', null).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (filter === 'sla-risk') {
      query = query.in('sla_status', ['warning', 'breached']).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (filter === 'all-open') {
      // Exclude waiting_customer - those are in "Awaiting Reply" view
      query = query.in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (filter === 'awaiting-reply') {
      query = query.in('status', ['waiting_customer', 'waiting_internal']);
    } else if (filter === 'completed') {
      query = query.eq('status', 'resolved');
    } else if (filter === 'high-priority') {
      query = query.in('priority', ['high', 'urgent']).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (filter === 'vip-customers') {
      query = query.eq('metadata->>tier', 'vip').in('status', ['new', 'open', 'waiting_customer', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (filter === 'escalations') {
      query = query.eq('is_escalated', true).in('status', ['new', 'in_progress', 'waiting', 'open', 'escalated', 'ai_handling']);
    }
    
    console.log('🔎 [ConversationList] Applied filter:', filter);

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

    const { data, count, error } = await query;
    if (error) {
      console.error('❌ [ConversationList] Query error:', error);
      throw error;
    }

    console.log('📊 [ConversationList] Raw query result:', {
      totalCount: count,
      dataLength: data?.length,
      firstConv: data?.[0]
    });

    const conversationData = data as any;
    const activeConversations = conversationData.filter((conv: any) => {
      if (!conv.snoozed_until) return true;
      return new Date(conv.snoozed_until) <= new Date();
    });

    console.log('✅ [ConversationList] Active conversations after filtering:', activeConversations.length);
    return { data: activeConversations, count: count || 0 };
  };

  // Track last update time
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // React Query setup with optimistic UI
  const queryKey = ['conversations', filter, statusFilter, priorityFilter, channelFilter, categoryFilter, sortBy, page];
  
  const { data: queryData, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await fetchConversations(page);
      setLastUpdated(new Date());
      return result;
    },
    staleTime: 30000, // Cache for 30 seconds
    refetchInterval: 60000, // Refetch every 60 seconds in background
  });

  const conversations = queryData?.data || [];
  const hasMore = queryData ? (page + 1) * PAGE_SIZE < (queryData.count || 0) : false;

  // Filter conversations by search query
  const filteredConversations = conversations.filter(conv => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      conv.title?.toLowerCase().includes(query) ||
      conv.summary_for_human?.toLowerCase().includes(query) ||
      (conv as any).customer?.name?.toLowerCase().includes(query) ||
      (conv as any).customer?.email?.toLowerCase().includes(query) ||
      (conv as any).customer?.phone?.toLowerCase().includes(query)
    );
  });

  // Notify parent of conversation changes
  useEffect(() => {
    if (conversations.length > 0) {
      onConversationsChange?.(conversations);
    }
  }, [conversations, onConversationsChange]);

  // Real-time updates with improved subscription
  useEffect(() => {
    console.log('🔔 [ConversationList] Setting up realtime subscription for filter:', filter);
    
    const channel = supabase
      .channel('conversations-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversations'
        },
        (payload) => {
          console.log('➕ [ConversationList] New conversation inserted:', payload.new);
          queryClient.invalidateQueries({ queryKey: ['conversations'] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations'
        },
        (payload) => {
          console.log('🔄 [ConversationList] Conversation updated:', payload.new);
          queryClient.invalidateQueries({ queryKey: ['conversations'] });
        }
      )
      .subscribe((status) => {
        console.log('🔔 [ConversationList] Realtime subscription status:', status);
      });

    return () => {
      console.log('🔕 [ConversationList] Cleaning up realtime subscription');
      supabase.removeChannel(channel);
    };
  }, [filter, queryClient]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [filter, statusFilter, priorityFilter, channelFilter, categoryFilter, sortBy, searchQuery]);

  const loadMore = useCallback(() => {
    if (!isLoading && !isFetching && hasMore) {
      setPage(prev => prev + 1);
    }
  }, [isLoading, isFetching, hasMore]);

  const activeFilterCount = statusFilter.length + priorityFilter.length + channelFilter.length + categoryFilter.length;

  const handleRefresh = async () => {
    console.log('🔄 [ConversationList] Manual refresh triggered');
    setPage(0);
    await queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  const getTimeSinceUpdate = () => {
    const seconds = Math.floor((new Date().getTime() - lastUpdated.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
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

  // Show skeleton only on initial load (not when refetching)
  if (isLoading && conversations.length === 0) {
    return (
      <div className={cn(
        "flex flex-col h-full",
        isTablet ? "bg-transparent" : "bg-muted/30 min-w-[300px]"
      )}>
        {skeletonList}
      </div>
    );
  }

  const conversationListContent = (
    <div 
      ref={parentRef}
      className={cn(
        "flex-1 overflow-y-auto",
        isTablet ? "px-0" : "p-4"
      )}
      onScroll={(e) => {
        const bottom = e.currentTarget.scrollHeight - e.currentTarget.scrollTop <= e.currentTarget.clientHeight + 100;
        if (bottom && !isLoading && !isFetching && hasMore) {
          loadMore();
        }
      }}
    >
      {filteredConversations.length === 0 && !isLoading ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <p className={cn(
            "font-medium",
            isTablet ? "text-sm" : "text-lg"
          )}>No conversations found</p>
          <p className="text-xs mt-1">Try adjusting your filters</p>
        </div>
      ) : (
        <>
          {filteredConversations.map((conversation) => (
            <ConversationCard
              key={conversation.id}
              conversation={conversation}
              selected={selectedId === conversation.id}
              onClick={() => onSelect(conversation)}
              onUpdate={handleRefresh}
            />
          ))}
          {isFetching && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className={cn(
      "flex flex-col h-full",
      isTablet ? "bg-transparent" : "bg-muted/30 min-w-[300px]"
    )}>
      {/* Search and Filter Controls */}
      <div className={cn(
        "py-3 border-b border-border/50 bg-background/80 backdrop-blur-sm space-y-2",
        isTablet ? "px-0 mb-4" : "px-4"
      )}>
        {/* Last Updated Indicator */}
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>Last updated: {getTimeSinceUpdate()}</span>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isFetching}
            className="h-6 px-2 text-xs"
          >
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
        
        {/* Search Input */}
        <SearchInput 
          value={searchQuery} 
          onChange={setSearchQuery}
          placeholder="Search by name, email, or content..."
        />
        
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
