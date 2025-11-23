import { useState } from 'react';
import { ArrowLeft, Send, CheckCircle2, AlertCircle, FileText, Sparkles, Calendar, Clock, User, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Conversation, Message } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { MessageTimeline } from '@/components/conversations/MessageTimeline';
import { formatDistanceToNow } from 'date-fns';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { SnoozeDialog } from '@/components/conversations/SnoozeDialog';

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
  const [showActions, setShowActions] = useState(false);
  const [snoozeDialogOpen, setSnoozeDialogOpen] = useState(false);
  const { toast } = useToast();

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
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-full hover:bg-muted/50 active:scale-95 transition-all"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold text-foreground truncate">
              {conversation.title || 'Conversation'}
            </h2>
            <p className="text-[13px] text-muted-foreground">
              {isOverdue ? 'Overdue' : conversation.created_at && formatDistanceToNow(new Date(conversation.created_at), { addSuffix: true })}
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-6 space-y-6">
          {/* Status Pills */}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 px-3 h-8 rounded-full bg-muted/50">
              <ChannelIcon channel={conversation.channel} className="h-3.5 w-3.5" />
              <span className="text-[12px] font-semibold capitalize">{conversation.channel}</span>
            </div>

            <Badge
              variant={
                conversation.priority === 'high'
                  ? 'destructive'
                  : conversation.priority === 'medium'
                  ? 'secondary'
                  : 'outline'
              }
              className="rounded-full text-[11px] font-semibold h-8 px-3 uppercase"
            >
              {conversation.priority || 'Medium'}
            </Badge>

            {isOverdue && (
              <Badge variant="destructive" className="rounded-full text-[11px] font-semibold h-8 px-3 uppercase">
                <AlertCircle className="h-3 w-3 mr-1" />
                Overdue
              </Badge>
            )}
          </div>

          {/* AI Insights Card */}
          {conversation.ai_reason_for_escalation && (
            <Card className="rounded-[28px] p-6 bg-gradient-to-br from-primary/10 via-primary/5 to-background border-primary/20 shadow-lg shadow-primary/10 animate-fade-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="text-[15px] font-semibold text-foreground">AI Insights</h3>
                  {conversation.ai_confidence && (
                    <p className="text-[12px] text-muted-foreground">
                      {Math.round(conversation.ai_confidence * 100)}% confident
                    </p>
                  )}
                </div>
              </div>

              {/* Why Escalated */}
              <div className="mb-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Why Escalated
                </p>
                <p className="text-[15px] text-foreground leading-relaxed">
                  {conversation.ai_reason_for_escalation}
                </p>
              </div>

              {/* AI Draft - Collapsible */}
              <Collapsible open={aiDraftOpen} onOpenChange={setAiDraftOpen}>
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between py-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      AI Draft
                    </p>
                    <span className="text-[13px] text-primary font-medium">
                      {aiDraftOpen ? 'Hide' : 'Show'}
                    </span>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-2xl bg-background/60 p-4 mt-2">
                    <p className="text-[15px] text-foreground leading-relaxed">
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
                    className="mt-2 w-full rounded-full text-[13px] h-9 font-semibold shadow-sm"
                  >
                    Use this draft
                  </Button>
                </CollapsibleContent>
              </Collapsible>

              {/* Suggested Strategy - Collapsible */}
              <Collapsible open={suggestedStrategyOpen} onOpenChange={setSuggestedStrategyOpen}>
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between py-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Suggested Strategy
                    </p>
                    <span className="text-[13px] text-primary font-medium">
                      {suggestedStrategyOpen ? 'Hide' : 'Show'}
                    </span>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-2xl bg-background/60 p-4 mt-2">
                    <p className="text-[15px] text-foreground leading-relaxed">
                      Based on the conversation, I recommend acknowledging their concern and offering a specific solution timeline.
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Tags */}
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                {conversation.ai_sentiment && (
                  <Badge variant="outline" className="rounded-full text-[11px] h-7 px-3">
                    {getSentimentEmoji(conversation.ai_sentiment)} {conversation.ai_sentiment}
                  </Badge>
                )}
                {conversation.category && (
                  <Badge variant="outline" className="rounded-full text-[11px] h-7 px-3 capitalize">
                    {conversation.category}
                  </Badge>
                )}
              </div>
            </Card>
          )}


          {/* Conversation Timeline */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-4 px-2">
              Conversation
            </h3>
            <MessageTimeline messages={messages} />
          </div>
        </div>

        {/* Bottom padding for fixed composer - extra space for keyboard */}
        <div className="h-96" />
      </div>

      {/* Fixed Reply Composer with Actions */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-xl border-t border-border shadow-lg">
        {/* Action Menu */}
        {showActions && (
          <div className="px-4 pt-4 pb-2 border-b border-border/50 space-y-3 animate-fade-in max-h-[70vh] overflow-y-auto">
            {/* Customer Details Section */}
            {conversation.customer_id && (
              <div className="rounded-2xl bg-muted/30 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <h4 className="text-[13px] font-bold uppercase tracking-wider text-muted-foreground">
                    Customer Details
                  </h4>
                </div>
                <div className="space-y-2">
                  <div>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Name</p>
                    <p className="text-[15px] font-medium">Customer Name</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Tier</p>
                      <Badge variant="secondary" className="rounded-full text-[11px]">VIP</Badge>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Channel</p>
                      <div className="flex items-center gap-1.5">
                        <ChannelIcon channel={conversation.channel} className="h-3.5 w-3.5" />
                        <span className="text-[13px] capitalize">{conversation.channel}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Actions */}
            <Button
              onClick={() => {
                setSnoozeDialogOpen(true);
                setShowActions(false);
              }}
              variant="outline"
              className="w-full h-12 rounded-full text-[15px] font-semibold"
            >
              <Clock className="h-4 w-4 mr-2" />
              Snooze
            </Button>
            
            <Button
              onClick={handleResolve}
              className="w-full h-12 rounded-full text-[15px] font-semibold shadow-md hover:shadow-lg transition-all active:scale-[0.98]"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Resolve & Close
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="rounded-full text-[13px] h-10"
              >
                Assign to me
              </Button>
              <Button
                variant="outline"
                className="rounded-full text-[13px] h-10"
              >
                Change status
              </Button>
            </div>
          </div>
        )}

        <div className="p-4">
          {/* Reply Type Toggle */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setIsInternal(false)}
              className={`flex-1 h-9 rounded-full text-[13px] font-medium transition-all ${
                !isInternal
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/50 text-muted-foreground'
              }`}
            >
              Reply to Customer
            </button>
            <button
              onClick={() => setIsInternal(true)}
              className={`flex-1 h-9 rounded-full text-[13px] font-medium transition-all ${
                isInternal
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/50 text-muted-foreground'
              }`}
            >
              <FileText className="h-3.5 w-3.5 inline mr-1" />
              Internal Note
            </button>
          </div>

          {/* Message Input with Actions Button */}
          <div className="flex items-end gap-2">
            <button
              onClick={() => setShowActions(!showActions)}
              className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                showActions ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
              }`}
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            
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
              placeholder={isInternal ? "Add an internal note..." : "Type your reply..."}
              className="min-h-[44px] max-h-32 rounded-[22px] resize-none text-[15px] px-4 py-3"
            />

            <button
              onClick={handleSendReply}
              disabled={!replyText.trim() || isSending}
              className="flex-shrink-0 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:shadow-md transition-all active:scale-95"
            >
              <Send className="h-5 w-5" />
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
