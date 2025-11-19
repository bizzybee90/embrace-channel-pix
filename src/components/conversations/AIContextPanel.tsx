import { Conversation } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lightbulb, AlertTriangle, BarChart3, FolderOpen, ThumbsUp, ThumbsDown, Send, ChevronDown, ChevronUp } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface AIContextPanelProps {
  conversation: Conversation;
  onUpdate?: () => void;
}

export const AIContextPanel = ({ conversation, onUpdate }: AIContextPanelProps) => {
  const [isOpen, setIsOpen] = useState(true);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isDraftExpanded, setIsDraftExpanded] = useState(false);

  const escalatedAt = conversation.created_at 
    ? formatDistanceToNow(new Date(conversation.created_at), { addSuffix: true })
    : null;

  const handleSendDraft = async () => {
    if (!conversation.metadata?.ai_draft_response) return;
    
    setIsSending(true);
    try {
      // Create the outbound message
      const { error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          body: conversation.metadata.ai_draft_response,
          channel: conversation.channel,
          direction: 'outbound',
          actor_type: 'agent',
        });

      if (error) throw error;

      toast.success('AI draft sent successfully');
      onUpdate?.();
    } catch (error) {
      console.error('Error sending AI draft:', error);
      toast.error('Failed to send AI draft');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="bg-primary/5 border-primary/20 card-elevation smooth-transition">
        <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-primary/10 transition-colors">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">AI Context</h3>
          </div>
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="p-4 pt-0 space-y-4">
            {/* Escalation Reason - MOST IMPORTANT */}
            {conversation.ai_reason_for_escalation && (
              <div className="bg-urgent/10 border border-urgent/30 rounded-lg p-3 card-elevation">
                <div className="flex items-center gap-2 mb-1.5">
                  <AlertTriangle className="h-4 w-4 text-urgent" />
                  <span className="text-sm font-semibold text-urgent">Why AI Escalated</span>
                  {escalatedAt && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {escalatedAt}
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground leading-relaxed">
                  {conversation.ai_reason_for_escalation}
                </p>
                
                {/* Feedback buttons */}
                <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-border">
                  <span className="text-xs text-muted-foreground">Was this escalation helpful?</span>
                  <Button
                    variant={feedback === 'up' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setFeedback('up')}
                  >
                    <ThumbsUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant={feedback === 'down' ? 'destructive' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setFeedback('down')}
                  >
                    <ThumbsDown className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}

            {conversation.summary_for_human && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Lightbulb className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Summary</span>
                </div>
                <p className="text-sm text-foreground/80 pl-6">
                  {conversation.summary_for_human}
                </p>
              </div>
            )}

            {/* AI Draft Response */}
            {conversation.metadata?.ai_draft_response && (
              <div className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/30 rounded-lg p-4 card-elevation space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Send className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold text-sm text-primary">AI Suggested Reply</h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsDraftExpanded(!isDraftExpanded)}
                    className="h-7 px-2 hover:bg-primary/20"
                  >
                    {isDraftExpanded ? (
                      <>
                        <ChevronUp className="h-4 w-4 mr-1" />
                        Collapse
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        Expand
                      </>
                    )}
                  </Button>
                </div>
                <Collapsible open={isDraftExpanded}>
                  <CollapsibleContent>
                    <div className="space-y-3">
                      <div className="bg-background/60 border border-primary/20 rounded-md p-3">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {conversation.metadata.ai_draft_response}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleSendDraft}
                        disabled={isSending}
                        className="w-full hover:scale-105 transition-transform"
                      >
                        <Send className="h-3 w-3 mr-2" />
                        {isSending ? 'Sending...' : 'Send Draft Reply'}
                      </Button>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
                {!isDraftExpanded && (
                  <p className="text-xs text-muted-foreground pl-6 italic">
                    Click "Expand" to view and send the AI-generated response
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center gap-4 pl-6 flex-wrap">
              {conversation.ai_confidence !== null && (
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    Confidence: <strong>{Math.round(conversation.ai_confidence * 100)}%</strong>
                  </span>
                </div>
              )}

              {conversation.ai_sentiment && (
                <div className="flex items-center gap-2">
                  <span className="text-sm">
                    Sentiment: <Badge variant="outline">{conversation.ai_sentiment}</Badge>
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <Badge variant="secondary">{conversation.category}</Badge>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
