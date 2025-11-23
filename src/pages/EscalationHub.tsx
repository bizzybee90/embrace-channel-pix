import { useState } from 'react';
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
import { MobileConversationList } from '@/components/conversations/MobileConversationList';
import { MobileConversationView } from '@/components/conversations/MobileConversationView';
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
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'completed' | 'high-priority' | 'vip-customers';
}

export const EscalationHub = ({ filter = 'all-open' }: EscalationHubProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [modalWidth, setModalWidth] = useState(75);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [channelFilter, setChannelFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { interfaceMode, loading: modeLoading } = useInterfaceMode();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  
  console.log('🔍 EscalationHub Debug:', { 
    isMobile,
    isTablet,
    filter, 
    interfaceMode, 
    modeLoading,
    windowWidth: typeof window !== 'undefined' ? window.innerWidth : 'undefined'
  });
  
  useSLANotifications();

  const handleUpdate = async () => {
    setRefreshKey(prev => prev + 1);
    
    // Refresh messages if conversation is selected
    if (selectedConversation) {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', selectedConversation.id)
        .order('created_at', { ascending: true });
      
      if (data) {
        setMessages(data as Message[]);
      }
    }
  };

  const handleRefresh = async () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleClose = () => {
    setSelectedConversation(null);
    setMessages([]);
  };

  const handleSelectConversation = async (conversation: Conversation) => {
    setSelectedConversation(conversation);
    
    // Fetch messages for the selected conversation
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });
    
    if (data) {
      setMessages(data as Message[]);
    }
  };

  const navigateConversation = (direction: 'prev' | 'next') => {
    if (!selectedConversation || conversations.length === 0) return;
    
    const currentIndex = conversations.findIndex(c => c.id === selectedConversation.id);
    if (currentIndex === -1) return;

    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < conversations.length) {
      setSelectedConversation(conversations[newIndex]);
      setRefreshKey(prev => prev + 1);
    }
  };

  const getCurrentPosition = () => {
    if (!selectedConversation || conversations.length === 0) return { current: 0, total: 0 };
    const current = conversations.findIndex(c => c.id === selectedConversation.id) + 1;
    return { current, total: conversations.length };
  };

  const handleAssignToMe = async () => {
    if (!selectedConversation) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('conversations')
      .update({ assigned_to: user.id })
      .eq('id', selectedConversation.id);
    
    toast({ title: "Assigned to you" });
    handleUpdate();
  };

  const handleResolve = async () => {
    if (!selectedConversation) return;
    
    await supabase
      .from('conversations')
      .update({ 
        status: 'resolved',
        resolved_at: new Date().toISOString()
      })
      .eq('id', selectedConversation.id);
    
    toast({ title: "Resolved" });
    handleUpdate();
    handleClose();
  };

  const handlePriorityChange = async (priority: string) => {
    if (!selectedConversation) return;
    
    await supabase
      .from('conversations')
      .update({ priority })
      .eq('id', selectedConversation.id);
    
    handleUpdate();
  };

  // Keyboard shortcuts
  useKeyboardShortcuts([
    { key: 'Escape', callback: handleClose },
    { key: 'ArrowLeft', callback: () => navigateConversation('prev') },
    { key: 'ArrowRight', callback: () => navigateConversation('next') },
    { key: 'a', callback: handleAssignToMe },
    { key: 'r', callback: handleResolve },
    { key: '1', callback: () => handlePriorityChange('high') },
    { key: '2', callback: () => handlePriorityChange('medium') },
    { key: '3', callback: () => handlePriorityChange('low') },
  ], !!selectedConversation);

  const getFilterTitle = () => {
    switch (filter) {
      case 'my-tickets': return 'My Tickets';
      case 'unassigned': return 'Unassigned';
      case 'sla-risk': return 'SLA Risk';
      case 'all-open': return 'All Open';
      case 'completed': return 'Completed';
      case 'high-priority': return 'High Priority';
      case 'vip-customers': return 'VIP Customers';
      default: return 'Conversations';
    }
  };

  // Tablet view (768px-1024px) - ALWAYS takes precedence over Power Mode
  if (isTablet) {
    return <TabletLayout filter={filter} />;
  }

  // If Power Mode is selected, render the 3-column layout (desktop only)
  if (!modeLoading && interfaceMode === 'power') {
    return <PowerModeLayout filter={filter} />;
  }

  // Mobile view - show either list or conversation detail
  if (isMobile) {
    if (selectedConversation) {
      return (
        <div className="min-h-screen bg-background">
          <MobileHeader
            onMenuClick={() => setSidebarOpen(true)}
            showBackButton
            onBackClick={handleClose}
          />
          <MobileSidebarSheet
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            onNavigate={handleClose}
          />
          <MobileConversationView
            conversation={selectedConversation}
            messages={messages}
            onUpdate={handleUpdate}
            onBack={handleClose}
          />
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background">
        <MobileHeader
          onMenuClick={() => setSidebarOpen(true)}
        />
        <MobileSidebarSheet
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
        />
        <MobileConversationList
          conversations={conversations}
          onSelect={handleSelectConversation}
          filterTitle={getFilterTitle()}
          statusFilter={statusFilter}
          priorityFilter={priorityFilter}
          channelFilter={channelFilter}
          categoryFilter={categoryFilter}
          onStatusFilterChange={setStatusFilter}
          onPriorityFilterChange={setPriorityFilter}
          onChannelFilterChange={setChannelFilter}
          onCategoryFilterChange={setCategoryFilter}
          onRefresh={handleRefresh}
        />
      </div>
    );
  }

  // Desktop view
  return (
    <>
      <ThreeColumnLayout
        sidebar={<Sidebar onNavigate={handleClose} />}
        main={
          <ConversationList
            filter={filter}
            selectedId={selectedConversation?.id}
            onSelect={(conv) => {
              setSelectedConversation(conv);
              setRefreshKey(prev => prev + 1);
            }}
            onConversationsChange={setConversations}
          />
        }
      />
      
      {selectedConversation && (
        <div className="focus-mode-overlay animate-fade-in" style={{ zIndex: 39 }} onClick={handleClose} />
      )}
      
      <Dialog open={!!selectedConversation} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent 
          className="max-w-none h-[100vh] md:h-[90vh] min-h-0 p-0 gap-0 animate-scale-in w-full md:w-auto"
          style={{ width: window.innerWidth < 900 ? '100%' : `${modalWidth}%`, zIndex: 40 }}
        >
          {/* Resize handle - left edge (hidden on mobile) */}
          <div 
            className="w-1 bg-border hover:bg-primary cursor-ew-resize flex-shrink-0 hidden md:block"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = modalWidth;

              const handleMouseMove = (e: MouseEvent) => {
                const deltaX = startX - e.clientX;
                const newWidth = Math.min(95, Math.max(60, startWidth + (deltaX / window.innerWidth) * 100));
                setModalWidth(newWidth);
              };

              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
              };

              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
            }}
          />

          {/* Navigation controls (hidden on mobile) */}
          {conversations.length > 1 && (
            <div className="absolute top-4 left-4 z-10 hidden md:flex items-center gap-2 bg-background/95 backdrop-blur rounded-lg p-1 border border-border">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => navigateConversation('prev')}
                disabled={getCurrentPosition().current <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground px-2">
                {getCurrentPosition().current} of {getCurrentPosition().total}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => navigateConversation('next')}
                disabled={getCurrentPosition().current >= getCurrentPosition().total}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="flex flex-1 h-full overflow-hidden flex-col md:flex-row">
            {/* Main Content - Conversation */}
            <div className="flex-1 flex flex-col overflow-hidden w-full md:w-auto md:min-w-[600px]">
              {selectedConversation && (
                <ConversationThread
                  key={refreshKey}
                  conversation={selectedConversation}
                  onUpdate={handleUpdate}
                  onBack={handleClose}
                />
              )}
            </div>
            
            {/* Right Sidebar - Customer Context & Quick Actions (hidden on mobile) */}
            <div className="hidden md:flex w-72 min-w-[280px] border-l border-border bg-card/50 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {selectedConversation && (
                  <>
                    <CustomerContext conversation={selectedConversation} onUpdate={handleUpdate} />
                    <QuickActions conversation={selectedConversation} onUpdate={handleUpdate} onBack={handleClose} />
                  </>
                )}
              </div>
            </div>

            {/* Mobile Bottom Sheet for Quick Actions */}
            <div className="md:hidden">
              {selectedConversation && (
                <MobileQuickActions 
                  conversation={selectedConversation}
                  onUpdate={handleUpdate}
                  onClose={handleClose}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
