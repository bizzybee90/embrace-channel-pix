import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { JaceStyleInbox } from '@/components/conversations/JaceStyleInbox';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { CustomerContext } from '@/components/context/CustomerContext';
import { Conversation } from '@/lib/types';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

interface InboxContentProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'awaiting-reply' | 'completed' | 'sent' | 'high-priority' | 'vip-customers' | 'escalations' | 'triaged' | 'needs-me' | 'snoozed' | 'cleared' | 'fyi' | 'unread' | 'drafts-ready';
  channelFilter?: string;
}

export const InboxContent = ({ filter = 'all-open', channelFilter }: InboxContentProps) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [customerPanelOpen, setCustomerPanelOpen] = useState(false);

  // Clear selected conversation when filter changes
  useEffect(() => {
    setSelectedConversation(null);
    setCustomerPanelOpen(false);
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('conversation');
    setSearchParams(newParams, { replace: true });
  }, [filter, channelFilter]);

  // Handle conversation query parameter
  useEffect(() => {
    const conversationId = searchParams.get('conversation');
    if (conversationId && !selectedConversation) {
      const fetchConversation = async () => {
        const { data } = await supabase
          .from('conversations')
          .select('*, customer:customers(*), assigned_user:users!conversations_assigned_to_fkey(*)')
          .eq('id', conversationId)
          .single();
        if (data) setSelectedConversation(data as Conversation);
      };
      fetchConversation();
    }
  }, [searchParams, selectedConversation]);

  const handleUpdate = () => setRefreshKey(prev => prev + 1);

  const handleSelectConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    const newParams = new URLSearchParams(searchParams);
    newParams.set('conversation', conversation.id);
    setSearchParams(newParams, { replace: true });
  };

  const handleBack = () => {
    setSelectedConversation(null);
    setCustomerPanelOpen(false);
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('conversation');
    setSearchParams(newParams, { replace: true });
  };

  if (!selectedConversation) {
    return (
      <div className="flex-1 flex overflow-hidden gap-4 p-4 h-full">
        <div className="w-[350px] min-w-[350px] flex-shrink-0 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <JaceStyleInbox
            filter={filter}
            selectedId={selectedConversation?.id}
            onSelect={handleSelectConversation}
            hideHeader
          />
        </div>
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col items-center justify-center">
          <div className="text-center text-muted-foreground">
            <p className="text-sm font-medium text-foreground/60">Select a conversation</p>
            <p className="text-xs text-muted-foreground/50 mt-1">Choose from the list to get started</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 flex overflow-hidden gap-4 p-4 h-full">
        <div className="w-[350px] min-w-[350px] flex-shrink-0 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <JaceStyleInbox
            filter={filter}
            selectedId={selectedConversation?.id}
            onSelect={handleSelectConversation}
            hideHeader
          />
        </div>
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col relative">
          <ConversationThread
            key={refreshKey}
            conversation={selectedConversation}
            onUpdate={handleUpdate}
            onBack={handleBack}
            hideBackButton={false}
          />
        </div>
      </div>

      {/* Customer Info Overlay Drawer */}
      {customerPanelOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40 transition-opacity"
            onClick={() => setCustomerPanelOpen(false)}
          />
          <div className="fixed top-0 right-0 h-full w-[380px] max-w-[90vw] z-50 bg-card shadow-2xl border-l border-border/50 flex flex-col animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <span className="text-sm font-medium text-muted-foreground">Customer Info</span>
              <Button variant="ghost" size="icon" onClick={() => setCustomerPanelOpen(false)} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <CustomerContext conversation={selectedConversation} onUpdate={handleUpdate} />
            </div>
          </div>
        </>
      )}
    </>
  );
};
