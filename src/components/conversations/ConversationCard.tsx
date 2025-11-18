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
        "hover:bg-accent/50 active:bg-accent/70",
        selected && "bg-accent border-l-4 border-l-primary shadow-sm"
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

      {/* Desktop Layout: Full details */}
      <div className="hidden md:block">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <ChannelIcon channel={conversation.channel} />
              <h3 className="font-semibold text-sm truncate">
                {conversation.title || 'Untitled Conversation'}
              </h3>
            </div>
            
            <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
              {conversation.summary_for_human || 'No summary available'}
            </p>
            
            <div className="flex items-center gap-2 flex-wrap">
              {conversation.category && (
                <Badge variant="outline" className="text-xs">
                  {conversation.category}
                </Badge>
              )}
              {conversation.priority && (
                <Badge 
                  variant={
                    conversation.priority === 'high' ? 'destructive' :
                    conversation.priority === 'medium' ? 'default' :
                    'secondary'
                  }
                  className="text-xs"
                >
                  {conversation.priority}
                </Badge>
              )}
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <SLABadge conversation={conversation} />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{formatDistanceToNow(new Date(conversation.created_at!), { addSuffix: true })}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
