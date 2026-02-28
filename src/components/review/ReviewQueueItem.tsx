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
  const base = "bg-muted text-muted-foreground px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider flex-shrink-0 whitespace-nowrap";
  switch (bucket) {
    case 'act_now':
      return <Badge className={base}>Urgent</Badge>;
    case 'quick_win':
      return <Badge className={base}>Reply</Badge>;
    case 'wait':
      return <Badge className={base}>FYI</Badge>;
    case 'auto_handled':
      return <Badge className={base}>Done</Badge>;
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
        "rounded-xl mx-2 my-1 p-3 cursor-pointer transition-all",
        isActive && !isMultiSelectMode && "bg-white shadow-sm border border-amber-200 ring-1 ring-amber-50",
        !isActive && !isSelected && "border border-transparent hover:bg-background-alt",
        isSelected && "bg-white shadow-sm border border-amber-200 ring-1 ring-amber-50",
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
