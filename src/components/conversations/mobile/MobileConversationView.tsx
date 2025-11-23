import { useState, useEffect } from 'react';
import { ChevronLeft, Send, CheckCircle2, MoreVertical, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Conversation, Message } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MessageTimeline } from '@/components/conversations/MessageTimeline';
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
  const [aiInsightsExpanded, setAiInsightsExpanded] = useState(false);
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
      {/* iOS-Style Header - Simple back arrow */}
      <div className="flex-shrink-0 bg-background/95 backdrop-blur-sm border-b border-border/40 sticky top-0 z-30 animate-fade-in">
        <div className="flex items-center justify-between px-4 h-14">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="p-0 h-auto hover:bg-transparent -ml-2"
          >
            <ChevronLeft className="h-7 w-7 text-primary" />
          </Button>
          
          <h1 className="flex-1 text-center font-medium text-base truncate px-4">
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
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* AI Insights Card - iOS-style, minimal */}
        {conversation.ai_reason_for_escalation && (
          <div className="px-4 pt-2 pb-3">
            <div className="bg-gradient-to-br from-blue-50/50 to-purple-50/50 dark:from-blue-950/20 dark:to-purple-950/20 rounded-[20px] overflow-hidden">
              <button
                onClick={() => setAiInsightsExpanded(!aiInsightsExpanded)}
                className="w-full px-3.5 py-3 flex items-start gap-3 text-left active:bg-black/5 dark:active:bg-white/5 transition-colors"
              >
                <span className="text-xl flex-shrink-0 leading-none mt-0.5">
                  {getSentimentEmoji(conversation.ai_sentiment)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-foreground">AI Insights</span>
                    <div className="flex items-center gap-1.5">
                      {conversation.ai_confidence && (
                        <span className="text-[10px] text-muted-foreground font-medium">
                          {Math.round(conversation.ai_confidence * 100)}%
                        </span>
                      )}
                      {aiInsightsExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-180" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-180" />
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-1">
                    {conversation.ai_reason_for_escalation}
                  </p>
                </div>
              </button>

              {/* Expanded Details */}
              <div
                className={cn(
                  "overflow-hidden transition-all duration-180 ease-out",
                  aiInsightsExpanded ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
                )}
              >
                <div className="px-3.5 pb-3 space-y-2.5 border-t border-border/20 pt-2.5">
                  {conversation.summary_for_human && (
                    <div>
                      <h4 className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                        Summary
                      </h4>
                      <p className="text-xs text-foreground leading-relaxed">
                        {conversation.summary_for_human}
                      </p>
                    </div>
                  )}

                  {conversation.ai_sentiment && (
                    <div>
                      <h4 className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                        Sentiment
                      </h4>
                      <p className="text-xs text-foreground capitalize">
                        {conversation.ai_sentiment}
                      </p>
                    </div>
                  )}

                  {conversation.category && (
                    <div>
                      <h4 className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                        Category
                      </h4>
                      <Badge variant="secondary" className="text-[10px] h-5">
                        {conversation.category}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Conversation Thread */}
        <div className="px-4 py-2">
          <h3 className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Conversation
          </h3>
          <MessageTimeline messages={messages} />
        </div>

        {/* Bottom spacing for composer */}
        <div className="h-32" />
      </div>

      {/* iOS-Style Composer - Auto-hide on scroll */}
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 bg-background/98 backdrop-blur-sm border-t border-border/30 shadow-[0_-4px_20px_rgba(0,0,0,0.04)] transition-transform duration-200 ease-out",
          scrollState.isHidden && !scrollState.isAtTop ? "translate-y-full" : "translate-y-0"
        )}
      >
        <div className="px-4 pt-2.5 pb-6">
          {/* Segmented Control - iOS Style */}
          <div className="flex items-center justify-center mb-2.5">
            <div className="inline-flex items-center bg-muted/50 rounded-full p-0.5">
              <button
                onClick={() => setIsInternal(false)}
                className={cn(
                  "px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-150",
                  !isInternal
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground"
                )}
              >
                Reply
              </button>
              <button
                onClick={() => setIsInternal(true)}
                className={cn(
                  "px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-150",
                  isInternal
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground"
                )}
              >
                Note
              </button>
            </div>
          </div>

          {/* Input with Send Button */}
          <div className="flex items-end gap-2">
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
              placeholder={isInternal ? "Add internal note…" : "Type your reply…"}
              className="flex-1 min-h-[44px] max-h-32 resize-none rounded-[22px] border-border/50 bg-muted/30 px-4 py-3 text-sm placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-primary/50 shadow-sm"
              disabled={isSending}
            />
            <Button
              onClick={handleSendReply}
              disabled={!replyText.trim() || isSending}
              size="icon"
              className="h-11 w-11 rounded-full bg-primary hover:bg-primary/90 shadow-md flex-shrink-0 active:scale-95 transition-transform"
            >
              <Send className="h-5 w-5" />
            </Button>
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
