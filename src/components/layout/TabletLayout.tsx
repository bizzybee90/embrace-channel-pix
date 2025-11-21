import { useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { TabletCustomerInfoPanel } from '@/components/conversations/TabletCustomerInfoPanel';
import { TabletQuickActionsPanel } from '@/components/conversations/TabletQuickActionsPanel';
import { TabletFilters } from '@/components/conversations/TabletFilters';
import { Conversation } from '@/lib/types';
import { Menu, User, Zap, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { SLABadge } from '@/components/sla/SLABadge';
import { Badge } from '@/components/ui/badge';
import { useIsTablet } from '@/hooks/use-tablet';
import { formatDistanceToNow } from 'date-fns';

interface TabletLayoutProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const TabletLayout = ({ filter = 'all-open' }: TabletLayoutProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [channelFilter, setChannelFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'customer' | 'actions' | null>(null);
  const isTablet = useIsTablet();
  
  // Determine if we're in compact (768-899) or wide (900-1199) tablet mode
  const isWideTablet = typeof window !== 'undefined' && window.innerWidth >= 900 && window.innerWidth < 1200;

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleSelectConversation = (conv: Conversation) => {
    setSelectedConversation(conv);
  };

  const toggleTab = (tab: 'customer' | 'actions') => {
    setActiveTab(activeTab === tab ? null : tab);
  };

  const getFilterTitle = () => {
    switch (filter) {
      case 'my-tickets': return 'My Tickets';
      case 'unassigned': return 'Unassigned';
      case 'sla-risk': return 'SLA Risk';
      case 'all-open': return 'All Open';
      default: return 'Conversations';
    }
  };

  const getCustomerPreview = (conv: Conversation) => {
    const parts = [];
    if (conv.metadata?.customer_name) parts.push(conv.metadata.customer_name as string);
    if (conv.channel) parts.push(`Prefers ${conv.channel}`);
    if (conv.metadata?.customer_tier) parts.push(`${conv.metadata.customer_tier} Customer`);
    return parts.join(' · ') || 'No customer info';
  };

  // Tablet layout with responsive breakpoints
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar Overlay (hamburger menu) */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[280px] p-0">
          <Sidebar />
        </SheetContent>
      </Sheet>

      {/* Main Container */}
      <div className="flex w-full h-full">
        {/* Desktop Sidebar - Always visible in tablet mode */}
        <Sidebar />

        {/* Content Wrapper */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Top Bar with Filters */}
          <div className="border-b border-border/30 bg-card/50 backdrop-blur-sm flex-shrink-0 sticky top-0 z-20">
            <div className="px-4 py-3 flex items-center gap-4">
              <h2 className="font-semibold text-foreground">{getFilterTitle()}</h2>
            </div>
            
            {/* Horizontal Filter Bar - Sticky */}
            <div className="px-4 pb-3 overflow-x-auto">
              <TabletFilters
                statusFilter={statusFilter}
                priorityFilter={priorityFilter}
                channelFilter={channelFilter}
                categoryFilter={categoryFilter}
                onStatusChange={setStatusFilter}
                onPriorityChange={setPriorityFilter}
                onChannelChange={setChannelFilter}
                onCategoryChange={setCategoryFilter}
              />
            </div>
          </div>

          {/* Two/Three Column Layout */}
          <div className="flex flex-1 overflow-hidden">
            {/* Ticket List Column */}
            <div className="w-[35%] border-r border-border/30 bg-background flex flex-col flex-shrink-0">
            <div className="flex-1 overflow-y-auto px-3 py-4">
                <ConversationList
                  selectedId={selectedConversation?.id}
                  onSelect={handleSelectConversation}
                  filter={filter}
                  key={refreshKey}
                />
              </div>
            </div>

            {/* Conversation Panel */}
            <div className="flex-1 bg-background flex flex-col overflow-hidden min-w-0">
              {selectedConversation ? (
                <>
                  {/* Sticky Conversation Header */}
                  <div className="sticky top-0 z-10 bg-gradient-to-b from-card to-card/80 backdrop-blur-md border-b border-border/30 shadow-sm flex-shrink-0">
                    {/* Title Row */}
                    <div className="px-6 py-4">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <h1 className="text-lg md:text-xl font-bold leading-tight flex-1 min-w-0">
                          {selectedConversation.title}
                        </h1>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {selectedConversation.sla_due_at && (
                            <SLABadge 
                              conversation={selectedConversation}
                            />
                          )}
                          {selectedConversation.priority && (
                            <Badge variant={`priority-${selectedConversation.priority}` as any}>
                              {selectedConversation.priority === 'high' ? '🔴' : selectedConversation.priority === 'medium' ? '🟡' : '🟢'}
                              {selectedConversation.priority}
                            </Badge>
                          )}
                        </div>
                      </div>
                      
                      {/* Customer Preview Strip */}
                      <p className="text-xs text-muted-foreground truncate">
                        {getCustomerPreview(selectedConversation)}
                      </p>
                    </div>

                    {/* Tab Bar */}
                    <div className="px-6 pb-3">
                      <div className="inline-flex w-full bg-gradient-to-r from-primary/5 to-accent/5 rounded-xl p-1 border border-border/50 shadow-sm">
                        <button
                          onClick={() => toggleTab('customer')}
                          className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                            activeTab === 'customer'
                              ? 'bg-card shadow-md text-primary'
                              : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                          }`}
                        >
                          <User className="h-4 w-4 inline mr-2" />
                          Customer Info
                        </button>
                        <button
                          onClick={() => toggleTab('actions')}
                          className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                            activeTab === 'actions'
                              ? 'bg-card shadow-md text-primary'
                              : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                          }`}
                        >
                          <Zap className="h-4 w-4 inline mr-2" />
                          Quick Actions
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Tab Content Panels */}
                  <TabletCustomerInfoPanel 
                    conversation={selectedConversation} 
                    isOpen={activeTab === 'customer'}
                  />
                  <TabletQuickActionsPanel
                    conversation={selectedConversation}
                    onUpdate={handleUpdate}
                    isOpen={activeTab === 'actions'}
                  />

                  {/* Conversation Thread - Scrollable */}
                  <div className="flex-1 overflow-y-auto">
                    <ConversationThread
                      conversation={selectedConversation}
                      onUpdate={handleUpdate}
                    />
                  </div>
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
                  <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                    <Inbox className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                  <p className="text-lg font-medium">No conversation selected</p>
                  <p className="text-sm text-muted-foreground/70 mt-1">Select a ticket from the list to view</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
