import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Send, CheckCircle2, AlertCircle, Sparkles, Crown, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Conversation, Message } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { MessageTimeline } from '@/components/conversations/MessageTimeline';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SnoozeDialog } from '@/components/conversations/SnoozeDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface MobileConversationViewProps {
  conversation: Conversation;
  messages: Message[];
  onBack: () => void;
  onUpdate: () => void;
}

const getSentimentEmoji = (sentiment: string | null) => {
  switch (sentiment?.toLowerCase()) {
    case 'positive': return '😊';
    case 'negative': return '😔';
    case 'neutral': return '😐';
    case 'frustrated': return '😤';
    case 'urgent': return '🚨';
    default: return '💬';
  }
};

export const MobileConversationView = ({
  conversation,
  messages,
  onBack,
  onUpdate,
}: MobileConversationViewProps) => {
  const [replyText, setReplyText] = useState(() => {
    const saved = localStorage.getItem(`draft-${conversation.id}`);
    return saved || '';
  });
  const [isInternal, setIsInternal] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [aiDraftOpen, setAiDraftOpen] = useState(false);
  const [suggestedStrategyOpen, setSuggestedStrategyOpen] = useState(false);
  const [snoozeDialogOpen, setSnoozeDialogOpen] = useState(false);
  const { toast } = useToast();

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

  const handleSendReply = async () => {
    if (!replyText.trim()) return;

    setIsSending(true);
    const { error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        body: replyText,
        actor_type: 'agent',
        direction: isInternal ? 'internal' : 'outbound',
        channel: conversation.channel,
        is_internal: isInternal,
      });

    if (!error) {
      localStorage.removeItem(`draft-${conversation.id}`);
      setReplyText('');
      toast({ 
        title: isInternal ? "Internal note added" : "Reply sent",
        description: isInternal ? "Your note has been saved" : "Your message is on its way"
      });
      onUpdate();
    }
    setIsSending(false);
  };

  const isOverdue = conversation.sla_due_at && new Date(conversation.sla_due_at) < new Date();

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Sticky Header */}
      <div className="flex-shrink-0 bg-background/95 backdrop-blur-lg border-b border-border sticky top-0 z-30">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 -ml-2 p-2 rounded-lg hover:bg-muted/50 active:scale-95 transition-all"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Back</span>
          </button>
          <div className="flex-1 min-w-0 mx-3">
            <h2 className="text-sm font-semibold text-foreground truncate">
              {conversation.title || 'Conversation'}
            </h2>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setSnoozeDialogOpen(true)}>
                Snooze
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleResolve}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Resolve
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 space-y-4 pb-44">
          {/* Status Pills - compact row */}
          <div className="flex items-center gap-2 flex-wrap pt-3">
            <div className="flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-muted/50">
              <ChannelIcon channel={conversation.channel} className="h-3 w-3" />
              <span className="text-[11px] font-medium capitalize">{conversation.channel}</span>
            </div>

            <Badge
              variant={
                conversation.priority === 'high'
                  ? 'destructive'
                  : conversation.priority === 'medium'
                  ? 'secondary'
                  : 'outline'
              }
              className="rounded-full text-[10px] font-semibold h-7 px-2.5 uppercase"
            >
              {conversation.priority || 'Medium'}
            </Badge>

            {isOverdue && (
              <Badge variant="destructive" className="rounded-full text-[10px] font-semibold h-7 px-2.5 uppercase">
                <AlertCircle className="h-3 w-3 mr-1" />
                Overdue
              </Badge>
            )}
            
            {conversation.customer_id && (
              <Badge variant="secondary" className="rounded-full text-[10px] font-semibold h-7 px-2.5">
                <Crown className="h-3 w-3 mr-1" />
                VIP
              </Badge>
            )}
          </div>

          {/* AI Insights Card - tighter spacing */}
          {conversation.ai_reason_for_escalation && (
            <Card className="rounded-3xl p-5 bg-gradient-to-br from-primary/10 via-primary/5 to-background border-primary/20 shadow-lg shadow-primary/10">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-foreground">AI Insights</h3>
                  {conversation.ai_confidence && (
                    <p className="text-[11px] text-muted-foreground">
                      {Math.round(conversation.ai_confidence * 100)}% confident
                    </p>
                  )}
                </div>
              </div>

              {/* Why Escalated */}
              <div className="mb-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Why Escalated
                </p>
                <p className="text-sm text-foreground leading-relaxed">
                  {conversation.ai_reason_for_escalation}
                </p>
              </div>

              {/* AI Draft - Collapsible */}
              <Collapsible open={aiDraftOpen} onOpenChange={setAiDraftOpen}>
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between py-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      AI Draft
                    </p>
                    <span className="text-xs text-primary font-medium">
                      {aiDraftOpen ? 'Hide' : 'Show'}
                    </span>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-2xl bg-background/60 p-3.5 mt-1.5">
                    <p className="text-sm text-foreground leading-relaxed">
                      Hi there! I completely understand your frustration and I'm here to help. I've looked into this issue and we can get this resolved for you within the next 24 hours. Would you like me to walk you through the solution steps now, or would you prefer we handle it on our end?
                    </p>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => {
                      setReplyText("Hi there! I completely understand your frustration and I'm here to help. I've looked into this issue and we can get this resolved for you within the next 24 hours. Would you like me to walk you through the solution steps now, or would you prefer we handle it on our end?");
                      toast({ title: "Draft copied to reply" });
                    }}
                    className="mt-1.5 w-full rounded-full text-xs h-8 font-semibold"
                  >
                    Use this draft
                  </Button>
                </CollapsibleContent>
              </Collapsible>

              {/* Suggested Strategy - Collapsible */}
              <Collapsible open={suggestedStrategyOpen} onOpenChange={setSuggestedStrategyOpen}>
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between py-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Suggested Strategy
                    </p>
                    <span className="text-xs text-primary font-medium">
                      {suggestedStrategyOpen ? 'Hide' : 'Show'}
                    </span>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-2xl bg-background/60 p-3.5 mt-1.5">
                    <p className="text-sm text-foreground leading-relaxed">
                      Based on the conversation, I recommend acknowledging their concern and offering a specific solution timeline.
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Tags */}
              <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                {conversation.ai_sentiment && (
                  <Badge variant="outline" className="rounded-full text-[10px] h-6 px-2.5">
                    {getSentimentEmoji(conversation.ai_sentiment)} {conversation.ai_sentiment}
                  </Badge>
                )}
                {conversation.category && (
                  <Badge variant="outline" className="rounded-full text-[10px] h-6 px-2.5 capitalize">
                    {conversation.category}
                  </Badge>
                )}
              </div>
            </Card>
          )}

          {/* Conversation Timeline */}
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5">
              Conversation
            </h3>
            <MessageTimeline messages={messages} />
          </div>
        </div>
      </div>

      {/* Fixed Composer - Only sticky element at bottom */}
      <div className="flex-shrink-0 bg-background/95 backdrop-blur-xl border-t border-border shadow-2xl pb-safe">
        <div className="px-4 py-3 space-y-2.5">
          {/* Reply Type Toggle - compact */}
          <div className="flex gap-1.5">
            <button
              onClick={() => setIsInternal(false)}
              className={`px-3 h-7 rounded-full text-[11px] font-medium transition-all ${
                !isInternal
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-muted-foreground'
              }`}
            >
              Reply
            </button>
            <button
              onClick={() => setIsInternal(true)}
              className={`px-3 h-7 rounded-full text-[11px] font-medium transition-all ${
                isInternal
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-muted-foreground'
              }`}
            >
              Note
            </button>
          </div>

          {/* Message Input with Send Button - full width */}
          <div className="relative">
            <Textarea
              value={replyText}
              onChange={(e) => {
                const newValue = e.target.value;
                setReplyText(newValue);
                if (newValue) {
                  localStorage.setItem(`draft-${conversation.id}`, newValue);
                } else {
                  localStorage.removeItem(`draft-${conversation.id}`);
                }
              }}
              placeholder={isInternal ? "Add a note..." : "Type your reply..."}
              className="w-full min-h-[44px] max-h-32 rounded-3xl resize-none text-sm pl-4 pr-12 py-3 border-border"
            />
            <button
              onClick={handleSendReply}
              disabled={!replyText.trim() || isSending}
              className="absolute right-1.5 bottom-1.5 w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:shadow-md transition-all active:scale-95"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
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
