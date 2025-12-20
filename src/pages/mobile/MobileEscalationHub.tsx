import { useState, useEffect } from 'react';
import { MobileConversationList } from '@/components/conversations/mobile/MobileConversationList';
import { MobileConversationView } from '@/components/conversations/mobile/MobileConversationView';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';
import { MobileHeader } from '@/components/sidebar/MobileHeader';
import { MobileFilterSheet } from '@/components/conversations/mobile/MobileFilterSheet';
import { Conversation, Message } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface MobileEscalationHubProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'awaiting-reply' | 'completed' | 'sent' | 'high-priority' | 'vip-customers' | 'escalations' | 'triaged' | 'needs-me' | 'snoozed' | 'cleared' | 'fyi';
}

export const MobileEscalationHub = ({ filter = 'all-open' }: MobileEscalationHubProps) => {
  const [currentFilter, setCurrentFilter] = useState<typeof filter>(filter);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [channelFilter, setChannelFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string>(() => {
    return localStorage.getItem('conversation-sort') || 'sla_urgent';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const { toast } = useToast();

  // Persist sort preference
  useEffect(() => {
    localStorage.setItem('conversation-sort', sortBy);
  }, [sortBy]);

  const filterTitles = {
    'my-tickets': 'My Tickets',
    'unassigned': 'Unassigned',
    'sla-risk': 'SLA Risk',
    'all-open': 'Inbox (All)',
    'awaiting-reply': 'Awaiting Reply',
    'completed': 'Completed',
    'sent': 'Sent',
    'high-priority': 'High Priority',
    'vip-customers': 'VIP Customers',
    'escalations': 'Escalations',
    'triaged': 'Triaged',
    'needs-me': 'To Reply',
    'snoozed': 'Snoozed',
    'cleared': 'Done',
    'fyi': 'FYI'
  };

  useEffect(() => {
    setCurrentFilter(filter);
  }, [filter]);

  useEffect(() => {
    loadConversations();

    // Real-time subscription
    const channel = supabase
      .channel('mobile-conversations-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations'
        },
        () => {
          loadConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentFilter, refreshKey, statusFilter, priorityFilter, channelFilter, categoryFilter, sortBy]);

  const loadConversations = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get workspace from user
    const { data: userData } = await supabase
      .from('users')
      .select('workspace_id')
      .eq('id', user.id)
      .single();
    
    if (!userData?.workspace_id) {
      setConversations([]);
      return;
    }

    let query = supabase
      .from('conversations')
      .select(`
        *,
        customer:customers(*),
        assigned_user:users(*)
      `)
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

    // Apply view filter (matching desktop logic exactly)
    if (currentFilter === 'my-tickets') {
      query = query.eq('assigned_to', user.id).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (currentFilter === 'unassigned') {
      query = query.is('assigned_to', null).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (currentFilter === 'sla-risk') {
      query = query.in('sla_status', ['warning', 'breached']).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (currentFilter === 'all-open') {
      query = query.in('status', ['new', 'open', 'waiting_customer', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (currentFilter === 'completed') {
      query = query.eq('status', 'resolved');
    } else if (currentFilter === 'sent') {
      // Show conversations where current user has sent outbound messages
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
        return;
      }
    } else if (currentFilter === 'high-priority') {
      query = query.in('priority', ['high', 'urgent']).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (currentFilter === 'vip-customers') {
      query = query.eq('metadata->>tier', 'vip').in('status', ['new', 'open', 'waiting_customer', 'waiting_internal', 'ai_handling', 'escalated']);
    } else if (currentFilter === 'escalations') {
      query = query.eq('is_escalated', true).in('status', ['new', 'in_progress', 'waiting', 'open', 'escalated', 'ai_handling']);
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

    const { data, error } = await query;

    if (error) {
      toast({
        title: "Error loading conversations",
        description: error.message,
        variant: "destructive"
      });
      return;
    }

    if (data) {
      const conversationData = data as any;
      // Filter out snoozed conversations (matching desktop)
      const activeConversations = conversationData.filter((conv: any) => {
        if (!conv.snoozed_until) return true;
        return new Date(conv.snoozed_until) <= new Date();
      });
      setConversations(activeConversations);
    }
  };

  const handleSelectConversation = async (conversation: Conversation) => {
    setSelectedConversation(conversation);
    
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });
    
    if (data) {
      setMessages(data as Message[]);
    }
  };

  const handleBack = () => {
    setSelectedConversation(null);
    setMessages([]);
  };

  const handleUpdate = async () => {
    await loadConversations();
    
    if (selectedConversation) {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', selectedConversation.id)
        .order('created_at', { ascending: true });
      
      if (data) {
        setMessages(data as Message[]);
      }
    }
  };

  const handleRefresh = async () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleAssignToMe = async () => {
    if (!selectedConversation) return;
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('conversations')
      .update({ assigned_to: user.id })
      .eq('id', selectedConversation.id);

    if (!error) {
      toast({ title: "Assigned to you" });
      handleUpdate();
    }
  };

  const handleResolve = async () => {
    if (!selectedConversation) return;

    const { error } = await supabase
      .from('conversations')
      .update({ 
        status: 'resolved',
        resolved_at: new Date().toISOString()
      })
      .eq('id', selectedConversation.id);

    if (!error) {
      toast({ title: "Conversation resolved" });
      handleBack();
      handleUpdate();
    }
  };

  const handlePriorityChange = async (priority: string) => {
    if (!selectedConversation) return;

    const { error } = await supabase
      .from('conversations')
      .update({ priority })
      .eq('id', selectedConversation.id);

    if (!error) {
      toast({ title: `Priority changed to ${priority}` });
      handleUpdate();
    }
  };

  // Screen B: Ticket Detail View
  if (selectedConversation) {
    return (
      <div className="min-h-screen bg-background">
        <MobileHeader
          onMenuClick={() => setSidebarOpen(true)}
          showBackButton
          onBackClick={handleBack}
          backToText={`Back to ${filterTitles[currentFilter]}`}
        />
        <MobileSidebarSheet
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          onNavigate={handleBack}
          onFiltersClick={() => {
            setSidebarOpen(false);
            setFilterSheetOpen(true);
          }}
        />
        <MobileConversationView
          conversation={selectedConversation}
          messages={messages}
          onBack={handleBack}
          onUpdate={handleUpdate}
        />
        <MobileFilterSheet
          open={filterSheetOpen}
          onOpenChange={setFilterSheetOpen}
          statusFilter={statusFilter}
          priorityFilter={priorityFilter}
          channelFilter={channelFilter}
          categoryFilter={categoryFilter}
          sortBy={sortBy}
          onStatusFilterChange={setStatusFilter}
          onPriorityFilterChange={setPriorityFilter}
          onChannelFilterChange={setChannelFilter}
          onCategoryFilterChange={setCategoryFilter}
          onSortByChange={setSortBy}
        />
      </div>
    );
  }

  // Screen A: Ticket List View
  return (
    <div className="min-h-screen bg-background">
      <MobileHeader
        onMenuClick={() => setSidebarOpen(true)}
      />
      <MobileSidebarSheet
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        onFiltersClick={() => {
          setSidebarOpen(false);
          setFilterSheetOpen(true);
        }}
      />
      <MobileConversationList
        conversations={conversations}
        onSelect={handleSelectConversation}
        filterTitle={filterTitles[currentFilter]}
        statusFilter={statusFilter}
        priorityFilter={priorityFilter}
        channelFilter={channelFilter}
        categoryFilter={categoryFilter}
        sortBy={sortBy}
        onStatusFilterChange={setStatusFilter}
        onPriorityFilterChange={setPriorityFilter}
        onChannelFilterChange={setChannelFilter}
        onCategoryFilterChange={setCategoryFilter}
        onSortByChange={setSortBy}
        onRefresh={handleRefresh}
      />
      <MobileFilterSheet
        open={filterSheetOpen}
        onOpenChange={setFilterSheetOpen}
        statusFilter={statusFilter}
        priorityFilter={priorityFilter}
        channelFilter={channelFilter}
        categoryFilter={categoryFilter}
        sortBy={sortBy}
        onStatusFilterChange={setStatusFilter}
        onPriorityFilterChange={setPriorityFilter}
        onChannelFilterChange={setChannelFilter}
        onCategoryFilterChange={setCategoryFilter}
        onSortByChange={setSortBy}
      />
    </div>
  );
};
