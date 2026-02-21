import { Conversation } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, FileText, Sparkles, ChevronDown, User } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { CustomerIntelligence } from '@/components/customers/CustomerIntelligence';

interface AIContextPanelProps {
  conversation: Conversation;
  onUpdate?: () => void;
  onUseDraft?: (draft: string) => void;
}

export const AIContextPanel = ({ conversation, onUpdate, onUseDraft }: AIContextPanelProps) => {
  const [draftUsed, setDraftUsed] = useState(false);
  const [isDraftOpen, setIsDraftOpen] = useState(true);

  const aiDraftResponse = (conversation as any).ai_draft_response as string | undefined || 
                          conversation.metadata?.ai_draft_response as string | undefined;

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
      case 'frustrated': return '😤';
      case 'neutral': return '😐';
      default: return '❓';
    }
  };

  const getSentimentBadge = (sentiment: string | null | undefined) => {
    if (!sentiment) return null;
    const config: Record<string, { label: string; className: string }> = {
      positive: { label: 'Positive', className: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' },
      neutral: { label: 'Neutral', className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20' },
      negative: { label: 'Negative', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
      frustrated: { label: 'Frustrated', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
    };
    const c = config[sentiment];
    if (!c) return null;
    return (
      <Badge variant="outline" className={cn("rounded-full text-[11px] px-2 py-0.5 font-medium", c.className)}>
        {getSentimentEmoji(sentiment)} {c.label}
      </Badge>
    );
  };

  const getBucketContext = () => {
    const bucket = (conversation as any).decision_bucket;
    const whyText = (conversation as any).ai_why_flagged || (conversation as any).why_this_needs_you || conversation.ai_reason_for_escalation || conversation.summary_for_human;
    
    switch (bucket) {
      case 'act_now':
        return { title: 'Why This Needs You', color: 'destructive', emoji: '🔴', why: whyText || 'Urgent attention required' };
      case 'quick_win':
        return { title: 'Why This Is Quick', color: 'amber', emoji: '🟡', why: whyText || 'Simple response needed' };
      case 'auto_handled':
        return { title: 'Why This Was Handled', color: 'green', emoji: '🟢', why: whyText || 'No action needed' };
      case 'wait':
        return { title: 'Why This Can Wait', color: 'blue', emoji: '🔵', why: whyText || 'Deferred for later' };
      default:
        return { title: 'Analyzing...', color: 'primary', emoji: '⏳', why: whyText || 'AI is processing this conversation.' };
    }
  };

  const bucketContext = getBucketContext();
  const briefingText = conversation.summary_for_human || bucketContext.why;
  const sentimentBadge = getSentimentBadge(conversation.ai_sentiment);

  return (
    <div className="space-y-3 md:space-y-4 mobile-section-spacing">
      {/* Consolidated AI Briefing Banner */}
      <div className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-2xl border",
        bucketContext.color === 'destructive' && "bg-destructive/5 border-destructive/20",
        bucketContext.color === 'amber' && "bg-amber-500/5 border-amber-500/20",
        bucketContext.color === 'green' && "bg-green-500/5 border-green-500/20",
        bucketContext.color === 'blue' && "bg-blue-500/5 border-blue-500/20",
        bucketContext.color === 'primary' && "bg-primary/5 border-primary/20"
      )}>
        <span className="text-lg flex-shrink-0 mt-0.5">✨</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wide">AI Briefing</span>
            {sentimentBadge}
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed">{briefingText}</p>
        </div>
      </div>

      {/* AI Draft Response - Only render if draft exists */}
      {aiDraftResponse && (
        <Collapsible open={isDraftOpen} onOpenChange={setIsDraftOpen}>
          <Card className="relative overflow-hidden apple-shadow-lg border-0 rounded-[22px] bg-gradient-to-br from-blue-500/15 via-blue-400/10 to-purple-500/15 animate-fade-in">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-transparent to-purple-500/20 blur-2xl" />
            
            <CollapsibleTrigger className={`${PANEL_HEADER_CLASSES} relative`}>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-500/10 text-indigo-500">
                  <Sparkles className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-foreground">AI Suggested Reply</span>
              </div>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isDraftOpen && "rotate-180")} />
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

      {/* Customer Intelligence */}
      {conversation.customer_id && conversation.workspace_id && (
        <Collapsible>
          <Card className="card-elevation overflow-hidden">
            <CollapsibleTrigger className={PANEL_HEADER_CLASSES}>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10 text-blue-500">
                  <User className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-foreground">Customer Profile</span>
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
