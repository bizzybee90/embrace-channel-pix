import { Conversation } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lightbulb, AlertTriangle, BarChart3, FolderOpen, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface AIContextPanelProps {
  conversation: Conversation;
}

export const AIContextPanel = ({ conversation }: AIContextPanelProps) => {
  const [isOpen, setIsOpen] = useState(true);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const escalatedAt = conversation.created_at 
    ? formatDistanceToNow(new Date(conversation.created_at), { addSuffix: true })
    : null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="bg-primary/5 border-primary/20">
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
              <div className="bg-urgent/10 border border-urgent/30 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-urgent" />
                  <span className="text-sm font-semibold text-urgent">Why AI Escalated</span>
                  {escalatedAt && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {escalatedAt}
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground">
                  {conversation.ai_reason_for_escalation}
                </p>
                
                {/* Feedback buttons */}
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
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
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <Lightbulb className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <h3 className="font-semibold text-sm">AI Draft Response</h3>
                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {conversation.metadata.ai_draft_response}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This draft will be available in the reply area below
                    </p>
                  </div>
                </div>
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
