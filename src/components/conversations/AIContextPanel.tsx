import { Conversation } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, FileText, Sparkles, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useIsMobile } from '@/hooks/use-mobile';

interface AIContextPanelProps {
  conversation: Conversation;
  onUpdate?: () => void;
  onUseDraft?: (draft: string) => void;
}

export const AIContextPanel = ({ conversation, onUpdate, onUseDraft }: AIContextPanelProps) => {
  const [draftUsed, setDraftUsed] = useState(false);
  const [isEscalationOpen, setIsEscalationOpen] = useState(true);
  const [isSummaryOpen, setIsSummaryOpen] = useState(true);
  const [isDraftOpen, setIsDraftOpen] = useState(true);
  const isMobile = useIsMobile();

  const aiDraftResponse = conversation.metadata?.ai_draft_response as string | undefined;

  // Shared header classes for consistent iOS-style rows
  const PANEL_HEADER_CLASSES = "flex items-center justify-between w-full px-4 py-3 gap-3 min-h-[56px]";

  const handleUseDraft = () => {
    if (!aiDraftResponse) return;
    onUseDraft?.(aiDraftResponse);
    setDraftUsed(true);
    toast.success('Draft loaded into reply box');
  };

  const getSentimentEmoji = (sentiment: string | null) => {
    switch (sentiment) {
      case 'positive': return '😊';
      case 'negative': return '😟';
      case 'neutral': return '😐';
      default: return '❓';
    }
  };

  return (
    <div className="space-y-3 md:space-y-4 mobile-section-spacing">
      {/* Why AI Escalated */}
      <Collapsible open={isEscalationOpen} onOpenChange={setIsEscalationOpen}>
        <Card className="card-elevation bg-destructive/5 border-destructive/20 mobile-native-card overflow-hidden">
          <CollapsibleTrigger className={PANEL_HEADER_CLASSES}>
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
            <div className="flex-1 text-left">
              <h3 className="font-semibold text-sm">Why AI Escalated</h3>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isEscalationOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {conversation.ai_reason_for_escalation || 'No escalation reason provided'}
              </p>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* AI Summary */}
      <Collapsible open={isSummaryOpen} onOpenChange={setIsSummaryOpen}>
        <Card className="card-elevation mobile-native-card bg-primary/5 border-primary/20 overflow-hidden">
          <CollapsibleTrigger className={PANEL_HEADER_CLASSES}>
            <FileText className="h-5 w-5 text-primary flex-shrink-0" />
            <div className="flex-1 text-left">
              <h3 className="font-semibold text-sm">Summary</h3>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isSummaryOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4">
              <p className="text-sm text-foreground/80 leading-relaxed">
                {conversation.summary_for_human || 'No summary available'}
              </p>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* AI Draft Response */}
      {aiDraftResponse && (
        <Collapsible open={isDraftOpen} onOpenChange={setIsDraftOpen}>
          <Card className="relative overflow-hidden apple-shadow-lg border-0 rounded-[22px] md:rounded-[22px] rounded-[18px] bg-gradient-to-br from-blue-500/15 via-blue-400/10 to-purple-500/15 animate-fade-in">
            {/* Glow effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-transparent to-purple-500/20 blur-2xl" />
            
            <CollapsibleTrigger className={`${PANEL_HEADER_CLASSES} relative`}>
              <div className="h-9 w-9 rounded-[16px] bg-gradient-to-br from-blue-500/20 to-purple-500/15 flex items-center justify-center spring-bounce backdrop-blur-sm border border-blue-500/20 flex-shrink-0">
                <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-pulse" style={{ animationDuration: '2s' }} />
              </div>
              <div className="flex-1 text-left">
                <h3 className="font-bold text-sm text-foreground">AI Suggested Reply</h3>
                <p className="text-xs text-muted-foreground">Ready to send</p>
              </div>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isDraftOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
            
            <CollapsibleContent>
              <div className="relative px-4 pb-4">
                <div className="bg-background/90 backdrop-blur-sm rounded-[16px] p-3 mb-3 border border-border/30 apple-shadow-sm">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground">{aiDraftResponse}</p>
                </div>

                <Button
                  onClick={handleUseDraft}
                  disabled={draftUsed}
                  variant={draftUsed ? "outline" : "default"}
                  size="sm"
                  className="w-full smooth-transition spring-press rounded-[16px] h-10 font-semibold apple-shadow bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 border-0"
                >
                  {draftUsed ? '✓ Draft Used' : '✨ Use This Draft'}
                </Button>
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Metadata - Hidden on mobile */}
      {!isMobile && (
        <div className="grid grid-cols-3 gap-2 md:gap-2">
          <Card className="p-3 md:p-3 text-center card-elevation mobile-native-card mobile-spring-bounce">
            <div className="text-2xl md:text-2xl font-bold text-primary">{Math.round((conversation.ai_confidence || 0) * 100)}%</div>
            <div className="text-xs text-muted-foreground mt-1">Confidence</div>
          </Card>
          
          <Card className="p-3 md:p-3 text-center card-elevation mobile-native-card mobile-spring-bounce">
            <div className="text-2xl md:text-2xl">{getSentimentEmoji(conversation.ai_sentiment)}</div>
            <div className="text-xs text-muted-foreground mt-1 capitalize">{conversation.ai_sentiment || 'Unknown'}</div>
          </Card>
          
          <Card className="p-3 md:p-3 text-center card-elevation mobile-native-card mobile-spring-bounce">
            <div className="text-2xl md:text-2xl">📂</div>
            <div className="text-xs text-muted-foreground mt-1 capitalize">{conversation.category || 'General'}</div>
          </Card>
        </div>
      )}
    </div>
  );
};