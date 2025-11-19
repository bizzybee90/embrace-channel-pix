import { useState } from 'react';
import { ArrowLeft, Send, Sparkles, User, TrendingUp, AlertCircle } from 'lucide-react';
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
  const [replyText, setReplyText] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showSuggestedReply, setShowSuggestedReply] = useState(false);
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
          {/* Hero Card - Title & Quick Actions */}
          <Card className="rounded-[28px] p-6 bg-gradient-to-br from-card to-card/50 border-border/50 shadow-sm">
            <h1 className="text-[22px] font-bold text-foreground leading-snug mb-4">
              {conversation.title || 'Untitled Conversation'}
            </h1>

            {/* Status Pills */}
            <div className="flex items-center gap-2 mb-6 flex-wrap">
              <div className="flex items-center gap-2 px-3 h-8 rounded-full bg-background/80">
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

            {/* Primary Action */}
            <Button
              onClick={handleResolve}
              className="w-full h-12 rounded-full text-[15px] font-semibold shadow-md hover:shadow-lg transition-all active:scale-[0.98]"
            >
              Resolve & Close
            </Button>
          </Card>

          {/* AI Insights Card */}
          {conversation.ai_reason_for_escalation && (
            <Card className="rounded-[28px] p-6 bg-primary/5 border-primary/10 shadow-sm">
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

              {/* Summary */}
              {conversation.summary_for_human && (
                <div className="mb-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    Summary
                  </p>
                  <p className="text-[15px] text-foreground leading-relaxed">
                    {conversation.summary_for_human}
                  </p>
                </div>
              )}

              {/* Suggested Reply */}
              <Collapsible open={showSuggestedReply} onOpenChange={setShowSuggestedReply}>
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between py-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Suggested Reply
                    </p>
                    <span className="text-[13px] text-primary font-medium">
                      {showSuggestedReply ? 'Hide' : 'Show'}
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

          {/* Customer Details Card */}
          {conversation.customer_id && (
            <Card className="rounded-[28px] p-6 bg-card border-border/50 shadow-sm">
              <div className="flex items-center gap-4 mb-4">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                    <User className="h-6 w-6" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <h3 className="text-[17px] font-semibold text-foreground">Customer</h3>
                  <Badge variant="secondary" className="rounded-full text-[11px] h-6 px-2 mt-1">
                    VIP
                  </Badge>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted-foreground">Channel</span>
                  <span className="text-foreground font-medium capitalize">{conversation.channel}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted-foreground">Customer since</span>
                  <span className="text-foreground font-medium">2 years ago</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted-foreground">Last issue</span>
                  <span className="text-foreground font-medium">3 months ago</span>
                </div>
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

        {/* Bottom padding for fixed composer */}
        <div className="h-48" />
      </div>

      {/* Fixed Reply Composer */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-xl border-t border-border p-4 shadow-lg">
        {/* Reply Type Toggle */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setIsInternal(false)}
            className={`flex-1 h-9 rounded-full text-[13px] font-semibold transition-all ${
              !isInternal
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted/50 text-muted-foreground'
            }`}
          >
            Reply to Customer
          </button>
          <button
            onClick={() => setIsInternal(true)}
            className={`flex-1 h-9 rounded-full text-[13px] font-semibold transition-all ${
              isInternal
                ? 'bg-yellow-500/20 text-yellow-900 dark:text-yellow-100 border border-yellow-500/30'
                : 'bg-muted/50 text-muted-foreground'
            }`}
          >
            Internal Note
          </button>
        </div>

        {/* Input Field */}
        <div className="flex gap-2">
          <Textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder={isInternal ? 'Add an internal note...' : 'Type your reply...'}
            className={`flex-1 min-h-[44px] max-h-24 rounded-2xl resize-none ${
              isInternal ? 'bg-yellow-500/5 border-yellow-500/20' : ''
            }`}
          />
          <Button
            onClick={handleSendReply}
            disabled={!replyText.trim() || isSending}
            className="h-11 w-11 rounded-full p-0 flex-shrink-0 shadow-md active:scale-95 transition-all"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
};
