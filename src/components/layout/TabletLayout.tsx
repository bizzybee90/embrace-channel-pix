import { useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { QuickActions } from '@/components/conversations/QuickActions';
import { Conversation } from '@/lib/types';
import { Menu, User, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConversationFilters } from '@/components/conversations/ConversationFilters';

interface TabletLayoutProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const TabletLayout = ({ filter = 'all-open' }: TabletLayoutProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [actionsDialogOpen, setActionsDialogOpen] = useState(false);
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

          {/* Column B: Conversation Panel (center, max-width 720px) */}
          <div className="flex-1 bg-background overflow-hidden relative">
            {selectedConversation ? (
              <>
                <div className="h-full overflow-y-auto pb-20">
                  <div className="mx-auto max-w-[720px] px-6 py-6">
                    <ConversationThread
                      conversation={selectedConversation}
                      onUpdate={handleUpdate}
                    />
                  </div>
                </div>

                {/* Floating Action Buttons - Bottom Right */}
                <div className="fixed bottom-8 right-8 flex flex-col gap-3 z-50">
                  <Button
                    onClick={() => setCustomerDialogOpen(true)}
                    className="shadow-lg hover:shadow-xl transition-all rounded-full h-14 px-6 bg-primary text-primary-foreground"
                  >
                    <User className="h-5 w-5 mr-2" />
                    Customer Info
                  </Button>
                  <Button
                    onClick={() => setActionsDialogOpen(true)}
                    className="shadow-lg hover:shadow-xl transition-all rounded-full h-14 px-6 bg-secondary text-secondary-foreground"
                  >
                    <Zap className="h-5 w-5 mr-2" />
                    Quick Actions
                  </Button>
                </div>

                {/* Customer Info Dialog */}
                <Dialog open={customerDialogOpen} onOpenChange={setCustomerDialogOpen}>
                  <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Customer Information</DialogTitle>
                    </DialogHeader>
                    <CustomerContext 
                      conversation={selectedConversation} 
                      onUpdate={handleUpdate} 
                    />
                  </DialogContent>
                </Dialog>

                {/* Quick Actions Dialog */}
                <Dialog open={actionsDialogOpen} onOpenChange={setActionsDialogOpen}>
                  <DialogContent className="max-w-xl">
                    <DialogHeader>
                      <DialogTitle>Quick Actions</DialogTitle>
                    </DialogHeader>
                    <QuickActions 
                      conversation={selectedConversation}
                      onUpdate={handleUpdate}
                    />
                  </DialogContent>
                </Dialog>
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
