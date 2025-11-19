import { useState } from 'react';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { PowerModeLayout } from '@/components/layout/PowerModeLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { QuickActions } from '@/components/conversations/QuickActions';
import { MobileQuickActions } from '@/components/conversations/MobileQuickActions';
import { Conversation } from '@/lib/types';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useInterfaceMode } from '@/hooks/useInterfaceMode';
import { useSLANotifications } from '@/hooks/useSLANotifications';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface EscalationHubProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const EscalationHub = ({ filter = 'all-open' }: EscalationHubProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [modalWidth, setModalWidth] = useState(75);
  const { interfaceMode, loading: modeLoading } = useInterfaceMode();
  const { toast } = useToast();
  
  useSLANotifications();

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleClose = () => {
    setSelectedConversation(null);
  };

  const navigateConversation = (direction: 'prev' | 'next') => {
    if (!selectedConversation || conversations.length === 0) return;
    
    const currentIndex = conversations.findIndex(c => c.id === selectedConversation.id);
    if (currentIndex === -1) return;

    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < conversations.length) {
      setSelectedConversation(conversations[newIndex]);
      setRefreshKey(prev => prev + 1);
    }
  };

  const getCurrentPosition = () => {
    if (!selectedConversation || conversations.length === 0) return { current: 0, total: 0 };
    const current = conversations.findIndex(c => c.id === selectedConversation.id) + 1;
    return { current, total: conversations.length };
  };

  const handleAssignToMe = async () => {
    if (!selectedConversation) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('conversations')
      .update({ assigned_to: user.id })
      .eq('id', selectedConversation.id);
    
    toast({ title: "Assigned to you" });
    handleUpdate();
  };

  const handleResolve = async () => {
    if (!selectedConversation) return;
    
    await supabase
      .from('conversations')
      .update({ 
        status: 'resolved',
        resolved_at: new Date().toISOString()
      })
      .eq('id', selectedConversation.id);
    
    toast({ title: "Resolved" });
    handleUpdate();
    handleClose();
  };

  const handlePriorityChange = async (priority: string) => {
    if (!selectedConversation) return;
    
    await supabase
      .from('conversations')
      .update({ priority })
      .eq('id', selectedConversation.id);
    
    handleUpdate();
  };

  // Keyboard shortcuts
  useKeyboardShortcuts([
    { key: 'Escape', callback: handleClose },
    { key: 'ArrowLeft', callback: () => navigateConversation('prev') },
    { key: 'ArrowRight', callback: () => navigateConversation('next') },
    { key: 'a', callback: handleAssignToMe },
    { key: 'r', callback: handleResolve },
    { key: '1', callback: () => handlePriorityChange('high') },
    { key: '2', callback: () => handlePriorityChange('medium') },
    { key: '3', callback: () => handlePriorityChange('low') },
  ], !!selectedConversation);

  // If Power Mode is selected, render the 3-column layout
  if (!modeLoading && interfaceMode === 'power') {
    return <PowerModeLayout filter={filter} />;
  }

  return (
    <>
      <ThreeColumnLayout
        sidebar={<Sidebar />}
        main={
          <ConversationList
            filter={filter}
            selectedId={selectedConversation?.id}
            onSelect={(conv) => {
              setSelectedConversation(conv);
              setRefreshKey(prev => prev + 1);
            }}
            onConversationsChange={setConversations}
          />
        }
      />
      
      {selectedConversation && (
        <div className="focus-mode-overlay animate-fade-in" onClick={handleClose} />
      )}
      
      <Dialog open={!!selectedConversation} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent 
          className="max-w-none h-[100vh] md:h-[90vh] min-h-0 p-0 gap-0 animate-scale-in z-50 w-full md:w-auto"
          style={{ width: window.innerWidth < 900 ? '100%' : `${modalWidth}%` }}
        >
          {/* Resize handle - left edge (hidden on mobile) */}
          <div 
            className="w-1 bg-border hover:bg-primary cursor-ew-resize flex-shrink-0 hidden md:block"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = modalWidth;

              const handleMouseMove = (e: MouseEvent) => {
                const deltaX = startX - e.clientX;
                const newWidth = Math.min(95, Math.max(60, startWidth + (deltaX / window.innerWidth) * 100));
                setModalWidth(newWidth);
              };

              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
              };

              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
            }}
          />

          {/* Navigation controls (hidden on mobile) */}
          {conversations.length > 1 && (
            <div className="absolute top-4 left-4 z-10 hidden md:flex items-center gap-2 bg-background/95 backdrop-blur rounded-lg p-1 border border-border">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => navigateConversation('prev')}
                disabled={getCurrentPosition().current <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground px-2">
                {getCurrentPosition().current} of {getCurrentPosition().total}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => navigateConversation('next')}
                disabled={getCurrentPosition().current >= getCurrentPosition().total}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="flex flex-1 h-full overflow-hidden flex-col md:flex-row">
            {/* Main Content - Conversation */}
            <div className="flex-1 flex flex-col overflow-hidden w-full md:w-auto">
              {selectedConversation && (
                <ConversationThread
                  key={refreshKey}
                  conversation={selectedConversation}
                  onUpdate={handleUpdate}
                  onBack={handleClose}
                />
              )}
            </div>
            
            {/* Right Sidebar - Customer Context & Quick Actions (hidden on mobile) */}
            <div className="hidden md:flex w-80 border-l border-border bg-card/50 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {selectedConversation && (
                  <CustomerContext conversation={selectedConversation} onUpdate={handleUpdate} />
                )}
              </div>
            </div>

            {/* Mobile Bottom Sheet for Quick Actions */}
            <div className="md:hidden">
              {selectedConversation && (
                <MobileQuickActions 
                  conversation={selectedConversation}
                  onUpdate={handleUpdate}
                  onClose={handleClose}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
