import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Clock } from 'lucide-react';
import { SLABadge } from '../sla/SLABadge';
import { ChannelIcon } from '../shared/ChannelIcon';
import { cn } from '@/lib/utils';

interface ConversationCardProps {
  conversation: Conversation;
  selected: boolean;
  onClick: () => void;
}

export const ConversationCard = ({ conversation, selected, onClick }: ConversationCardProps) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        "p-3 md:p-4 border-b border-border cursor-pointer transition-all duration-200 rounded-lg md:rounded-none mb-1 md:mb-0",
        "hover:bg-accent/50 hover:shadow-sm active:bg-accent/70",
        selected && "bg-accent border-l-4 border-l-primary shadow-md"
      )}
    >
      {/* Mobile Layout: Compact single row */}
      <div className="md:hidden">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <ChannelIcon channel={conversation.channel} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate mb-0.5">
              {conversation.title || 'Untitled Conversation'}
            </h3>
            <p className="text-xs text-muted-foreground truncate">
              {conversation.summary_for_human || 'No summary available'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {conversation.priority && (
              <div className={cn(
                "h-2 w-2 rounded-full",
                conversation.priority === 'high' && 'bg-destructive',
                conversation.priority === 'medium' && 'bg-warning',
                conversation.priority === 'low' && 'bg-muted-foreground'
              )} />
            )}
            <SLABadge conversation={conversation} compact />
          </div>
        </div>
      </div>

      {/* Desktop Layout: Responsive to width */}
      <div className="hidden md:block">
        <div className="flex flex-col gap-2">
          {/* Top row: Channel, Title and SLA Badge */}
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 pt-0.5">
              <ChannelIcon channel={conversation.channel} />
            </div>
            <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
              <h3 className="font-semibold text-sm truncate flex-1" title={conversation.title || 'Untitled Conversation'}>
                {conversation.title || 'Untitled Conversation'}
              </h3>
              <div className="flex-shrink-0">
                <SLABadge conversation={conversation} compact />
              </div>
            </div>
          </div>
          
          {/* Summary - hide at very narrow widths */}
          <p className="text-xs text-muted-foreground line-clamp-1 leading-relaxed" title={conversation.summary_for_human || 'No summary available'}>
            {conversation.summary_for_human || 'No summary available'}
          </p>
          
          {/* Bottom row: Priority indicator and Time */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {conversation.priority && (
                <div className={cn(
                  "h-2 w-2 rounded-full flex-shrink-0",
                  conversation.priority === 'high' && 'bg-destructive',
                  conversation.priority === 'medium' && 'bg-warning',
                  conversation.priority === 'low' && 'bg-muted-foreground'
                )} />
              )}
              {conversation.category && (
                <span className="text-xs text-muted-foreground truncate" title={conversation.category}>
                  {conversation.category}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
              <Clock className="h-3 w-3" />
              <span className="whitespace-nowrap">{formatDistanceToNow(new Date(conversation.created_at!), { addSuffix: true })}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
