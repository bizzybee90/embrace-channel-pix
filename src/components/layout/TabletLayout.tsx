import { useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { QuickActions } from '@/components/conversations/QuickActions';
import { Conversation } from '@/lib/types';
import { Menu, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ConversationFilters } from '@/components/conversations/ConversationFilters';

interface TabletLayoutProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const TabletLayout = ({ filter = 'all-open' }: TabletLayoutProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [channelFilter, setChannelFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleSelectConversation = (conv: Conversation) => {
    setSelectedConversation(conv);
  };

  // Tablet 2-column layout: Ticket List (left) + Conversation Panel (center)
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Hamburger Sidebar Drawer */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[55%] p-0 backdrop-blur-sm">
          <Sidebar />
        </SheetContent>
      </Sheet>

      {/* Main Container */}
      <div className="flex flex-col w-full h-full">
        {/* Top Header with Hamburger + Filters */}
        <header className="border-b border-border bg-card/50 backdrop-blur-sm px-6 py-4 flex items-center gap-4 flex-shrink-0">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          
          <div className="flex-1 flex items-center justify-center gap-3">
            <ConversationFilters
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              priorityFilter={priorityFilter}
              setPriorityFilter={setPriorityFilter}
              channelFilter={channelFilter}
              setChannelFilter={setChannelFilter}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
            />
          </div>
        </header>

        {/* Two-Column Layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Column A: Ticket List (38-42%) */}
          <div className="w-[40%] border-r border-border bg-background overflow-y-auto">
            <div className="p-4">
              <ConversationList
                selectedId={selectedConversation?.id}
                onSelect={handleSelectConversation}
                filter={filter}
                key={refreshKey}
              />
            </div>
          </div>

          {/* Column B: Conversation Panel (58-62%) */}
          <div className="flex-1 bg-background overflow-hidden relative">
            {selectedConversation ? (
              <>
                {/* Conversation Panel - centered max-width */}
                <div className="h-full overflow-y-auto">
                  <div className="mx-auto max-w-[720px] px-6 py-6">
                    {/* Customer Info Button */}
                    <div className="flex justify-end mb-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCustomerPanelOpen(true)}
                        className="gap-2"
                      >
                        Customer Info
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Conversation Thread */}
                    <ConversationThread
                      conversation={selectedConversation}
                      onUpdate={handleUpdate}
                    />
                  </div>
                </div>

                {/* Column C: Customer Info Slide-Over Panel */}
                {customerPanelOpen && (
                  <>
                    {/* Backdrop */}
                    <div
                      className="absolute inset-0 bg-black/20 backdrop-blur-sm z-40 animate-fade-in"
                      onClick={() => setCustomerPanelOpen(false)}
                    />
                    
                    {/* Slide-over Panel */}
                    <div className="absolute top-0 right-0 h-full w-[35%] bg-card border-l border-border shadow-2xl z-50 animate-slide-in-right overflow-y-auto">
                      {/* Panel Header */}
                      <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between z-10">
                        <h3 className="font-semibold text-lg">Customer Info</h3>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setCustomerPanelOpen(false)}
                        >
                          <X className="h-5 w-5" />
                        </Button>
                      </div>

                      {/* Panel Content */}
                      <div className="p-6 space-y-6">
                        <CustomerContext 
                          conversation={selectedConversation} 
                          onUpdate={handleUpdate} 
                        />
                        
                        <div className="pt-4 border-t border-border">
                          <QuickActions 
                            conversation={selectedConversation}
                            onUpdate={handleUpdate}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <p className="text-lg">Select a ticket to view conversation</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
