import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Mail, Phone } from 'lucide-react';
import { SLABadge } from '../sla/SLABadge';
import { cn } from '@/lib/utils';

interface ConversationCardProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
}

export const ConversationCard = ({ conversation, isSelected, onClick }: ConversationCardProps) => {
  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'sms':
        return <Phone className="h-4 w-4" />;
      case 'whatsapp':
        return <MessageSquare className="h-4 w-4 text-green-600" />;
      case 'email':
        return <Mail className="h-4 w-4" />;
      case 'web_chat':
        return <MessageSquare className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'low':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      default:
        return '';
    }
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        'p-4 cursor-pointer hover:bg-accent/50 transition-colors',
        isSelected && 'bg-accent'
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex-shrink-0">
            {getChannelIcon(conversation.channel)}
          </div>
          <h3 className="font-medium truncate">
            {conversation.customer?.name || 'Unknown Customer'}
          </h3>
        </div>
        <Badge variant="outline" className={cn('flex-shrink-0', getPriorityColor(conversation.priority))}>
          {conversation.priority}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
        {conversation.summary_for_human || 'No summary available'}
      </p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-xs">
            {conversation.category}
          </Badge>
          {conversation.assigned_to ? (
            <span className="text-xs text-muted-foreground">
              {conversation.assigned_user?.name}
            </span>
          ) : (
            <Badge variant="outline" className="text-xs">
              Unassigned
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-2 flex-shrink-0">
          <SLABadge
            slaStatus={conversation.sla_status}
            slaDueAt={conversation.sla_due_at}
          />
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(conversation.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  );
};
