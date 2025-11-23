import { useState, useEffect } from 'react';
import { MobileConversationList } from '@/components/conversations/mobile/MobileConversationList';
import { MobileConversationView } from '@/components/conversations/mobile/MobileConversationView';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';
import { MobileHeader } from '@/components/sidebar/MobileHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { MobileFilterSheet } from '@/components/conversations/mobile/MobileFilterSheet';
import { Conversation, Message } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface MobileEscalationHubProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'completed' | 'high-priority' | 'vip-customers';
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const { toast } = useToast();

  const filterTitles = {
    'my-tickets': 'My Tickets',
    'unassigned': 'Unassigned',
    'sla-risk': 'SLA Risk',
    'all-open': 'All Open',
    'completed': 'Completed',
    'high-priority': 'High Priority',
    'vip-customers': 'VIP Customers'
  };

  useEffect(() => {
    setCurrentFilter(filter);
  }, [filter]);

  useEffect(() => {
    loadConversations();
  }, [currentFilter, refreshKey, statusFilter, priorityFilter, channelFilter, categoryFilter]);

  const loadConversations = async () => {
    let query = supabase
      .from('conversations')
      .select('*')
      .order('created_at', { ascending: false });

    // Apply filters
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

    // Apply main filter
    switch (currentFilter) {
      case 'my-tickets':
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          query = query.eq('assigned_to', user.id);
        }
        break;
      case 'unassigned':
        query = query.is('assigned_to', null);
        break;
      case 'sla-risk':
        query = query.not('sla_due_at', 'is', null);
        break;
      case 'all-open':
        query = query.in('status', ['new', 'open', 'pending']);
        break;
      case 'completed':
        query = query.eq('status', 'resolved');
        break;
      case 'high-priority':
        query = query.in('priority', ['high', 'urgent']).in('status', ['new', 'open', 'pending']);
        break;
      case 'vip-customers':
        query = query.eq('metadata->>tier', 'vip').in('status', ['new', 'open', 'pending']);
        break;
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

    setConversations((data || []) as Conversation[]);
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
      <div className="min-h-screen bg-background pb-20">
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
          onStatusFilterChange={setStatusFilter}
          onPriorityFilterChange={setPriorityFilter}
          onChannelFilterChange={setChannelFilter}
          onCategoryFilterChange={setCategoryFilter}
        />
        <MobileBottomNav
          activeFilter={currentFilter}
          onNavigate={(newFilter) => {
            setCurrentFilter(newFilter);
            handleBack();
          }}
          onMenuClick={() => setSidebarOpen(true)}
        />
      </div>
    );
  }

  // Screen A: Ticket List View
  return (
    <div className="min-h-screen bg-background pb-20">
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
        onStatusFilterChange={setStatusFilter}
        onPriorityFilterChange={setPriorityFilter}
        onChannelFilterChange={setChannelFilter}
        onCategoryFilterChange={setCategoryFilter}
        onRefresh={handleRefresh}
      />
      <MobileFilterSheet
        open={filterSheetOpen}
        onOpenChange={setFilterSheetOpen}
        statusFilter={statusFilter}
        priorityFilter={priorityFilter}
        channelFilter={channelFilter}
        categoryFilter={categoryFilter}
        onStatusFilterChange={setStatusFilter}
        onPriorityFilterChange={setPriorityFilter}
        onChannelFilterChange={setChannelFilter}
        onCategoryFilterChange={setCategoryFilter}
      />
      <MobileBottomNav
        activeFilter={currentFilter}
        onNavigate={setCurrentFilter}
        onMenuClick={() => setSidebarOpen(true)}
      />
    </div>
  );
};
