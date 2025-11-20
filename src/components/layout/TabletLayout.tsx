import { ReactNode, useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { QuickActions } from '@/components/conversations/QuickActions';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Conversation } from '@/lib/types';

interface TabletLayoutProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const TabletLayout = ({ filter = 'all-open' }: TabletLayoutProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar - collapses to icon-only on tablet */}
      <aside className="border-r border-border bg-card flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Two-column main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column - Ticket List (40-45% width) */}
        <div className="w-[42%] border-r border-border bg-card overflow-y-auto">
          <ConversationList
            selectedId={selectedConversation?.id}
            onSelect={setSelectedConversation}
            filter={filter}
            key={refreshKey}
          />
        </div>

        {/* Right Column - Workspace Panel (55-60% width) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedConversation ? (
            <>
              {/* Top - Customer Info Panel (25% height) */}
              <div className="h-[25%] border-b border-border bg-background overflow-y-auto p-4">
                <div className="flex gap-4 items-start">
                  {/* Customer Info Card - Horizontal Layout */}
                  <div className="flex-1">
                    <CustomerContext conversation={selectedConversation} onUpdate={handleUpdate} />
                  </div>
                  
                  {/* Quick Actions - Compact */}
                  <div className="w-64 flex-shrink-0">
                    <QuickActions 
                      conversation={selectedConversation}
                      onUpdate={handleUpdate}
                    />
                  </div>
                </div>
              </div>

              {/* Bottom - Conversation Panel (75% height) */}
              <div className="flex-1 overflow-hidden">
                <ConversationThread
                  conversation={selectedConversation}
                  onUpdate={handleUpdate}
                />
              </div>
            </>
          ) : (
            /* No selection placeholder */
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center space-y-2">
                <p className="text-lg font-medium">Select a conversation</p>
                <p className="text-sm">Choose a ticket from the list to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
