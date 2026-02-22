import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Conversation, Message } from '@/lib/types';
import { ConversationHeader } from './ConversationHeader';
import { MessageTimeline } from './MessageTimeline';
import { ReplyArea } from './ReplyArea';
import { CustomerIntelligence } from '@/components/customers/CustomerIntelligence';
import { Loader2, Brain, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ConversationThreadProps {
  conversation: Conversation;
  onUpdate: () => void;
  onBack?: () => void;
  hideBackButton?: boolean;
}

const WIDE_BREAKPOINT = 1400;

export const ConversationThread = ({ conversation, onUpdate, onBack, hideBackButton }: ConversationThreadProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftText, setDraftText] = useState<string>('');
  const [customer, setCustomer] = useState<any>(null);
  const [intelligenceDrawerOpen, setIntelligenceDrawerOpen] = useState(false);
  const [isWide, setIsWide] = useState(false);
  const { toast } = useToast();
  const draftSaveTimeoutRef = useRef<NodeJS.Timeout>();

  // Track wide viewport for permanent intelligence panel
  useEffect(() => {
    const check = () => setIsWide(window.innerWidth >= WIDE_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

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

  // AI Briefing text
  const briefingText = conversation.summary_for_human
    || (conversation as any).ai_why_flagged
    || (conversation as any).why_this_needs_you
    || conversation.ai_reason_for_escalation
    || null;

  const getSentimentLabel = (s: string | null) => {
    switch (s) {
      case 'positive': return { emoji: '😊', label: 'Positive' };
      case 'negative': return { emoji: '😟', label: 'Negative' };
      case 'frustrated': return { emoji: '😤', label: 'Frustrated' };
      case 'neutral': return { emoji: '😐', label: 'Neutral' };
      default: return null;
    }
  };

  const sentiment = getSentimentLabel(conversation.ai_sentiment);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const intelligencePanel = conversation.workspace_id && (conversation.customer_id || customer?.id) ? (
    <CustomerIntelligence
      workspaceId={conversation.workspace_id}
      customerId={conversation.customer_id || customer?.id}
      conversationId={conversation.id}
    />
  ) : null;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Main reading pane */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        {/* Nav header bar */}
        <div className="flex-shrink-0 bg-background border-b border-border">
          <ConversationHeader conversation={conversation} onUpdate={onUpdate} onBack={onBack} hideBackButton={hideBackButton} />
        </div>

        {/* 1. Sender Info Row — first thing after nav */}
        {(conversation.customer_id || customer) && (
          <div className="flex-shrink-0 px-4 py-2.5 border-b border-border/40 flex items-center justify-between bg-background">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-[11px] font-semibold flex-shrink-0 shadow-sm">
                {(customer?.name || 'U').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
              </div>
              <div className="min-w-0 flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground truncate">{customer?.name || 'Unknown'}</span>
                {customer?.email && (
                  <span className="text-xs text-muted-foreground truncate hidden sm:inline">{'<'}{customer.email}{'>'}</span>
                )}
              </div>
            </div>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {conversation.created_at ? new Date(conversation.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
          </div>
        )}

        {/* 2. Ambient AI Context Bento Strip */}
        {briefingText && (
          <div className="flex-shrink-0 mx-4 mt-3 mb-2 p-3 bg-indigo-50/50 dark:bg-indigo-950/20 rounded-xl border border-indigo-100 dark:border-indigo-800/40 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between shadow-sm">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <Sparkles className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-indigo-950 dark:text-indigo-200 leading-relaxed line-clamp-2 flex-1">
                {briefingText}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {conversation.category && (
                <span className="bg-white dark:bg-indigo-900/40 px-2 py-1 text-xs font-medium rounded-md border border-indigo-100 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300">
                  {conversation.category}
                </span>
              )}
              {sentiment && (
                <span className="bg-white dark:bg-indigo-900/40 px-2 py-1 text-xs font-medium rounded-md border border-indigo-100 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300">
                  {sentiment.emoji} {sentiment.label}
                </span>
              )}
              {!isWide && (
                <Button
                  size="sm"
                  onClick={() => setIntelligenceDrawerOpen(true)}
                  className="bg-white dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/80 border border-indigo-200 dark:border-indigo-700 shadow-sm rounded-lg flex items-center gap-1.5 h-8"
                >
                  <Brain className="w-3.5 h-3.5" />
                  Deep Dive
                </Button>
              )}
            </div>
          </div>
        )}

        {/* 3. Email body — naked canvas, fills remaining space */}
        <div className="flex-1 min-h-[200px] overflow-y-auto">
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

      {/* Permanent right intelligence panel on wide screens */}
      {isWide && intelligencePanel && (
        <div className="flex-shrink-0 w-[300px] border-l border-border overflow-y-auto bg-muted/20 p-4">
          <div className="flex items-center gap-2 mb-4">
            <Brain className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-foreground">Intelligence</h3>
          </div>
          {intelligencePanel}
        </div>
      )}

      {/* Slide-out drawer for narrow screens */}
      {!isWide && (
        <Sheet open={intelligenceDrawerOpen} onOpenChange={setIntelligenceDrawerOpen}>
          <SheetContent side="right" className="w-[400px] sm:w-[450px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-indigo-600" />
                Customer Intelligence
              </SheetTitle>
            </SheetHeader>
            <div className="mt-4">
              {intelligencePanel}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
};
