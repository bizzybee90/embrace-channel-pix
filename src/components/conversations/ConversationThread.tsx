import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation, Message } from '@/lib/types';
import { ConversationHeader } from './ConversationHeader';
import { AIContextPanel } from './AIContextPanel';
import { MessageTimeline } from './MessageTimeline';
import { ReplyArea } from './ReplyArea';
import { CustomerIntelligence } from '@/components/customers/CustomerIntelligence';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface ConversationThreadProps {
  conversation: Conversation;
  onUpdate: () => void;
  onBack?: () => void;
  hideBackButton?: boolean;
}

export const ConversationThread = ({ conversation, onUpdate, onBack, hideBackButton }: ConversationThreadProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftText, setDraftText] = useState<string>('');
  const [customer, setCustomer] = useState<any>(null);
  const [intelligenceDrawerOpen, setIntelligenceDrawerOpen] = useState(false);
  const { toast } = useToast();
  const draftSaveTimeoutRef = useRef<NodeJS.Timeout>();

  // Reset AI draft when conversation changes
  useEffect(() => {
    setDraftText('');
  }, [conversation.id]);

  // Fetch real customer data
  useEffect(() => {
    const fetchCustomer = async () => {
      if (!conversation.customer_id) {
        setCustomer((conversation as any).customer || null);
        return;
      }
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('id', conversation.customer_id)
        .single();
      setCustomer(data || (conversation as any).customer || null);
    };
    fetchCustomer();
  }, [conversation.id, conversation.customer_id]);

  useEffect(() => {
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });

      if (data) {
        setMessages(data as unknown as Message[]);
      }
      setLoading(false);
    };

    fetchMessages();

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

    const { data: newMessage, error: insertError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        actor_type: isInternal ? 'system' : 'human_agent',
        actor_id: user.id,
        actor_name: userData?.name || 'Agent',
        direction: 'outbound',
        channel: conversation.channel,
        body,
        is_internal: isInternal
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error sending message:', insertError);
      toast({
        title: "Error sending message",
        description: insertError.message,
        variant: "destructive"
      });
      return;
    }

    if (!isInternal) {
      try {
        let customerData = conversation.customer;
        if (!customerData && conversation.customer_id) {
          const { data: fetched } = await supabase
            .from('customers')
            .select('*')
            .eq('id', conversation.customer_id)
            .single();
          customerData = fetched as typeof conversation.customer;
        }

        if (customerData) {
          let recipient = '';
          if (conversation.channel === 'email') {
            recipient = customerData.email || '';
          } else if (conversation.channel === 'sms' || conversation.channel === 'whatsapp') {
            recipient = customerData.phone || '';
          }

          if (recipient) {
            const { error: sendError } = await supabase.functions.invoke('email-send', {
              body: {
                conversationId: conversation.id,
                channel: conversation.channel,
                to: recipient,
                message: body,
                skipMessageLog: true,
                metadata: {
                  actorType: 'human_agent',
                  actorName: userData?.name || 'Agent',
                  actorId: user.id
                }
              }
            });

            if (sendError) {
              toast({ title: "Delivery failed", description: sendError.message, variant: "destructive" });
            }
          } else {
            toast({ title: "No recipient", description: `No ${conversation.channel === 'email' ? 'email' : 'phone'} for customer`, variant: "destructive" });
          }
        }
      } catch (error: any) {
        toast({ title: "Send failed", description: error.message, variant: "destructive" });
      }
    }

    if (!isInternal) {
      const updateData: any = {
        updated_at: new Date().toISOString(),
        status: 'waiting_customer',
      };
      if (!conversation.first_response_at) {
        updateData.first_response_at = new Date().toISOString();
      }
      await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', conversation.id);
    }

    localStorage.removeItem(`draft-${conversation.id}`);
    toast({
      title: isInternal ? "Note added" : "Message sent",
      description: isInternal ? "Internal note saved" : "Your reply has been sent successfully",
    });
    onUpdate();
  };

  const handleReopen = async () => {
    await supabase
      .from('conversations')
      .update({ status: 'open', resolved_at: null })
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

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Compact header bar */}
      <div className="flex-shrink-0 bg-background border-b border-border">
        <ConversationHeader conversation={conversation} onUpdate={onUpdate} onBack={onBack} hideBackButton={hideBackButton} />
      </div>
      
      {/* Collapsible AI briefing — one subtle line */}
      <div className="flex-shrink-0 px-4 border-b border-border/30">
        <AIContextPanel 
          conversation={conversation} 
          onUpdate={onUpdate}
          onUseDraft={setDraftText}
        />
      </div>

      {/* Compact sender info bar with View Intelligence link */}
      {(conversation.customer_id || customer) && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-border/30 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0">
              {(customer?.name || 'U').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
            </div>
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">{customer?.name || 'Unknown'}</span>
              {customer?.email && (
                <span className="text-xs text-muted-foreground truncate hidden sm:inline">{customer.email}</span>
              )}
            </div>
          </div>
          <button 
            onClick={() => setIntelligenceDrawerOpen(true)}
            className="text-xs font-medium text-primary hover:text-primary/80 hover:underline transition-colors flex-shrink-0"
          >
            View Intelligence →
          </button>
        </div>
      )}

      {/* Intelligence Slide-Over Drawer */}
      <Sheet open={intelligenceDrawerOpen} onOpenChange={setIntelligenceDrawerOpen}>
        <SheetContent side="right" className="w-[400px] sm:w-[450px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              Customer Intelligence
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            {conversation.workspace_id && (conversation.customer_id || customer?.id) && (
              <CustomerIntelligence 
                workspaceId={conversation.workspace_id}
                customerId={conversation.customer_id || customer?.id}
                conversationId={conversation.id}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Email body — THE MAIN CONTENT — fills all remaining space */}
      <div className="flex-1 min-h-[200px] overflow-y-auto p-4">
        <MessageTimeline 
          messages={messages} 
          workspaceId={conversation.workspace_id}
          onDraftTextChange={setDraftText}
          conversationCustomerName={customer?.name}
        />
      </div>

      {/* Reply area at bottom */}
      {!isCompleted && (
        <div className="flex-shrink-0">
          <ReplyArea
            conversationId={conversation.id}
            channel={conversation.channel}
            aiDraftResponse={(conversation as any).ai_draft_response || conversation.metadata?.ai_draft_response as string}
            onSend={handleReply}
            externalDraftText={draftText || ((conversation as any).ai_draft_response as string) || (conversation.metadata?.ai_draft_response as string) || ''}
            onDraftTextCleared={() => setDraftText('')}
            onDraftChange={(text) => {
              if (text) {
                localStorage.setItem(`draft-${conversation.id}`, text);
              }
            }}
          />
        </div>
      )}
    </div>
  );
};
