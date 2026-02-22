import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation, Message } from '@/lib/types';
import { ConversationHeader } from './ConversationHeader';
import { AIContextPanel } from './AIContextPanel';
import { MessageTimeline } from './MessageTimeline';
import { ReplyArea } from './ReplyArea';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

interface ConversationThreadProps {
  conversation: Conversation;
  onUpdate: () => void;
  onBack?: () => void;
  hideBackButton?: boolean;
}

export const ConversationThread = ({ conversation, onUpdate, onBack, hideBackButton }: ConversationThreadProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftText, setDraftText] = useState<string>('');  // Only for AI-generated drafts
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
        setMessages(data as unknown as Message[]);
      }
      setLoading(false);

      // Note: GDPR audit logging is handled server-side via RLS
      // Client-side logging removed as it violates RLS policies
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
            
            const { data: sendResult, error: sendError } = await supabase.functions.invoke('email-send', {
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
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-shrink-0 bg-background border-b border-border">
        <ConversationHeader conversation={conversation} onUpdate={onUpdate} onBack={onBack} hideBackButton={hideBackButton} />
      </div>
      
      {/* AI Briefing — whisper-style, no border */}
      <div className="flex-shrink-0 px-5 pt-3 pb-1">
        <AIContextPanel 
          conversation={conversation} 
          onUpdate={onUpdate}
          onUseDraft={setDraftText}
        />
      </div>

      {/* Customer Intelligence & Profile mini-cards */}
      {conversation.customer_id && conversation.workspace_id && (
        <div className="flex-shrink-0 px-5 pb-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Customer Profile Mini-Card */}
            <div className="bg-slate-50/50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-700/50 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Profile</span>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-foreground">{(conversation as any).customer?.name || 'Unknown'}</p>
                <p className="text-xs text-muted-foreground">{(conversation as any).customer?.email || ''}</p>
                {(conversation as any).customer?.phone && (
                  <p className="text-xs text-muted-foreground">{(conversation as any).customer.phone}</p>
                )}
              </div>
            </div>
            {/* Customer Intelligence Mini-Card */}
            <div className="bg-slate-50/50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-700/50 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Intelligence</span>
              </div>
              <div className="space-y-1.5">
                {conversation.ai_sentiment && (
                  <p className="text-xs text-muted-foreground">Sentiment: <span className="font-medium text-foreground capitalize">{conversation.ai_sentiment}</span></p>
                )}
                {conversation.category && (
                  <p className="text-xs text-muted-foreground">Category: <span className="font-medium text-foreground capitalize">{conversation.category}</span></p>
                )}
                {conversation.priority && (
                  <p className="text-xs text-muted-foreground">Priority: <span className="font-medium text-foreground capitalize">{conversation.priority}</span></p>
                )}
                {!conversation.ai_sentiment && !conversation.category && !conversation.priority && (
                  <p className="text-xs text-muted-foreground italic">No intelligence data yet</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Message Timeline — always gets remaining space */}
      <div className="flex-1 min-h-[200px] overflow-y-auto p-5">
        <MessageTimeline 
          messages={messages} 
          workspaceId={conversation.workspace_id}
          onDraftTextChange={setDraftText}
          conversationCustomerName={(conversation as any).customer?.name}
        />
      </div>

      {!isCompleted && (
        <div className="flex-shrink-0">
          <ReplyArea
          conversationId={conversation.id}
          channel={conversation.channel}
          aiDraftResponse={(conversation as any).ai_draft_response || conversation.metadata?.ai_draft_response as string}
          onSend={handleReply}
          externalDraftText={draftText || ((conversation as any).ai_draft_response as string) || (conversation.metadata?.ai_draft_response as string) || ''}
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
