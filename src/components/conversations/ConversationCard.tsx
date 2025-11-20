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
  const getPriorityColor = (priority: string | null) => {
    if (!priority) return 'secondary';
    if (priority === 'urgent' || priority === 'high') return 'destructive';
    if (priority === 'medium') return 'secondary';
    return 'outline';
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "p-5 cursor-pointer transition-all duration-200 rounded-[24px] mb-3",
        "bg-background border border-border/50 hover:border-primary/20",
        "hover:shadow-lg hover:shadow-primary/5 active:scale-[0.98]",
        selected && "border-primary/40 shadow-xl shadow-primary/10 bg-gradient-to-br from-primary/10 via-primary/5 to-background"
      )}
    >
      <div className="flex flex-col gap-3">
        {/* Header: Channel + Title */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 pt-1">
            <ChannelIcon channel={conversation.channel} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-lg leading-snug mb-1.5 text-foreground">
              {conversation.title || 'Untitled Conversation'}
            </h3>
            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
              {conversation.summary_for_human || 'No summary available'}
            </p>
          </div>
        </div>
        
        {/* Footer: Badges + Time */}
        <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
          <div className="flex items-center gap-2">
            {conversation.priority && (
              <Badge 
                variant={getPriorityColor(conversation.priority)}
                className="rounded-full px-3 py-1 text-xs font-medium"
              >
                {conversation.priority.charAt(0).toUpperCase() + conversation.priority.slice(1)}
              </Badge>
            )}
            {conversation.category && (
              <Badge 
                variant="outline"
                className="rounded-full px-3 py-1 text-xs font-medium"
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
