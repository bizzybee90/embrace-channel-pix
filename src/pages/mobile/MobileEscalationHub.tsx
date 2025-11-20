import { useState, useEffect } from 'react';
import { MobileConversationList } from '@/components/conversations/mobile/MobileConversationList';
import { MobileConversationView } from '@/components/conversations/mobile/MobileConversationView';
import { Conversation, Message } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface MobileEscalationHubProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const MobileEscalationHub = ({ filter = 'all-open' }: MobileEscalationHubProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const { toast } = useToast();

  const filterTitles = {
    'my-tickets': 'My Tickets',
    'unassigned': 'Unassigned',
    'sla-risk': 'SLA Risk',
    'all-open': 'All Open'
  };

  useEffect(() => {
    loadConversations();
  }, [filter, refreshKey, statusFilter, priorityFilter, channelFilter, categoryFilter]);

  const loadConversations = async () => {
    let query = supabase
      .from('conversations')
      .select('*')
      .order('created_at', { ascending: false });

    // Apply filters
    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }
    if (priorityFilter !== 'all') {
      query = query.eq('priority', priorityFilter);
    }
    if (channelFilter !== 'all') {
      query = query.eq('channel', channelFilter);
    }
    if (categoryFilter !== 'all') {
      query = query.eq('category', categoryFilter);
    }

    // Apply main filter
    switch (filter) {
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

  if (selectedConversation) {
    return (
      <MobileConversationView
        conversation={selectedConversation}
        messages={messages}
        onBack={handleBack}
        onUpdate={handleUpdate}
      />
    );
  }

  return (
    <MobileConversationList
      conversations={conversations}
      onSelect={handleSelectConversation}
      filterTitle={filterTitles[filter]}
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
  );
};
