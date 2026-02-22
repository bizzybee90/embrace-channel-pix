import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { JaceStyleInbox } from '@/components/conversations/JaceStyleInbox';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { Conversation } from '@/lib/types';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileHeader } from '@/components/sidebar/MobileHeader';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';
import { supabase } from '@/integrations/supabase/client';

interface PowerModeLayoutProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'awaiting-reply' | 'completed' | 'sent' | 'high-priority' | 'vip-customers' | 'escalations' | 'triaged' | 'needs-me' | 'snoozed' | 'cleared' | 'fyi' | 'unread' | 'drafts-ready';
  channelFilter?: string;
}

export const PowerModeLayout = ({ filter = 'all-open', channelFilter }: PowerModeLayoutProps) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);

  // Handle conversation query parameter to auto-select
  useEffect(() => {
    const conversationId = searchParams.get('conversation');
    if (conversationId && !selectedConversation) {
      const fetchConversation = async () => {
        const { data } = await supabase
          .from('conversations')
          .select('*, customer:customers(*), assigned_user:users!conversations_assigned_to_fkey(*)')
          .eq('id', conversationId)
          .single();
        
        if (data) {
          setSelectedConversation(data as Conversation);
        }
      };
      fetchConversation();
    }
  }, [searchParams, selectedConversation]);

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleSelectConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    const newParams = new URLSearchParams(searchParams);
    newParams.set('conversation', conversation.id);
    setSearchParams(newParams, { replace: true });
  };

  const handleBack = () => {
    setSelectedConversation(null);
    setCustomerPanelOpen(false);
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('conversation');
    setSearchParams(newParams, { replace: true });
  };

  return (
    <div className="flex flex-col h-screen w-full bg-muted/30 overflow-hidden">
      {/* Mobile Header */}
      {isMobile && (
        <>
          <MobileHeader onMenuClick={() => setSidebarOpen(true)} />
          <MobileSidebarSheet open={sidebarOpen} onOpenChange={setSidebarOpen} />
        </>
      )}
      
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Icon Rail Sidebar */}
        <aside className="hidden md:flex border-r border-border/50 bg-card flex-shrink-0">
          <Sidebar />
        </aside>

        {/* Content area with padding for floating cards */}
        <div className="flex-1 flex gap-4 p-4 min-h-0 overflow-hidden">
          {/* Main Content */}
          {!selectedConversation ? (
            /* When nothing is selected, show just the inbox as a floating card */
            <main className="flex-1 min-h-0 h-full overflow-hidden bg-card rounded-2xl shadow-sm">
              <JaceStyleInbox
                filter={filter}
                onSelect={handleSelectConversation}
              />
            </main>
          ) : (
            <>
              {/* Conversation List - floating card */}
              <div className="w-[380px] min-w-[380px] flex-shrink-0 min-h-0 bg-card rounded-2xl shadow-sm overflow-hidden hidden md:flex flex-col">
                <JaceStyleInbox
                  filter={filter}
                  onSelect={handleSelectConversation}
                />
              </div>

              {/* Conversation Thread - floating card */}
              <div className="flex-1 min-h-0 bg-card rounded-2xl shadow-sm overflow-hidden flex flex-col">
                <ConversationThread
                  key={refreshKey}
                  conversation={selectedConversation}
                  onUpdate={handleUpdate}
                  onBack={handleBack}
                  hideBackButton={false}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Customer Info Overlay Drawer */}
      {customerPanelOpen && selectedConversation && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/20 z-40 transition-opacity"
            onClick={() => setCustomerPanelOpen(false)}
          />
          {/* Drawer */}
          <div className="fixed top-0 right-0 h-full w-[380px] max-w-[90vw] z-50 bg-card shadow-2xl border-l border-border/50 flex flex-col animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <span className="text-sm font-medium text-muted-foreground">Customer Info</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCustomerPanelOpen(false)}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <CustomerContext conversation={selectedConversation} onUpdate={handleUpdate} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};