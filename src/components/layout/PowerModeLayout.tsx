import { useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { Conversation } from '@/lib/types';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { MessageSquare } from 'lucide-react';

interface PowerModeLayoutProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'awaiting-reply' | 'completed' | 'sent' | 'high-priority' | 'vip-customers' | 'escalations';
  channelFilter?: string;
}

export const PowerModeLayout = ({ filter = 'all-open', channelFilter }: PowerModeLayoutProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar - width controlled by Sidebar component itself (hidden on mobile) */}
      <aside className="hidden md:flex border-r border-border bg-card flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Main Content - 3 Column Layout (responsive) */}
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 h-full overflow-hidden">
        {/* Conversation List Panel (hidden on mobile when conversation selected) */}
        <ResizablePanel 
          defaultSize={20} 
          minSize={15}
          maxSize={30}
          collapsible={false}
          className={selectedConversation ? "hidden md:flex min-h-0" : "flex min-h-0"}
        >
          <div className="flex-1 flex flex-col border-r border-border/30 bg-card w-full overflow-hidden min-w-0 overflow-x-hidden">
            <ConversationList
              filter={filter}
              channelFilter={channelFilter}
              selectedId={selectedConversation?.id}
              onSelect={setSelectedConversation}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle className="w-1 bg-border/50 hover:bg-border transition-colors hidden md:block" />

        {/* Conversation Thread Panel (full width on mobile when selected) */}
        <ResizablePanel 
          defaultSize={55} 
          minSize={40}
          maxSize={70}
          collapsible={false}
          className="w-full min-h-0 flex flex-col h-full min-w-0"
        >
          <div className="h-full w-full min-h-0 overflow-hidden min-w-0">
            {selectedConversation ? (
              <ConversationThread
                key={refreshKey}
                conversation={selectedConversation}
                onUpdate={handleUpdate}
                onBack={() => setSelectedConversation(null)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground bg-muted/10">
                <MessageSquare className="h-16 w-16 mb-4 opacity-10" />
                <p className="text-lg font-medium">No conversation selected</p>
                <p className="text-sm mt-1 opacity-75">Choose a conversation from the list to get started</p>
              </div>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle className="w-1 bg-border/50 hover:bg-border transition-colors hidden md:block" />

        {/* Customer Context Panel (hidden on mobile) */}
        <ResizablePanel 
          defaultSize={25} 
          minSize={20}
          maxSize={30}
          collapsible={false}
          className="hidden md:flex min-h-0"
        >
          <div className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden bg-card/50 p-4 hidden md:flex min-w-0">
            {selectedConversation ? (
              <CustomerContext conversation={selectedConversation} onUpdate={handleUpdate} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm opacity-60">
                <p className="text-center">Customer details will appear here when you select a conversation</p>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
