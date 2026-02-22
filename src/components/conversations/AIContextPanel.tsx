import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface AIContextPanelProps {
  conversation: Conversation;
  onUpdate?: () => void;
  onUseDraft?: (draft: string) => void;
}

export const AIContextPanel = ({ conversation, onUpdate, onUseDraft }: AIContextPanelProps) => {

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
    <div>
      {/* Whisper-style AI Briefing — borderless, soft tint */}
      <div className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-xl",
        bucketContext.color === 'destructive' && "bg-destructive/5",
        bucketContext.color === 'amber' && "bg-amber-50/50 dark:bg-amber-500/5",
        bucketContext.color === 'green' && "bg-green-50/50 dark:bg-green-500/5",
        bucketContext.color === 'blue' && "bg-blue-50/50 dark:bg-blue-500/5",
        bucketContext.color === 'primary' && "bg-slate-50 dark:bg-slate-500/5"
      )}>
        <span className="text-base flex-shrink-0 mt-0.5">✨</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">AI Briefing</span>
            {sentimentBadge}
          </div>
          <p className="text-sm text-foreground/70 leading-relaxed">{briefingText}</p>
        </div>
      </div>
    </div>
  );
};
