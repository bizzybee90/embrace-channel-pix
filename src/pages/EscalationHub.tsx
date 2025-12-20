import { useState, useEffect } from 'react';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { PowerModeLayout } from '@/components/layout/PowerModeLayout';
import { TabletLayout } from '@/components/layout/TabletLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';
import { MobileHeader } from '@/components/sidebar/MobileHeader';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { QuickActions } from '@/components/conversations/QuickActions';
import { MobileQuickActions } from '@/components/conversations/MobileQuickActions';
import { MobileConversationList } from '@/components/conversations/mobile/MobileConversationList';
import { MobileConversationView } from '@/components/conversations/mobile/MobileConversationView';
import { Conversation, Message } from '@/lib/types';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useInterfaceMode } from '@/hooks/useInterfaceMode';
import { useSLANotifications } from '@/hooks/useSLANotifications';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useIsMobile } from '@/hooks/use-mobile';
import { useIsTablet } from '@/hooks/use-tablet';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface EscalationHubProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'awaiting-reply' | 'completed' | 'sent' | 'high-priority' | 'vip-customers' | 'triaged' | 'needs-me' | 'snoozed' | 'cleared' | 'fyi';
}

export const EscalationHub = ({ filter = 'all-open' }: EscalationHubProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [channelFilter, setChannelFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string>(() => {
    return localStorage.getItem('conversation-sort') || 'sla_urgent';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { interfaceMode, loading: modeLoading } = useInterfaceMode();
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();

  // Persist sort preference
  useEffect(() => {
    localStorage.setItem('conversation-sort', sortBy);
  }, [sortBy]);
  
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

  const getFilterTitle = () => {
    switch (filter) {
      case 'needs-me': return 'To Reply';
      case 'fyi': return 'FYI';
      case 'cleared': return 'Done';
      case 'snoozed': return 'Snoozed';
      case 'sent': return 'Sent';
      case 'my-tickets': return 'My Tickets';
      case 'unassigned': return 'Unassigned';
      case 'sla-risk': return 'SLA Risk';
      case 'all-open': return 'Inbox (All)';
      case 'awaiting-reply': return 'Awaiting Reply';
      case 'completed': return 'Completed';
      case 'high-priority': return 'High Priority';
      case 'vip-customers': return 'VIP Customers';
      default: return 'Conversations';
    }
  };

  // Tablet view (768px-1024px)
  if (isTablet) {
    return <TabletLayout filter={filter} />;
  }

  // Power Mode (desktop only)
  if (!modeLoading && interfaceMode === 'power') {
    return <PowerModeLayout filter={filter} />;
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
        <div className="flex-1 overflow-y-auto">
          {!selectedConversation ? (
            <MobileConversationList
              conversations={conversations}
              onSelect={handleSelectConversation}
              filterTitle={getFilterTitle()}
              statusFilter={statusFilter}
              priorityFilter={priorityFilter}
              channelFilter={channelFilter}
              categoryFilter={categoryFilter}
              sortBy={sortBy}
              onStatusFilterChange={setStatusFilter}
              onPriorityFilterChange={setPriorityFilter}
              onChannelFilterChange={setChannelFilter}
              onCategoryFilterChange={setCategoryFilter}
              onSortByChange={setSortBy}
              onRefresh={handleUpdate}
            />
          ) : (
            <>
              <MobileConversationView
                conversation={selectedConversation}
                messages={[]}
                onUpdate={handleUpdate}
                onBack={handleClose}
              />
              <MobileQuickActions 
                conversation={selectedConversation}
                onUpdate={handleUpdate}
                onClose={handleClose}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  // Desktop view - Focus Mode
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="border-r border-border bg-card flex-shrink-0 overflow-y-auto">
        <Sidebar onNavigate={handleClose} />
      </aside>

      {/* Main content area */}
      {!selectedConversation ? (
        /* Show conversation list */
        <main className="flex-1 overflow-y-auto">
          <ConversationList
            filter={filter}
            selectedId={selectedConversation?.id}
            onSelect={handleSelectConversation}
            onConversationsChange={setConversations}
          />
        </main>
      ) : (
      /* Show conversation detail */
      <main className="flex-1 flex overflow-hidden min-h-0 h-full">
        <ConversationThread
          key={refreshKey}
          conversation={selectedConversation}
          onUpdate={handleUpdate}
          onBack={handleClose}
        />
        
        {/* Right sidebar - Customer context & actions */}
        <aside className="w-[340px] min-w-[300px] border-l border-border bg-card/50 overflow-y-auto flex-shrink-0">
          <div className="p-5 space-y-5">
            <CustomerContext key={selectedConversation.id} conversation={selectedConversation} onUpdate={handleUpdate} />
            <QuickActions conversation={selectedConversation} onUpdate={handleUpdate} onBack={handleClose} />
          </div>
        </aside>
      </main>
      )}
    </div>
  );
};
