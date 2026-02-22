import { useState } from 'react';
import { Conversation } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { SLABadge } from '../sla/SLABadge';
import { ChevronLeft, Sparkles } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { TeachModal } from './TeachModal';
import { useIsMobile } from '@/hooks/use-mobile';

interface ConversationHeaderProps {
  conversation: Conversation;
  onUpdate: () => void;
  onBack?: () => void;
  hideBackButton?: boolean;
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

export const ConversationHeader = ({ conversation, onUpdate, onBack, hideBackButton = false }: ConversationHeaderProps) => {
  const location = useLocation();
  const listName = getListName(location.pathname);
  const [showTeachModal, setShowTeachModal] = useState(false);
  const isMobile = useIsMobile();

  // On mobile, back button is handled by MobileHeader at the layout level
  const showBackButton = onBack && !hideBackButton && !isMobile;

  return (
    <>
      <div className="border-b border-border/30 p-3 bg-card/95 backdrop-blur-lg shadow-sm sticky top-0 z-20">
        <div className="relative flex items-center justify-between gap-2">
          {showBackButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="flex-shrink-0 gap-1 text-muted-foreground hover:text-foreground z-10"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back</span>
            </Button>
          )}
          {!showBackButton && <div className="w-1" />}
          <h2 className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold text-foreground truncate max-w-[60%] text-center">
            {conversation.title || 'No subject'}
          </h2>
          <div className="w-1" />
          
          <div className="flex items-center gap-2">
            {(conversation as any).ai_confidence != null && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                (conversation as any).ai_confidence >= 0.9 ? 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400' :
                (conversation as any).ai_confidence >= 0.7 ? 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400' :
                'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400'
              }`}>
                AI {Math.round((conversation as any).ai_confidence * 100)}%
              </span>
            )}
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