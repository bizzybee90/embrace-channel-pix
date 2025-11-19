import { useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { Conversation } from '@/lib/types';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { MessageSquare } from 'lucide-react';

interface PowerModeLayoutProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const PowerModeLayout = ({ filter = 'all-open' }: PowerModeLayoutProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar - width controlled by Sidebar component itself */}
      <aside className="border-r border-border bg-card flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Main Content - 3 Column Layout */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Conversation List Panel */}
        <ResizablePanel 
          defaultSize={20} 
          minSize={18}
          maxSize={30}
          collapsible={false}
        >
          <div className="h-full flex flex-col border-r border-border/30 bg-card">
            <ConversationList
              filter={filter}
              selectedId={selectedConversation?.id}
              onSelect={setSelectedConversation}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle className="w-1 bg-border/50 hover:bg-border transition-colors" />

        {/* Conversation Thread Panel */}
        <ResizablePanel 
          defaultSize={52} 
          minSize={35}
          maxSize={70}
          collapsible={false}
        >
          <div className="h-full flex flex-col relative border-r border-border/30">
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

        <ResizableHandle className="w-1 bg-border/50 hover:bg-border transition-colors" />

        {/* Customer Context Panel */}
        <ResizablePanel 
          defaultSize={28} 
          minSize={20}
          maxSize={35}
          collapsible={false}
        >
          <div className="h-full overflow-y-auto bg-card/50 p-4">
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
