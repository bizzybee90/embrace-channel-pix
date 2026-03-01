import { useState, useEffect } from 'react';
import { PowerModeLayout } from '@/components/layout/PowerModeLayout';
import { TabletLayout } from '@/components/layout/TabletLayout';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';
import { MobileHeader } from '@/components/sidebar/MobileHeader';
import { JaceStyleInbox } from '@/components/conversations/JaceStyleInbox';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { InboxContent } from '@/components/conversations/InboxContent';
import { SearchInput } from '@/components/conversations/SearchInput';
import { BackButton } from '@/components/shared/BackButton';
import { Conversation } from '@/lib/types';
import { useSLANotifications } from '@/hooks/useSLANotifications';
import { useIsMobile } from '@/hooks/use-mobile';
import { useIsTablet } from '@/hooks/use-tablet';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';

const getFilterTitle = (filter: string) => {
  switch (filter) {
    case 'needs-me': return 'Needs Action';
    case 'all-open': return 'Inbox';
    case 'cleared': return 'Cleared';
    case 'snoozed': return 'Snoozed';
    case 'sent': return 'Sent';
    case 'unread': return 'Unread';
    case 'drafts-ready': return 'Drafts';
    case 'fyi': return 'FYI';
    default: return 'Inbox';
  }
};

interface EscalationHubProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'awaiting-reply' | 'completed' | 'sent' | 'high-priority' | 'vip-customers' | 'triaged' | 'needs-me' | 'snoozed' | 'cleared' | 'fyi' | 'unread' | 'drafts-ready';
}

export const EscalationHub = ({ filter = 'all-open' }: EscalationHubProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const queryClient = useQueryClient();

  useEffect(() => {
    setSelectedConversation(null);
  }, [filter]);

  useSLANotifications();

  const handleUpdate = async () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleClose = () => {
    setSelectedConversation(null);
  };

  const handleSelectConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['jace-inbox'] });
  };

  // Tablet view
  if (isTablet) {
    return <TabletLayout filter={filter} />;
  }

  // Mobile view
  if (isMobile) {
    return (
      <div className="flex flex-col h-screen bg-background">
        <MobileHeader
          onMenuClick={() => setSidebarOpen(true)}
          showBackButton={!!selectedConversation}
          onBackClick={handleClose}
        />
        <MobileSidebarSheet
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          onNavigate={handleClose}
        />
        <div className="flex-1 overflow-hidden">
          {!selectedConversation ? (
            <JaceStyleInbox
              filter={filter}
              onSelect={handleSelectConversation}
            />
          ) : (
            <ConversationThread
              key={refreshKey}
              conversation={selectedConversation}
              onUpdate={handleUpdate}
              onBack={handleClose}
            />
          )}
        </div>
      </div>
    );
  }

  // Desktop view — new canonical layout
  const headerContent = (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-3">
        <BackButton to="/" label="Home" />
        <h1 className="text-base font-semibold">{getFilterTitle(filter)}</h1>
      </div>
      <div className="flex items-center gap-4">
        <div className="w-64">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search conversations..."
          />
        </div>
        <Button variant="ghost" size="sm" onClick={handleRefresh} className="h-8 w-8 p-0">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <PowerModeLayout header={headerContent}>
      <InboxContent filter={filter} />
    </PowerModeLayout>
  );
};
