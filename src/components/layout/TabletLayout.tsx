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
          {/* Left Column: Ticket List (38%) - Fixed width, no movement */}
          <div className="w-[38%] min-w-[38%] max-w-[38%] border-r border-border bg-background flex flex-col">
            {/* Sticky Header */}
            <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border/30 px-4 py-3 shadow-sm">
              <h2 className="font-semibold text-sm text-muted-foreground">
                {filter === 'my-tickets' ? 'My Tickets' : filter === 'unassigned' ? 'Unassigned' : filter === 'sla-risk' ? 'SLA Risk' : 'All Open Tickets'}
              </h2>
            </div>
            
            {/* Scrollable List */}
            <div className="flex-1 overflow-y-auto p-3">
              <ConversationList
                selectedId={selectedConversation?.id}
                onSelect={handleSelectConversation}
                filter={filter}
                key={refreshKey}
              />
            </div>
          </div>

          {/* Right Column: Conversation Panel (65%) */}
          <div className="flex-1 bg-background flex flex-col overflow-hidden">
            {selectedConversation ? (
              <>
                {/* Premium Header Block */}
                <div className="bg-card shadow-sm border-b border-border/30 flex-shrink-0">
                  {/* Title + Badges Row */}
                  <div className="px-6 py-4 flex items-center justify-between">
                    <h1 className="text-xl font-semibold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">{selectedConversation.title}</h1>
                    <div className="flex items-center gap-2">
                      {selectedConversation.sla_due_at && (
                        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                          new Date() > new Date(selectedConversation.sla_due_at)
                            ? 'bg-destructive/10 text-destructive border border-destructive/20'
                            : 'bg-success/10 text-success border border-success/20'
                        }`}>
                          {new Date() > new Date(selectedConversation.sla_due_at) ? 'Overdue' : 'On Time'}
                        </div>
                      )}
                      {selectedConversation.priority && (
                        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                          selectedConversation.priority === 'high'
                            ? 'bg-destructive/10 text-destructive border border-destructive/20'
                            : selectedConversation.priority === 'medium'
                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                            : 'bg-success/10 text-success border border-success/20'
                        }`}>
                          {selectedConversation.priority === 'high' ? '🔴' : selectedConversation.priority === 'medium' ? '🟡' : '🟢'} {selectedConversation.priority}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Segmented Control Bar */}
                  <div className="px-6 pb-3 flex items-center">
                    <div className="inline-flex w-full bg-muted/40 rounded-lg p-1 border border-border/50">
                      <button
                        onClick={() => openDrawer('customer')}
                        className={`flex-1 px-4 py-2.5 rounded-md text-sm font-medium transition-all duration-200 ${
                          drawerContent === 'customer' && drawerOpen
                            ? 'bg-card shadow-sm text-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                        }`}
                      >
                        <User className="h-4 w-4 inline mr-2" />
                        Customer Info
                      </button>
                      <button
                        onClick={() => openDrawer('actions')}
                        className={`flex-1 px-4 py-2.5 rounded-md text-sm font-medium transition-all duration-200 ${
                          drawerContent === 'actions' && drawerOpen
                            ? 'bg-card shadow-sm text-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                        }`}
                      >
                        <Zap className="h-4 w-4 inline mr-2" />
                        Quick Actions
                      </button>
                    </div>
                  </div>

                  {/* Subtle Divider */}
                  <div className="h-px bg-gradient-to-r from-transparent via-border/50 to-transparent" />
                </div>

                {/* Conversation Content - Scrollable */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
