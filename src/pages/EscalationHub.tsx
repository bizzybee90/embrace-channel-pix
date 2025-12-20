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
import { JaceStyleInbox } from '@/components/conversations/JaceStyleInbox';
import { Conversation, Message } from '@/lib/types';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useInterfaceMode } from '@/hooks/useInterfaceMode';
import { useSLANotifications } from '@/hooks/useSLANotifications';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useIsMobile } from '@/hooks/use-mobile';
import { useIsTablet } from '@/hooks/use-tablet';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

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
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
    return localStorage.getItem('customerPanelCollapsed') === 'true';
  });
  const [sortBy, setSortBy] = useState<string>(() => {
    return localStorage.getItem('conversation-sort') || 'sla_urgent';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { interfaceMode, loading: modeLoading } = useInterfaceMode();
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();

  // Persist right panel preference
  useEffect(() => {
    localStorage.setItem('customerPanelCollapsed', rightPanelCollapsed.toString());
  }, [rightPanelCollapsed]);

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
        /* Jace-style full-width inbox when no conversation selected */
        <main className="flex-1 overflow-hidden">
          <JaceStyleInbox
            filter={filter}
            onSelect={handleSelectConversation}
          />
        </main>
      ) : (
      /* Show conversation detail with customer context */
      <main className="flex-1 flex overflow-hidden min-h-0 h-full">
        {/* Conversation thread area */}
        <div className="flex-1 overflow-hidden">
          <ConversationThread
            key={refreshKey}
            conversation={selectedConversation}
            onUpdate={handleUpdate}
            onBack={handleClose}
          />
        </div>
        
        {/* Collapsed panel indicator - thin bar with expand button */}
{rightPanelCollapsed && (
          <div className="w-10 flex-shrink-0 border-l border-border bg-muted/50 flex flex-col items-center pt-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setRightPanelCollapsed(false)}
              className="h-8 w-8 bg-muted hover:bg-accent"
              title="Show customer panel"
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Right sidebar - Customer context & actions (when expanded) */}
        {!rightPanelCollapsed && (
          <aside className="w-[340px] flex-shrink-0 border-l border-border bg-card/50 overflow-y-auto h-full transition-all duration-200">
            {/* Collapse button in top-right */}
<div className="flex justify-end p-2 border-b border-border/50">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setRightPanelCollapsed(true)}
                className="h-8 w-8 bg-muted hover:bg-accent"
                title="Hide customer panel"
              >
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-5 space-y-5">
              <CustomerContext key={selectedConversation.id} conversation={selectedConversation} onUpdate={handleUpdate} />
            </div>
          </aside>
        )}
      </main>
      )}
    </div>
  );
};
