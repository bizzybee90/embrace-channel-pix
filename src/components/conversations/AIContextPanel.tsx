import { Conversation } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, FileText, Sparkles, ChevronDown, User } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { CustomerIntelligence } from '@/components/customers/CustomerIntelligence';

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

  // Fix: Read from both locations - AI agent writes to ai_draft_response directly
  const aiDraftResponse = (conversation as any).ai_draft_response as string | undefined || 
                          conversation.metadata?.ai_draft_response as string | undefined;

// Shared header classes for consistent iOS-style rows
const PANEL_HEADER_CLASSES = "flex items-center justify-between w-full px-4 gap-3 h-14";

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

  // Dynamic title and color based on decision bucket
  const getBucketContext = () => {
    const bucket = (conversation as any).decision_bucket;
    const whyText = (conversation as any).why_this_needs_you || conversation.ai_reason_for_escalation || conversation.summary_for_human;
    
    switch (bucket) {
      case 'act_now':
        return { title: 'Why This Needs You', color: 'destructive', icon: AlertCircle, emoji: '🔴', why: whyText || 'Urgent attention required' };
      case 'quick_win':
        return { title: 'Why This Is Quick', color: 'amber', icon: Sparkles, emoji: '🟡', why: whyText || 'Simple response needed' };
      case 'auto_handled':
        return { title: 'Why This Was Handled', color: 'green', icon: FileText, emoji: '🟢', why: whyText || 'No action needed' };
      case 'wait':
        return { title: 'Why This Can Wait', color: 'blue', icon: FileText, emoji: '🔵', why: whyText || 'Deferred for later' };
      default:
        return { title: 'Analyzing...', color: 'primary', icon: AlertCircle, emoji: '⏳', why: whyText || conversation.ai_reason_for_escalation || 'AI is processing this conversation. Refresh in a moment.' };
    }
  };

  const bucketContext = getBucketContext();

  return (
    <div className="space-y-3 md:space-y-4 mobile-section-spacing">
      {/* Dynamic Why Panel - Based on Decision Bucket */}
      <Collapsible open={isEscalationOpen} onOpenChange={setIsEscalationOpen}>
        <Card className={cn("card-elevation overflow-hidden", 
          bucketContext.color === 'destructive' && "bg-destructive/5 border-destructive/20",
          bucketContext.color === 'amber' && "bg-amber-500/5 border-amber-500/20",
          bucketContext.color === 'green' && "bg-green-500/5 border-green-500/20",
          bucketContext.color === 'blue' && "bg-blue-500/5 border-blue-500/20",
          bucketContext.color === 'primary' && "bg-primary/5 border-primary/20"
        )}>
          <CollapsibleTrigger className={PANEL_HEADER_CLASSES}>
            <div className="flex items-center gap-3">
              <span className="text-lg">{bucketContext.emoji}</span>
              <span className="text-sm font-medium text-foreground">
                {bucketContext.title}
              </span>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                isEscalationOpen && "rotate-180"
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4">
              <p className="text-sm text-foreground/80 leading-relaxed font-medium">
                {bucketContext.why}
              </p>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* AI Summary */}
      <Collapsible open={isSummaryOpen} onOpenChange={setIsSummaryOpen}>
        <Card className="card-elevation bg-primary/5 border-primary/20 overflow-hidden">
          <CollapsibleTrigger className={PANEL_HEADER_CLASSES}>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <FileText className="h-4 w-4" />
              </div>
              <span className="text-sm font-medium text-foreground">
                Summary
              </span>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                isSummaryOpen && "rotate-180"
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4">
              <p className="text-sm text-foreground/80 leading-relaxed">
                {conversation.summary_for_human || (() => {
                  const createdAt = conversation.created_at ? new Date(conversation.created_at) : null;
                  const ageMinutes = createdAt ? (Date.now() - createdAt.getTime()) / 60000 : Infinity;
                  return ageMinutes < 10 ? 'Summary being generated...' : 'No summary available';
                })()}
              </p>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* AI Draft Response - Only show if reply is needed */}
      {(() => {
        const requiresReply = (conversation as any).requires_reply !== false;
        const decisionBucket = (conversation as any).decision_bucket;
        const shouldShowDraft = requiresReply && 
                                decisionBucket !== 'auto_handled' && 
                                decisionBucket !== 'wait';

        if (!shouldShowDraft && (decisionBucket === 'auto_handled' || !requiresReply)) {
          return (
            <Card className="p-4 bg-green-500/5 border-green-500/20">
              <div className="flex items-center gap-3 text-green-600 dark:text-green-400">
                <FileText className="h-5 w-5" />
                <div>
                  <p className="text-sm font-medium">No Reply Needed</p>
                  <p className="text-xs mt-1 text-muted-foreground">This email was auto-handled</p>
                </div>
              </div>
            </Card>
          );
        }

        if (aiDraftResponse) {
          return (
            <Collapsible open={isDraftOpen} onOpenChange={setIsDraftOpen}>
              <Card className="relative overflow-hidden apple-shadow-lg border-0 rounded-[22px] md:rounded-[22px] rounded-[18px] bg-gradient-to-br from-blue-500/15 via-blue-400/10 to-purple-500/15 animate-fade-in">
                {/* Glow effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-transparent to-purple-500/20 blur-2xl" />
                
                <CollapsibleTrigger className={`${PANEL_HEADER_CLASSES} relative`}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-500/10 text-indigo-500">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      AI Suggested Reply
                    </span>
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      isDraftOpen && "rotate-180"
                    )}
                  />
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
          );
        }

        return (
          <Card className="p-4 bg-muted/30 border-muted">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Sparkles className="h-5 w-5" />
              <div>
                <p className="text-sm font-medium">No AI Suggestion Available</p>
                <p className="text-xs mt-1">AI may not have processed this conversation yet</p>
              </div>
            </div>
          </Card>
        );
      })()}

      {/* Customer Intelligence - Stage 3 */}
      {conversation.customer_id && conversation.workspace_id && (
        <Collapsible>
          <Card className="card-elevation overflow-hidden">
            <CollapsibleTrigger className={PANEL_HEADER_CLASSES}>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10 text-blue-500">
                  <User className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-foreground">
                  Customer Profile
                </span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform ui-open:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4">
                <CustomerIntelligence 
                  workspaceId={conversation.workspace_id} 
                  customerId={conversation.customer_id} 
                />
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}
    </div>
  );
};