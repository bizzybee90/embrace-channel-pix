import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation, Message } from '@/lib/types';
import { ConversationHeader } from './ConversationHeader';
import { AIContextPanel } from './AIContextPanel';
import { MessageTimeline } from './MessageTimeline';
import { ReplyArea } from './ReplyArea';
import { Loader2 } from 'lucide-react';

interface ConversationThreadProps {
  conversation: Conversation;
  onUpdate: () => void;
}

export const ConversationThread = ({ conversation, onUpdate }: ConversationThreadProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });

      if (data) {
        setMessages(data as Message[]);
      }
      setLoading(false);
    };

    fetchMessages();

    // Real-time subscription for new messages
    const channel = supabase
      .channel(`messages-${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation.id}`
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation.id]);

  const handleReply = async (body: string, isInternal: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from('users')
      .select('name')
      .eq('id', user.id)
      .single();

    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      actor_type: isInternal ? 'system' : 'human_agent',
      actor_id: user.id,
      actor_name: userData?.name || 'Agent',
      direction: 'outbound',
      channel: conversation.channel,
      body,
      is_internal: isInternal
    });

    if (!isInternal && !conversation.first_response_at) {
      await supabase
        .from('conversations')
        .update({ first_response_at: new Date().toISOString() })
        .eq('id', conversation.id);
    }

    onUpdate();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ConversationHeader conversation={conversation} onUpdate={onUpdate} />
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AIContextPanel conversation={conversation} />
        <MessageTimeline messages={messages} />
      </div>

      <ReplyArea
        conversationId={conversation.id}
        channel={conversation.channel}
        onSend={handleReply}
      />
    </div>
  );
};
