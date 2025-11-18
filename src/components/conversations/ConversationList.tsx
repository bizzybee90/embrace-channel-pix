import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation } from '@/lib/types';
import { ConversationCard } from './ConversationCard';
import { ConversationFilters } from './ConversationFilters';
import { Loader2 } from 'lucide-react';

interface ConversationListProps {
  selectedId?: string;
  onSelect: (conversation: Conversation) => void;
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
  onConversationsChange?: (conversations: Conversation[]) => void;
}

export const ConversationList = ({ selectedId, onSelect, filter = 'all-open', onConversationsChange }: ConversationListProps) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  useEffect(() => {
    const fetchConversations = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let query = supabase
        .from('conversations')
        .select(`
          *,
          customer:customers(*),
          assigned_user:users(*)
        `)
        .order('sla_due_at', { ascending: true });

      // Apply view filter
      if (filter === 'my-tickets') {
        query = query.eq('assigned_to', user.id).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal']);
      } else if (filter === 'unassigned') {
        query = query.is('assigned_to', null).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal']);
      } else if (filter === 'sla-risk') {
        query = query.in('sla_status', ['warning', 'breached']).in('status', ['new', 'open', 'waiting_customer', 'waiting_internal']);
      } else if (filter === 'all-open') {
        query = query.in('status', ['new', 'open', 'waiting_customer', 'waiting_internal']);
      }

      // Apply additional filters
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

      const { data } = await query;
      if (data) {
        const conversationData = data as any;
        // Filter out snoozed conversations
        const activeConversations = conversationData.filter((conv: any) => {
          if (!conv.snoozed_until) return true;
          return new Date(conv.snoozed_until) <= new Date();
        });
        setConversations(activeConversations);
        onConversationsChange?.(activeConversations);
      }
      setLoading(false);
    };

    fetchConversations();

    // Real-time subscription
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
          fetchConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [filter, statusFilter, priorityFilter, channelFilter, categoryFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
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
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 px-4">
            <p className="text-muted-foreground text-sm">No conversations match your filters</p>
            <p className="text-muted-foreground/60 text-xs mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {conversations.map((conversation) => (
              <ConversationCard
                key={conversation.id}
                conversation={conversation}
                isSelected={conversation.id === selectedId}
                onClick={() => onSelect(conversation)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
