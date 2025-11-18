import { useState } from 'react';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { Conversation } from '@/lib/types';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface EscalationHubProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const EscalationHub = ({ filter = 'all-open' }: EscalationHubProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleClose = () => {
    setSelectedConversation(null);
  };

  return (
    <>
      <ThreeColumnLayout
        sidebar={<Sidebar />}
        main={
          <ConversationList
            filter={filter}
            selectedId={selectedConversation?.id}
            onSelect={setSelectedConversation}
          />
        }
      />
      
      <Dialog open={!!selectedConversation} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-[90vw] h-[90vh] p-0 overflow-hidden flex gap-0">
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedConversation && (
              <ConversationThread
                key={refreshKey}
                conversation={selectedConversation}
                onUpdate={handleUpdate}
                onBack={handleClose}
              />
            )}
          </div>
          <div className="w-80 border-l border-border overflow-y-auto bg-card">
            {selectedConversation && (
              <CustomerContext conversation={selectedConversation} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
