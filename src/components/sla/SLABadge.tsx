import { Badge } from '@/components/ui/badge';
import { SLACountdown } from './SLACountdown';
import { Conversation } from '@/lib/types';
import { cn } from '@/lib/utils';

interface SLABadgeProps {
  conversation: Conversation;
  compact?: boolean;
}

export const SLABadge = ({ conversation, compact = false }: SLABadgeProps) => {
  if (!conversation.sla_due_at) {
    return null;
  }

  const now = new Date();
  const dueDate = new Date(conversation.sla_due_at);
  const isOverdue = now > dueDate;

  if (compact) {
    // Mobile compact version - just a colored dot
    return (
      <div 
        className={cn(
          "h-2 w-2 rounded-full",
          isOverdue && "bg-destructive",
          !isOverdue && "bg-success"
        )}
        title={isOverdue ? 'Overdue' : 'On time'}
      />
    );
  }

  return (
    <Badge 
      variant={isOverdue ? "destructive" : "secondary"}
      className="text-xs font-medium"
    >
      {isOverdue ? 'Overdue' : <SLACountdown slaDueAt={conversation.sla_due_at} />}
    </Badge>
  );
};
