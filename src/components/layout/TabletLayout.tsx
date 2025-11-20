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
import { ConversationFilters } from '@/components/conversations/ConversationFilters';

interface TabletLayoutProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const TabletLayout = ({ filter = 'all-open' }: TabletLayoutProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerContent, setDrawerContent] = useState<'customer' | 'actions'>('customer');
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

  const openDrawer = (content: 'customer' | 'actions') => {
    setDrawerContent(content);
    setDrawerOpen(true);
  };

  // Tablet 2-column layout: Ticket List (left, 30-35%) + Conversation Panel (right, 65-70%)
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Hamburger Sidebar Drawer */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[55%] p-0 backdrop-blur-sm">
          <Sidebar />
        </SheetContent>
      </Sheet>

      {/* Right Drawer for Customer Info / Quick Actions */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="w-[350px] p-6 overflow-y-auto">
          {drawerContent === 'customer' ? (
            <>
              <h2 className="text-lg font-semibold mb-4">Customer Information</h2>
              <CustomerContext 
                conversation={selectedConversation!} 
                onUpdate={handleUpdate} 
              />
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
              <QuickActions 
                conversation={selectedConversation!}
                onUpdate={handleUpdate}
              />
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Main Container */}
      <div className="flex flex-col w-full h-full">
        {/* Top Header with Hamburger Only */}
        <header className="border-b border-border bg-card/50 backdrop-blur-sm px-6 py-4 flex items-center gap-4 flex-shrink-0">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
        </header>

        {/* Two-Column Layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Column: Ticket List (40%) */}
          <div className="w-[40%] border-r border-border bg-background overflow-y-auto">
            <div className="p-3">
              <ConversationList
                selectedId={selectedConversation?.id}
                onSelect={handleSelectConversation}
                filter={filter}
                key={refreshKey}
              />
            </div>
          </div>

          {/* Right Column: Conversation Panel (65-70%) */}
          <div className="flex-1 bg-background flex flex-col overflow-hidden">
            {selectedConversation ? (
              <>
                {/* Conversation Header with Action Buttons */}
                <div className="border-b border-border bg-card/30 backdrop-blur-sm px-6 py-3 flex items-center justify-between flex-shrink-0">
                  <h1 className="text-lg font-semibold truncate">{selectedConversation.title}</h1>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openDrawer('customer')}
                      className="rounded-full bg-background/60 backdrop-blur-sm hover:bg-background/80"
                    >
                      <User className="h-4 w-4 mr-2" />
                      Customer Info
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openDrawer('actions')}
                      className="rounded-full bg-background/60 backdrop-blur-sm hover:bg-background/80"
                    >
                      <Zap className="h-4 w-4 mr-2" />
                      Quick Actions
                    </Button>
                  </div>
                </div>

                {/* Conversation Content - Scrollable with Desktop Styling */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <ConversationThread
                    conversation={selectedConversation}
                    onUpdate={handleUpdate}
                  />
                </div>
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
