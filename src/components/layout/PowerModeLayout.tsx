import { useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { Conversation } from '@/lib/types';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react';

interface PowerModeLayoutProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const PowerModeLayout = ({ filter = 'all-open' }: PowerModeLayoutProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isListCollapsed, setIsListCollapsed] = useState(false);

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 border-r border-border bg-card flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Main Content - 3 Column Layout */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Conversation List - Collapsible */}
        {!isListCollapsed && (
          <>
            <ResizablePanel defaultSize={30} minSize={20} maxSize={40}>
              <ConversationList
                filter={filter}
                selectedId={selectedConversation?.id}
                onSelect={setSelectedConversation}
              />
            </ResizablePanel>
            <ResizableHandle withHandle className="bg-border hover:bg-primary/20 transition-colors" />
          </>
        )}

        {/* Collapse/Expand Button */}
        <div className="relative">
          {isListCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 left-2 z-10 h-8 w-8"
              onClick={() => setIsListCollapsed(false)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Conversation Thread */}
        <ResizablePanel defaultSize={isListCollapsed ? 55 : 45} minSize={30}>
          <div className="h-full flex flex-col border-r border-border">
            {!isListCollapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 left-4 z-10 h-8 w-8 bg-background/95 backdrop-blur border border-border"
                onClick={() => setIsListCollapsed(true)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            
            {selectedConversation ? (
              <ConversationThread
                key={refreshKey}
                conversation={selectedConversation}
                onUpdate={handleUpdate}
                onBack={() => setSelectedConversation(null)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground bg-muted/20">
                <MessageSquare className="h-12 w-12 mb-4 opacity-20" />
                <p className="text-lg font-medium">No conversation selected</p>
                <p className="text-sm mt-1">Choose a conversation from the list to get started</p>
              </div>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle className="bg-border hover:bg-primary/20 transition-colors" />

        {/* Customer Context */}
        <ResizablePanel defaultSize={25} minSize={20} maxSize={35}>
          <div className="h-full overflow-y-auto bg-card p-4">
            {selectedConversation ? (
              <CustomerContext conversation={selectedConversation} onUpdate={handleUpdate} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
                <p className="text-center">Customer details will appear here when you select a conversation</p>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
