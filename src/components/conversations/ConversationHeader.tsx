import { useState } from 'react';
import { Conversation } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { SLABadge } from '../sla/SLABadge';
import { ChevronLeft, Sparkles } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { TeachModal } from './TeachModal';

interface ConversationHeaderProps {
  conversation: Conversation;
  onUpdate: () => void;
  onBack?: () => void;
}

const getListName = (pathname: string): string => {
  if (pathname.includes('my-tickets')) return 'My Tickets';
  if (pathname.includes('unassigned')) return 'Unassigned';
  if (pathname.includes('all-open')) return 'All Open';
  if (pathname.includes('escalations')) return 'Escalations';
  if (pathname.includes('awaiting')) return 'Awaiting Reply';
  if (pathname.includes('completed')) return 'Completed';
  if (pathname.includes('channel')) return 'Channels';
  return 'Conversations';
};

export const ConversationHeader = ({ conversation, onUpdate, onBack }: ConversationHeaderProps) => {
  const location = useLocation();
  const listName = getListName(location.pathname);
  const [showTeachModal, setShowTeachModal] = useState(false);

  return (
    <>
      <div className="border-b border-border/30 p-3 bg-card/95 backdrop-blur-lg shadow-sm sticky top-0 z-20">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {onBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="flex-shrink-0 gap-1 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Back to {listName}</span>
                <span className="sm:hidden">Back</span>
              </Button>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTeachModal(true)}
              className="gap-1 text-muted-foreground hover:text-foreground"
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden sm:inline">Teach</span>
            </Button>
            <SLABadge conversation={conversation} />
          </div>
        </div>
      </div>

      <TeachModal
        open={showTeachModal}
        onOpenChange={setShowTeachModal}
        conversation={conversation}
        onSuccess={onUpdate}
      />
    </>
  );
};