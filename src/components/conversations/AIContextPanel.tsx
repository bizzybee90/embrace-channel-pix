import { Conversation } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Lightbulb, AlertTriangle, BarChart3, FolderOpen } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface AIContextPanelProps {
  conversation: Conversation;
}

export const AIContextPanel = ({ conversation }: AIContextPanelProps) => {
  const [isOpen, setIsOpen] = useState(true);

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
          <div className="p-4 pt-0 space-y-3">
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

            {conversation.ai_reason_for_escalation && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Why Escalated</span>
                </div>
                <p className="text-sm text-foreground/80 pl-6">
                  {conversation.ai_reason_for_escalation}
                </p>
              </div>
            )}

            <div className="flex items-center gap-4 pl-6">
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
