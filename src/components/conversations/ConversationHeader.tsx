import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SLABadge } from '../sla/SLABadge';
import { ArrowLeft } from 'lucide-react';

interface ConversationHeaderProps {
  conversation: Conversation;
  onUpdate: () => void;
  onBack?: () => void;
}

const PriorityBadge = ({ priority }: { priority: string | null }) => {
  const variants: Record<string, { emoji: string; className: string }> = {
    high: { emoji: '🔴', className: 'bg-destructive/10 text-destructive border-destructive/20' },
    medium: { emoji: '🟡', className: 'bg-warning/10 text-warning-foreground border-warning/20' },
    low: { emoji: '🟢', className: 'bg-success/10 text-success-foreground border-success/20' },
  };

  const variant = variants[priority || 'medium'];
  
  return (
    <Badge variant="outline" className={`${variant.className} text-xs font-medium`}>
      {variant.emoji} {priority || 'medium'}
    </Badge>
  );
};

export const ConversationHeader = ({ conversation, onUpdate, onBack }: ConversationHeaderProps) => {

  return (
    <div className="border-b border-border/30 p-3 md:p-4 bg-card/95 backdrop-blur-lg shadow-sm sticky top-0 z-20">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="md:hidden flex-shrink-0 h-9 w-9 mobile-spring-bounce rounded-xl"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-lg md:text-lg truncate leading-tight">{conversation.title}</h2>
          </div>
          
          <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
            <SLABadge conversation={conversation} />
            <PriorityBadge priority={conversation.priority} />
          </div>
        </div>
      </div>
    </div>
  );
};