import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { JaceStyleInbox } from '@/components/conversations/JaceStyleInbox';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { Conversation } from '@/lib/types';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
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
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
    return localStorage.getItem('customerPanelCollapsed') === 'true';
  });

  // Handle conversation query parameter to auto-select
  useEffect(() => {
    const conversationId = searchParams.get('conversation');
    if (conversationId && !selectedConversation) {
      // Fetch the conversation and auto-select it
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

  // Persist right panel preference
  useEffect(() => {
    localStorage.setItem('customerPanelCollapsed', rightPanelCollapsed.toString());
  }, [rightPanelCollapsed]);

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleSelectConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    // Update URL with selected conversation
    const newParams = new URLSearchParams(searchParams);
    newParams.set('conversation', conversation.id);
    setSearchParams(newParams, { replace: true });
  };

  const handleBack = () => {
    setSelectedConversation(null);
    // Remove conversation from URL
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('conversation');
    setSearchParams(newParams, { replace: true });
  };

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden">
      {/* Mobile Header */}
      {isMobile && (
        <>
          <MobileHeader onMenuClick={() => setSidebarOpen(true)} />
          <MobileSidebarSheet open={sidebarOpen} onOpenChange={setSidebarOpen} />
        </>
      )}
      
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar - width controlled by Sidebar component itself (hidden on mobile) */}
        <aside className="hidden md:flex border-r border-border bg-card flex-shrink-0">
          <Sidebar />
        </aside>

      {/* Main Content */}
      {!selectedConversation ? (
        /* When nothing is selected, show just the inbox (no empty 2nd/3rd panels) */
        <main className="flex-1 min-h-0 h-full overflow-hidden">
          <div className="h-full w-full border-r border-border/30 bg-card overflow-hidden min-w-0">
            <JaceStyleInbox
              filter={filter}
              onSelect={handleSelectConversation}
            />
          </div>
        </main>
      ) : (
        /* When selected, show the full 3-column power layout */
        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 h-full overflow-hidden">
          {/* Conversation List Panel */}
          <ResizablePanel 
            defaultSize={35} 
            minSize={30}
            maxSize={50}
            collapsible={false}
            className="flex min-h-0"
          >
            <div className="flex-1 flex flex-col border-r border-border/30 bg-card w-full overflow-hidden min-w-0">
              <JaceStyleInbox
                filter={filter}
                onSelect={handleSelectConversation}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle className="w-1 bg-border/50 hover:bg-border transition-colors hidden md:block" />

          {/* Conversation Thread Panel */}
          <ResizablePanel 
            defaultSize={rightPanelCollapsed ? 60 : 45} 
            minSize={35}
            maxSize={70}
            collapsible={false}
            className="w-full min-h-0 flex flex-col h-full min-w-0"
          >
            <div className="h-full w-full min-h-0 overflow-hidden min-w-0">
              <ConversationThread
                key={refreshKey}
                conversation={selectedConversation}
                onUpdate={handleUpdate}
                onBack={handleBack}
                hideBackButton={true}
              />
            </div>
          </ResizablePanel>

          {/* Collapsed panel indicator - thin bar with expand button */}
          {rightPanelCollapsed && (
            <>
              <ResizableHandle className="w-1 bg-border/50 hover:bg-border transition-colors hidden md:block" />
              <ResizablePanel 
                defaultSize={5} 
                minSize={3}
                maxSize={5}
                collapsible={false}
                className="hidden md:flex min-h-0"
              >
                <TooltipProvider>
                  <div className="w-full h-full border-l border-border bg-muted/50 flex flex-col items-center pt-4 relative">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRightPanelCollapsed(false)}
                          className="h-8 w-8 bg-background/95 backdrop-blur hover:bg-accent transition-all duration-300"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <p>Show customer panel</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              </ResizablePanel>
            </>
          )}

          {/* Customer Context Panel (when expanded) */}
          {!rightPanelCollapsed && (
            <>
              <ResizableHandle className="w-1 bg-border/50 hover:bg-border transition-colors hidden md:block" />
              <ResizablePanel 
                defaultSize={20} 
                minSize={18}
                maxSize={35}
                collapsible={false}
                className="hidden md:flex min-h-0"
              >
                <div className="flex-1 flex flex-col overflow-hidden bg-card/50 min-w-0">
                  {/* Fixed header with collapse button */}
                  <TooltipProvider>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
                      <span className="text-sm font-medium text-muted-foreground">Customer Info</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setRightPanelCollapsed(true)}
                            className="h-8 w-8 bg-background/95 backdrop-blur hover:bg-accent transition-all duration-300"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          <p>Hide customer panel</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                  {/* Scrollable content */}
                  <div className="flex-1 overflow-y-auto p-5">
                    <CustomerContext conversation={selectedConversation} onUpdate={handleUpdate} />
                  </div>
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      )}
      </div>
    </div>
  );
};
