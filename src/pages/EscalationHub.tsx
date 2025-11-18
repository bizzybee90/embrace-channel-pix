import { useState } from 'react';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { Conversation } from '@/lib/types';

interface EscalationHubProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const EscalationHub = ({ filter = 'all-open' }: EscalationHubProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleBack = () => {
    setSelectedConversation(null);
  };

  return (
    <ThreeColumnLayout
      sidebar={<Sidebar />}
      main={
        selectedConversation ? (
          <ConversationThread
            key={refreshKey}
            conversation={selectedConversation}
            onUpdate={handleUpdate}
            onBack={handleBack}
          />
        ) : (
          <ConversationList
            filter={filter}
            selectedId={selectedConversation?.id}
            onSelect={setSelectedConversation}
          />
        )
      }
      contextPanel={
        selectedConversation ? (
          <CustomerContext conversation={selectedConversation} />
        ) : (
          <div className="p-4 text-center text-muted-foreground">
            Select a conversation to view details
          </div>
        )
      }
    />
  );
};
