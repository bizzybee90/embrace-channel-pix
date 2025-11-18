import { useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { Conversation } from '@/lib/types';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, MessageSquare, PanelLeftClose, PanelRightClose } from 'lucide-react';

interface PowerModeLayoutProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const PowerModeLayout = ({ filter = 'all-open' }: PowerModeLayoutProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isListCollapsed, setIsListCollapsed] = useState(false);
  const [isThreadCollapsed, setIsThreadCollapsed] = useState(false);
  const [isContextCollapsed, setIsContextCollapsed] = useState(false);

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
        {/* Conversation List Panel */}
        <ResizablePanel 
          defaultSize={25} 
          minSize={isListCollapsed ? 3 : 20}
          maxSize={isListCollapsed ? 3 : 35}
          collapsible={false}
        >
          {!isListCollapsed ? (
            <div className="h-full flex flex-col relative border-r border-border/30">
              <div className="absolute top-4 right-2 z-10">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsListCollapsed(true)}
                  className="h-8 w-8 bg-background/95 backdrop-blur"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </div>
              <ConversationList
                filter={filter}
                selectedId={selectedConversation?.id}
                onSelect={setSelectedConversation}
              />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center bg-muted/20 border-r border-border/30">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsListCollapsed(false)}
                className="h-8 w-8"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </ResizablePanel>

        <ResizableHandle className="w-1 bg-border/50 hover:bg-border transition-colors" />

        {/* Conversation Thread Panel */}
        <ResizablePanel 
          defaultSize={45} 
          minSize={isThreadCollapsed ? 3 : 30}
          maxSize={isThreadCollapsed ? 3 : 70}
          collapsible={false}
        >
          {!isThreadCollapsed ? (
            <div className="h-full flex flex-col relative border-r border-border/30">
              {selectedConversation && (
                <div className="absolute top-4 right-2 z-10">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsThreadCollapsed(true)}
                    className="h-8 w-8 bg-background/95 backdrop-blur"
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </Button>
                </div>
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
          ) : (
            <div className="h-full flex items-center justify-center bg-muted/20 border-r border-border/30">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsThreadCollapsed(false)}
                className="h-8 w-8"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          )}
        </ResizablePanel>

        <ResizableHandle className="w-1 bg-border/50 hover:bg-border transition-colors" />

        {/* Customer Context Panel */}
        <ResizablePanel 
          defaultSize={30} 
          minSize={isContextCollapsed ? 3 : 25}
          maxSize={isContextCollapsed ? 3 : 40}
          collapsible={false}
        >
          {!isContextCollapsed ? (
            <div className="h-full flex flex-col relative">
              {selectedConversation && (
                <div className="absolute top-4 left-2 z-10">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsContextCollapsed(true)}
                    className="h-8 w-8 bg-background/95 backdrop-blur"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <div className="h-full overflow-y-auto bg-card p-4">
                {selectedConversation ? (
                  <CustomerContext conversation={selectedConversation} onUpdate={handleUpdate} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
                    <p className="text-center">Customer details will appear here when you select a conversation</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center bg-muted/20">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsContextCollapsed(false)}
                className="h-8 w-8"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
