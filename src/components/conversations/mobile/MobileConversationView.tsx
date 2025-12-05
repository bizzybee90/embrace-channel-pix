import { useState, useEffect } from 'react';
import { MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Conversation, Message } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { AIContextPanel } from '@/components/conversations/AIContextPanel';
import { MessageTimeline } from '@/components/conversations/MessageTimeline';
import { ReplyArea } from '@/components/conversations/ReplyArea';
import { SnoozeDialog } from '@/components/conversations/SnoozeDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useScrollDirection } from '@/hooks/useScrollDirection';
import { cn } from '@/lib/utils';

interface MobileConversationViewProps {
  conversation: Conversation;
  messages: Message[];
  onBack: () => void;
  onUpdate: () => void;
}


export const MobileConversationView = ({
  conversation,
  messages,
  onBack,
  onUpdate,
}: MobileConversationViewProps) => {
  const [draftText, setDraftText] = useState('');
  const [snoozeDialogOpen, setSnoozeDialogOpen] = useState(false);
  const { toast } = useToast();
  const scrollState = useScrollDirection(120);

  // Hide bottom nav when this view is mounted
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('mobile-nav-visibility', { 
      detail: { hidden: true } 
    }));
    
    return () => {
      // Show bottom nav when unmounting (going back to list)
      window.dispatchEvent(new CustomEvent('mobile-nav-visibility', { 
        detail: { hidden: false } 
      }));
    };
  }, []);

  const handleResolve = async () => {
    const { error } = await supabase
      .from('conversations')
      .update({ 
        status: 'resolved',
        resolved_at: new Date().toISOString()
      })
      .eq('id', conversation.id);

    if (!error) {
      toast({ 
        title: "✨ Conversation Resolved",
        description: "Great work! Moving on to the next one."
      });
      onBack();
      onUpdate();
    }
  };

  const handleReply = async (body: string, isInternal: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from('users')
      .select('name')
      .eq('id', user.id)
      .single();

    // Save message to database first
    const { error: insertError } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      actor_type: isInternal ? 'system' : 'human_agent',
      actor_id: user.id,
      actor_name: userData?.name || 'Agent',
      direction: 'outbound',
      channel: conversation.channel,
      body,
      is_internal: isInternal
    });

    if (insertError) {
      toast({
        title: "Error sending message",
        description: insertError.message,
        variant: "destructive"
      });
      return;
    }

    // For external messages, send via Twilio/Postmark
    if (!isInternal) {
      try {
        // Fetch customer data if not available
        let customer = conversation.customer;
        if (!customer && conversation.customer_id) {
          const { data: customerData } = await supabase
            .from('customers')
            .select('*')
            .eq('id', conversation.customer_id)
            .single();
          customer = customerData as typeof conversation.customer;
        }

        if (customer) {
          let recipient = '';
          if (conversation.channel === 'email') {
            recipient = customer.email || '';
          } else if (conversation.channel === 'sms' || conversation.channel === 'whatsapp') {
            recipient = customer.phone || '';
          }

          if (recipient) {
            const { error: sendError } = await supabase.functions.invoke('send-response', {
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
              toast({
                title: "Warning",
                description: `Message saved but delivery failed: ${sendError.message}`,
                variant: "destructive"
              });
            } else {
              toast({
                title: "Message sent",
                description: `Delivered to ${recipient}`,
              });
            }
          } else {
            toast({
              title: "Warning",
              description: "Message saved but no recipient contact found",
              variant: "destructive"
            });
          }
        }
      } catch (error: any) {
        toast({
          title: "Warning",
          description: "Message saved but delivery may have failed",
          variant: "destructive"
        });
      }
    }

    // Update conversation status
    if (!isInternal) {
      await supabase
        .from('conversations')
        .update({ 
          updated_at: new Date().toISOString(),
          status: 'waiting_customer',
          first_response_at: conversation.first_response_at || new Date().toISOString()
        })
        .eq('id', conversation.id);
    }

    localStorage.removeItem(`draft-${conversation.id}`);
    
    if (!isInternal) {
      toast({
        title: "Reply sent",
        description: "Your message has been sent",
      });
    }
    
    onUpdate();
  };

  const isOverdue = conversation.sla_due_at && new Date(conversation.sla_due_at) < new Date();
  const getSentimentEmoji = (sentiment: string | null) => {
    switch (sentiment) {
      case 'positive': return '😊';
      case 'negative': return '😟';
      case 'neutral': return '😐';
      default: return '❓';
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* iOS-Style Header */}
      <div className="flex-shrink-0 bg-background/95 backdrop-blur-sm border-b border-border/40 sticky top-0 z-30 animate-fade-in">
        <div className="flex items-center justify-between px-4 h-14">
          <h1 className="flex-1 font-medium text-base truncate">
            {conversation.title || 'Conversation'}
          </h1>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="p-0 h-auto hover:bg-transparent -mr-2">
                <MoreVertical className="h-5 w-5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-xl shadow-lg border-border/50">
              <DropdownMenuItem onClick={() => setSnoozeDialogOpen(true)} className="rounded-lg">
                Snooze
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleResolve} className="rounded-lg">
                Resolve
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-lg">
                View customer details
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Status badges below header */}
        <div className="px-4 pb-2 flex flex-wrap gap-1.5">
          <Badge variant="outline" className="capitalize text-[10px] h-5 px-2">
            {conversation.channel}
          </Badge>
          {conversation.priority && (
            <Badge
              variant={
                conversation.priority === 'high'
                  ? 'destructive'
                  : conversation.priority === 'medium'
                  ? 'secondary'
                  : 'outline'
              }
              className="uppercase text-[10px] h-5 px-2"
            >
              {conversation.priority}
            </Badge>
          )}
          {isOverdue && (
            <Badge variant="destructive" className="text-[10px] h-5 px-2">
              OVERDUE
            </Badge>
          )}
          {(conversation.metadata as any)?.is_vip && (
            <Badge className="bg-amber-500 text-white text-[10px] h-5 px-2">
              VIP
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] h-5 px-2">
            {Math.round((conversation.ai_confidence || 0) * 100)}%
          </Badge>
          <Badge variant="outline" className="text-[10px] h-5 px-2">
            {getSentimentEmoji(conversation.ai_sentiment)} {conversation.ai_sentiment || 'Unknown'}
          </Badge>
          <Badge variant="outline" className="capitalize text-[10px] h-5 px-2">
            📂 {conversation.category || 'General'}
          </Badge>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto pb-4">
        {/* AI Context Panel - Same as desktop/tablet */}
        <div className="px-3">
          <AIContextPanel 
            conversation={conversation} 
            onUpdate={onUpdate}
            onUseDraft={setDraftText}
          />
        </div>

        {/* Message Timeline - Same as desktop/tablet */}
        <div className="px-3 mt-4">
          <MessageTimeline messages={messages} />
        </div>

        {/* Bottom spacing for composer */}
        <div className="h-32" />
      </div>

      {/* Reply Area - Same as desktop/tablet, with scroll-hide wrapper */}
      <div
        className={cn(
          "transition-transform duration-200 ease-out",
          scrollState.isHidden && !scrollState.isAtTop ? "translate-y-full" : "translate-y-0"
        )}
      >
        <ReplyArea
          conversationId={conversation.id}
          channel={conversation.channel}
          aiDraftResponse={conversation.metadata?.ai_draft_response as string}
          onSend={handleReply}
          externalDraftText={draftText}
          onDraftTextCleared={() => setDraftText('')}
          onDraftChange={(text) => {
            if (text) {
              localStorage.setItem(`draft-${conversation.id}`, text);
            }
          }}
        />
      </div>

      {/* Snooze Dialog */}
      <SnoozeDialog
        conversationId={conversation.id}
        open={snoozeDialogOpen}
        onOpenChange={setSnoozeDialogOpen}
        onSuccess={onUpdate}
      />
    </div>
  );
};
