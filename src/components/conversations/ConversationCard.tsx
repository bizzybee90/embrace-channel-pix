import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Clock } from 'lucide-react';
import { ChannelIcon } from '../shared/ChannelIcon';
import { cn } from '@/lib/utils';

interface ConversationCardProps {
  conversation: Conversation;
  selected: boolean;
  onClick: () => void;
}

export const ConversationCard = ({ conversation, selected, onClick }: ConversationCardProps) => {
  const getPriorityVariant = (priority: string | null) => {
    if (!priority) return 'secondary';
    switch (priority.toLowerCase()) {
      case 'urgent': return 'priority-urgent';
      case 'high': return 'priority-high';
      case 'medium': return 'priority-medium';
      case 'low': return 'priority-low';
      default: return 'secondary';
    }
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "p-6 cursor-pointer transition-all duration-300 ease-out rounded-[22px] mb-3",
        "bg-card border border-border/30 hover:border-primary/30",
        "apple-shadow hover:apple-shadow-lg spring-press",
        selected && "border-primary/50 apple-shadow-lg bg-gradient-to-br from-primary/8 via-primary/4 to-card"
      )}
    >
      <div className="flex flex-col gap-3.5">
        {/* Header: Channel + Title */}
        <div className="flex items-start gap-3.5">
          <div className="flex-shrink-0 pt-0.5">
            <ChannelIcon channel={conversation.channel} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg leading-snug mb-2 text-foreground">
              {conversation.title || 'Untitled Conversation'}
            </h3>
            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
              {conversation.summary_for_human || 'No summary available'}
            </p>
          </div>
        </div>
        
        {/* AI Escalation Reason */}
        {conversation.ai_reason_for_escalation && (
          <div className="px-3 py-2 rounded-xl bg-muted/50 border border-border/30">
            <p className="text-xs text-muted-foreground line-clamp-1">
              {conversation.ai_reason_for_escalation}
            </p>
          </div>
        )}
        
        {/* Footer: Badges + Time */}
        <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
          <div className="flex items-center gap-2 flex-wrap">
            {conversation.priority && (
              <Badge 
                variant={getPriorityVariant(conversation.priority)}
                className="rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm"
              >
                {conversation.priority.charAt(0).toUpperCase() + conversation.priority.slice(1)}
              </Badge>
            )}
            {conversation.category && (
              <Badge 
                variant="outline"
                className="rounded-full px-3 py-1.5 text-xs font-medium border-border/50"
              >
                {conversation.category}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <Clock className="h-3.5 w-3.5" />
            <span>{formatDistanceToNow(new Date(conversation.created_at!), { addSuffix: true })}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
