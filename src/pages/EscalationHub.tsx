import { useState, useEffect } from 'react';
import { PowerModeLayout } from '@/components/layout/PowerModeLayout';
import { TabletLayout } from '@/components/layout/TabletLayout';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';
import { MobileHeader } from '@/components/sidebar/MobileHeader';
import { JaceStyleInbox } from '@/components/conversations/JaceStyleInbox';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { Conversation } from '@/lib/types';
import { useSLANotifications } from '@/hooks/useSLANotifications';
import { useIsMobile } from '@/hooks/use-mobile';
import { useIsTablet } from '@/hooks/use-tablet';

interface EscalationHubProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'awaiting-reply' | 'completed' | 'sent' | 'high-priority' | 'vip-customers' | 'triaged' | 'needs-me' | 'snoozed' | 'cleared' | 'fyi';
}

export const EscalationHub = ({ filter = 'all-open' }: EscalationHubProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  
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

  // Tablet view (768px-1024px)
  if (isTablet) {
    return <TabletLayout filter={filter} />;
  }

  // Mobile view - Uses same Jace layout as desktop
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

  // Desktop view - Single unified layout with collapsible panel
  return <PowerModeLayout filter={filter} />;
};
