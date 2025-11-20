import { useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { QuickActions } from '@/components/conversations/QuickActions';
import { Conversation } from '@/lib/types';
import { Menu, ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface TabletLayoutProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const TabletLayout = ({ filter = 'all-open' }: TabletLayoutProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [customerInfoOpen, setCustomerInfoOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleSelectConversation = (conv: Conversation) => {
    setSelectedConversation(conv);
    // Auto-expand customer info and quick actions when conversation selected
    setCustomerInfoOpen(true);
    setQuickActionsOpen(true);
  };

  const handleBackToList = () => {
    setSelectedConversation(null);
  };

  // Ticket list view (full width)
  if (!selectedConversation) {
    return (
      <div className="flex h-screen w-full bg-background overflow-hidden">
        {/* Header with hamburger menu */}
        <div className="flex flex-col w-full">
          <header className="border-b border-border bg-card px-6 py-4 flex items-center gap-4">
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] p-0">
                <Sidebar />
              </SheetContent>
            </Sheet>
            <h1 className="text-xl font-semibold">
              {filter === 'my-tickets' && 'My Tickets'}
              {filter === 'unassigned' && 'Unassigned'}
              {filter === 'sla-risk' && 'SLA Risk'}
              {filter === 'all-open' && 'All Open'}
            </h1>
          </header>

          {/* Full-width ticket list */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <ConversationList
              selectedId={selectedConversation?.id}
              onSelect={handleSelectConversation}
              filter={filter}
              key={refreshKey}
            />
          </div>
        </div>
      </div>
    );
  }

  // Conversation view (full width with collapsible cards)
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <div className="flex flex-col w-full">
        {/* Header with back button */}
        <header className="border-b border-border bg-card px-6 py-4 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-10 w-10"
            onClick={handleBackToList}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold truncate flex-1">
            {selectedConversation.title}
          </h1>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* Collapsible Customer Info Card */}
          <Collapsible 
            open={customerInfoOpen} 
            onOpenChange={setCustomerInfoOpen}
            className="rounded-[24px] border border-border bg-card shadow-sm overflow-hidden"
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full flex items-center justify-between p-6 hover:bg-muted/50"
              >
                <span className="text-lg font-semibold">Customer Info</span>
                {customerInfoOpen ? (
                  <ChevronUp className="h-5 w-5" />
                ) : (
                  <ChevronDown className="h-5 w-5" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-6 pb-6">
              <CustomerContext 
                conversation={selectedConversation} 
                onUpdate={handleUpdate} 
              />
            </CollapsibleContent>
          </Collapsible>

          {/* Collapsible Quick Actions Card */}
          <Collapsible 
            open={quickActionsOpen} 
            onOpenChange={setQuickActionsOpen}
            className="rounded-[24px] border border-border bg-card shadow-sm overflow-hidden"
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full flex items-center justify-between p-6 hover:bg-muted/50"
              >
                <span className="text-lg font-semibold">Quick Actions</span>
                {quickActionsOpen ? (
                  <ChevronUp className="h-5 w-5" />
                ) : (
                  <ChevronDown className="h-5 w-5" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-6 pb-6">
              <QuickActions 
                conversation={selectedConversation}
                onUpdate={handleUpdate}
              />
            </CollapsibleContent>
          </Collapsible>

          {/* Conversation Thread */}
          <div className="rounded-[24px] border border-border bg-card shadow-sm overflow-hidden">
            <ConversationThread
              conversation={selectedConversation}
              onUpdate={handleUpdate}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
