import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation, Message } from '@/lib/types';
import { ConversationHeader } from './ConversationHeader';
import { AIContextPanel } from './AIContextPanel';
import { MessageTimeline } from './MessageTimeline';
import { ReplyArea } from './ReplyArea';
import { MobileConversationView } from './MobileConversationView';
import { useIsMobile } from '@/hooks/use-mobile';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

interface ConversationThreadProps {
  conversation: Conversation;
  onUpdate: () => void;
  onBack?: () => void;
}

export const ConversationThread = ({ conversation, onUpdate, onBack }: ConversationThreadProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftText, setDraftText] = useState<string>('');  // Only for AI-generated drafts
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const draftSaveTimeoutRef = useRef<NodeJS.Timeout>();

  // Reset AI draft when conversation changes
  useEffect(() => {
    setDraftText('');
  }, [conversation.id]);

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

      // Log conversation view for GDPR audit trail
      if (conversation.customer_id) {
        supabase.from('data_access_logs').insert({
          customer_id: conversation.customer_id,
          conversation_id: conversation.id,
          action: 'view',
        }).then(({ error }) => {
          if (error) console.error('Failed to log access:', error);
        });
      }
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

    // Clear draft after successful send
    localStorage.removeItem(`draft-${conversation.id}`);
  };

  const handleReopen = async () => {
    await supabase
      .from('conversations')
      .update({ 
        status: 'open',
        resolved_at: null
      })
      .eq('id', conversation.id);
    
    onUpdate();
  };

  const isCompleted = conversation.status === 'resolved';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Mobile layout with tabs
  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        <ConversationHeader conversation={conversation} onUpdate={onUpdate} onBack={onBack} />
        
        <MobileConversationView 
          conversation={conversation}
          messages={messages}
          onUpdate={onUpdate}
          onBack={onBack || (() => {})}
        />

      {!isCompleted && (
        <ReplyArea
          conversationId={conversation.id}
          channel={conversation.channel}
          aiDraftResponse={conversation.metadata?.ai_draft_response as string}
          onSend={handleReply}
          externalDraftText={draftText}  // Only pass draftText from AI, not replyText
          onDraftTextCleared={() => setDraftText('')}
          onDraftChange={(text) => {
            // Only save when text is being typed, not when cleared
            if (text) {
              localStorage.setItem(`draft-${conversation.id}`, text);
            }
          }}
        />
      )}

        {isCompleted && (
          <div className="border-t border-border p-4 bg-muted/30">
            <Button onClick={handleReopen} className="w-full">
              Reopen Ticket
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="flex flex-col h-full">
      <ConversationHeader conversation={conversation} onUpdate={onUpdate} onBack={onBack} />
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AIContextPanel 
          conversation={conversation} 
          onUpdate={onUpdate}
          onUseDraft={setDraftText}
        />
        <MessageTimeline messages={messages} />
      </div>

      {!isCompleted && (
        <ReplyArea
          conversationId={conversation.id}
          channel={conversation.channel}
          aiDraftResponse={conversation.metadata?.ai_draft_response as string}
          onSend={handleReply}
          externalDraftText={draftText}  // Only pass draftText from AI, not replyText
          onDraftTextCleared={() => {
            setDraftText('');
          }}
          onDraftChange={(text) => {
            // Only save when text is being typed, not when cleared
            if (text) {
              localStorage.setItem(`draft-${conversation.id}`, text);
            }
          }}
        />
      )}

      {isCompleted && (
        <div className="border-t border-border p-4 bg-muted/30">
          <Button onClick={handleReopen} className="w-full">
            Reopen Ticket
          </Button>
        </div>
      )}
    </div>
  );
};
