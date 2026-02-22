import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChannelIcon } from '@/components/shared/ChannelIcon';

interface ReviewQueueItemProps {
  conversation: {
    id: string;
    title: string | null;
    decision_bucket: string;
    customer: { name: string; email: string } | null;
    channel?: string;
    messages?: { actor_name?: string | null }[];
  };
  isActive: boolean;
  isReviewed: boolean;
  isSelected?: boolean;
  isMultiSelectMode?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onToggleSelect?: () => void;
}

const getStateBadge = (bucket: string) => {
  switch (bucket) {
    case 'act_now':
      return <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4 flex-shrink-0 whitespace-nowrap">Urgent</Badge>;
    case 'quick_win':
      return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-[9px] px-1 py-0 h-4 flex-shrink-0 whitespace-nowrap">Reply</Badge>;
    case 'wait':
      return <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 text-[9px] px-1 py-0 h-4 flex-shrink-0 whitespace-nowrap">FYI</Badge>;
    case 'auto_handled':
      return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 text-[9px] px-1 py-0 h-4 flex-shrink-0 whitespace-nowrap">Done</Badge>;
    default:
      return null;
  }
};

export const ReviewQueueItem = ({ 
  conversation, 
  isActive, 
  isReviewed, 
  isSelected = false,
  isMultiSelectMode = false,
  onClick,
  onToggleSelect 
}: ReviewQueueItemProps) => {
  const senderName = conversation.messages?.[0]?.actor_name || conversation.customer?.name || conversation.customer?.email?.split('@')[0] || 'Unknown Sender';

  return (
    <div
      onClick={onClick}
      className={cn(
        "px-3 py-2.5 cursor-pointer border-b border-border/30 transition-all",
        "hover:bg-accent/50",
        isActive && !isMultiSelectMode && "bg-primary/8 border-l-[3px] border-l-primary",
        isSelected && "bg-primary/15 border-l-[3px] border-l-primary",
        isReviewed && "opacity-50"
      )}
    >
      <div className="flex items-center gap-2">
        {/* Checkbox for multi-select mode */}
        {isMultiSelectMode && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect?.()}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 flex-shrink-0"
          />
        )}

        {/* Reviewed check */}
        {isReviewed && !isMultiSelectMode && (
          <Check className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
        )}
        
        {/* Channel icon */}
        {conversation.channel && !isReviewed && !isMultiSelectMode && (
          <ChannelIcon channel={conversation.channel} className="h-3 w-3 flex-shrink-0" />
        )}

        {/* Sender name */}
        <span className={cn(
          "text-sm truncate flex-1",
          isActive || isSelected ? "font-medium text-foreground" : "text-foreground/80"
        )}>
          {senderName}
        </span>

        {/* State badge */}
        {getStateBadge(conversation.decision_bucket)}
      </div>

      {/* Subject - truncated */}
      <p className={cn(
        "text-xs text-muted-foreground truncate mt-0.5",
        isMultiSelectMode ? "pl-6" : "pl-5"
      )}>
        {conversation.title || 'No subject'}
      </p>
    </div>
  );
};
