import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation, Message } from '@/lib/types';
import { ConversationHeader } from './ConversationHeader';
import { AIContextPanel } from './AIContextPanel';
import { MessageTimeline } from './MessageTimeline';
import { ReplyArea } from './ReplyArea';
import { MobileConversationView } from './mobile/MobileConversationView';
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

    // Save message to database first
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

    // For external messages, send via Twilio/Postmark
    if (!isInternal) {
      toast({ title: "Step 1", description: "Processing external message..." });
      console.log('🔄 Step 1: Processing external message for delivery...');
      
      try {
        // Fetch customer data if not available on conversation
        let customer = conversation.customer;
        console.log('👤 Customer from conversation:', customer);
        console.log('🆔 Customer ID:', conversation.customer_id);
        
        if (!customer && conversation.customer_id) {
          toast({ title: "Step 2", description: "Fetching customer data..." });
          console.log('📡 Step 2: Fetching customer data from database...');
          
          const { data: customerData, error: customerError } = await supabase
            .from('customers')
            .select('*')
            .eq('id', conversation.customer_id)
            .single();
          
          if (customerError) {
            console.error('❌ Error fetching customer:', customerError);
            toast({ title: "Error", description: `Customer fetch failed: ${customerError.message}`, variant: "destructive" });
          } else {
            console.log('✅ Customer data fetched:', customerData);
            customer = customerData as typeof conversation.customer;
          }
        }

        if (customer) {
          toast({ title: "Step 3", description: `Customer found: ${customer.name || customer.phone || customer.email}` });
          console.log('✅ Step 3: Customer found:', customer);
          
          // Determine recipient based on channel
          let recipient = '';
          console.log('📞 Channel:', conversation.channel);
          console.log('📧 Customer email:', customer.email);
          console.log('📱 Customer phone:', customer.phone);
          
          if (conversation.channel === 'email') {
            recipient = customer.email || '';
          } else if (conversation.channel === 'sms' || conversation.channel === 'whatsapp') {
            recipient = customer.phone || '';
          }

          console.log('📬 Determined recipient:', recipient);

          if (recipient) {
            toast({ title: "Step 4", description: `Calling send-response for ${recipient}...` });
            console.log('📤 Step 4: Sending message via edge function:', { channel: conversation.channel, recipient });
            
            const { data: sendResult, error: sendError } = await supabase.functions.invoke('send-response', {
              body: {
                conversationId: conversation.id,
                channel: conversation.channel,
                to: recipient,
                message: body,
                skipMessageLog: true, // We already saved the message above
                metadata: {
                  actorType: 'human_agent',
                  actorName: userData?.name || 'Agent',
                  actorId: user.id
                }
              }
            });

            if (sendError) {
              console.error('❌ Step 5 Error: send-response failed:', sendError);
              toast({
                title: "Step 5 Error",
                description: `Delivery failed: ${sendError.message}`,
                variant: "destructive"
              });
            } else {
              console.log('✅ Step 5: Message sent successfully:', sendResult);
              toast({ 
                title: "Step 5 Success", 
                description: `SMS delivered to ${recipient}!`,
              });
            }
          } else {
            console.warn('❌ No recipient found for channel:', conversation.channel);
            toast({
              title: "Step 4 Error",
              description: `No ${conversation.channel === 'email' ? 'email' : 'phone'} for customer`,
              variant: "destructive"
            });
          }
        } else {
          console.warn('❌ No customer found for conversation');
          toast({
            title: "Step 3 Error",
            description: "No customer found for delivery",
            variant: "destructive"
          });
        }
      } catch (error: any) {
        console.error('❌ Exception in send flow:', error);
        toast({
          title: "Exception", 
          description: `Send failed: ${error.message}`,
          variant: "destructive"
        });
      }
    }

    // Update conversation status and timestamps
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

    // Clear draft after successful send
    localStorage.removeItem(`draft-${conversation.id}`);
    
    // Show success toast
    toast({
      title: isInternal ? "Note added" : "Message sent",
      description: isInternal ? "Internal note saved" : "Your reply has been sent successfully",
    });
    
    // Trigger update to refresh conversation list
    onUpdate();
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

  // Desktop layout - uses mobile scroll pattern
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-shrink-0 bg-background border-b border-border">
        <ConversationHeader conversation={conversation} onUpdate={onUpdate} onBack={onBack} />
      </div>
      
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <AIContextPanel 
          conversation={conversation} 
          onUpdate={onUpdate}
          onUseDraft={setDraftText}
        />
        <MessageTimeline messages={messages} />
      </div>

      {!isCompleted && (
        <div className="flex-shrink-0">
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
        </div>
      )}

      {isCompleted && (
        <div className="flex-shrink-0 border-t border-border p-4 bg-muted/30">
          <Button onClick={handleReopen} className="w-full">
            Reopen Ticket
          </Button>
        </div>
      )}
    </div>
  );
};
