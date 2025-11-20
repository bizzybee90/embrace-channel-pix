import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Clock } from 'lucide-react';
import { ChannelIcon } from '../shared/ChannelIcon';
import { cn } from '@/lib/utils';
import { useIsTablet } from '@/hooks/use-tablet';

interface ConversationCardProps {
  conversation: Conversation;
  selected: boolean;
  onClick: () => void;
}

export const ConversationCard = ({ conversation, selected, onClick }: ConversationCardProps) => {
  const isTablet = useIsTablet();
  
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

  const getPriorityBarColor = (priority: string | null) => {
    if (!priority) return 'bg-muted';
    switch (priority.toLowerCase()) {
      case 'urgent': return 'bg-priority-urgent';
      case 'high': return 'bg-priority-high';
      case 'medium': return 'bg-priority-medium';
      case 'low': return 'bg-priority-low';
      default: return 'bg-muted';
    }
  };

  const isOverdue = conversation.sla_due_at && new Date() > new Date(conversation.sla_due_at);

  // Compact tablet layout
  if (isTablet) {
    return (
      <div
        onClick={onClick}
        className={cn(
          "relative cursor-pointer transition-all duration-300 rounded-[22px] mb-3",
          "bg-card border border-border/30 hover:border-primary/30",
          "apple-shadow hover:apple-shadow-lg spring-press",
          selected && "border-primary/50 apple-shadow-lg bg-gradient-to-br from-primary/8 via-primary/4 to-card"
        )}
      >
        {/* Priority Accent Bar */}
        {conversation.priority && (
          <div 
            className={cn(
              "absolute top-0 left-0 right-0 h-0.5",
              getPriorityBarColor(conversation.priority)
            )}
            style={{
              borderTopLeftRadius: '22px',
              borderTopRightRadius: '22px'
            }}
          />
        )}
        
        {/* Overdue Badge */}
        {isOverdue && (
          <Badge variant="priority-urgent" className="absolute top-4 right-4 text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full shadow-sm">
            Overdue
          </Badge>
        )}

        <div className="p-5">
          {/* Title */}
          <h3 className={cn(
            "font-semibold text-base leading-snug mb-2.5 line-clamp-2 text-foreground",
            isOverdue && "pr-20"
          )}>
            {conversation.title || 'Untitled Conversation'}
          </h3>

          {/* Description */}
          {(conversation.summary_for_human || conversation.ai_reason_for_escalation) && (
            <p className="text-sm text-muted-foreground leading-relaxed mb-3.5 line-clamp-2">
              {conversation.summary_for_human || conversation.ai_reason_for_escalation}
            </p>
          )}

          {/* Badge Row */}
          <div className="flex flex-wrap items-center gap-2 mb-3.5">
            {conversation.priority && (
              <Badge 
                variant={getPriorityVariant(conversation.priority)}
                className="rounded-full text-xs font-bold uppercase tracking-wide px-3 py-1.5 shadow-sm"
              >
                {conversation.priority}
              </Badge>
            )}
            
            <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 border-border/50 flex items-center gap-1.5">
              <ChannelIcon channel={conversation.channel} className="h-3.5 w-3.5" />
              {conversation.channel}
            </Badge>
          </div>

          {/* Meta Row */}
          <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
            <span className="uppercase tracking-wide">
              {conversation.category?.replace(/_/g, ' ') || 'General'}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="opacity-40">•</span>
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(conversation.created_at!), { addSuffix: true })}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Desktop layout
  return (
    <div
      onClick={onClick}
      className={cn(
        "relative cursor-pointer transition-all duration-300 ease-out rounded-[22px] mb-3",
        "bg-card border border-border/30 hover:border-primary/30",
        "apple-shadow hover:apple-shadow-lg spring-press",
        selected && "border-primary/50 apple-shadow-lg bg-gradient-to-br from-primary/8 via-primary/4 to-card"
      )}
    >
      {/* Priority Accent Bar */}
      {conversation.priority && (
        <div 
          className={cn(
            "absolute top-0 left-0 right-0 h-0.5",
            getPriorityBarColor(conversation.priority)
          )}
          style={{
            borderTopLeftRadius: '22px',
            borderTopRightRadius: '22px'
          }}
        />
      )}
      
      {/* Overdue Badge */}
      {isOverdue && (
        <Badge variant="priority-urgent" className="absolute top-4 right-4 text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full shadow-sm">
          Overdue
        </Badge>
      )}

      <div className="p-6">
        {/* Title */}
        <h3 className={cn(
          "font-semibold text-lg leading-snug mb-2.5 text-foreground line-clamp-2",
          isOverdue && "pr-20"
        )}>
          {conversation.title || 'Untitled Conversation'}
        </h3>

        {/* Description */}
        {conversation.ai_reason_for_escalation && (
          <p className="text-[15px] text-muted-foreground leading-relaxed mb-4 line-clamp-2">
            {conversation.ai_reason_for_escalation}
          </p>
        )}

        {/* Badge Row */}
        <div className="flex flex-wrap items-center gap-2.5 mb-4">
          {conversation.priority && (
            <Badge 
              variant={getPriorityVariant(conversation.priority)}
              className="rounded-full text-xs font-bold uppercase tracking-wide px-3 py-1.5 shadow-sm"
            >
              {conversation.priority}
            </Badge>
          )}
          
          <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 border-border/50 flex items-center gap-1.5">
            <ChannelIcon channel={conversation.channel} className="h-3.5 w-3.5" />
            {conversation.channel}
          </Badge>
        </div>

        {/* Meta Row */}
        <div className="flex items-center justify-between text-[13px] text-muted-foreground font-medium">
          <span className="uppercase tracking-wide">
            {conversation.category?.replace(/_/g, ' ') || 'General'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="opacity-40">•</span>
            {formatDistanceToNow(new Date(conversation.created_at!), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  );
};
