/**
 * TabletLayout - True Master-Detail split for tablet devices (760-1199px)
 *
 * THREE COLUMNS:
 * [Sidebar: icons-only ~80px] [List: fixed 320px] [Detail: flex-1]
 *
 * The list is always visible. Selecting a conversation loads it in the detail pane.
 *
 * @breakpoints 760px - 1199px
 */

import { useState } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { JaceStyleInbox } from "@/components/conversations/JaceStyleInbox";
import { ConversationThread } from "@/components/conversations/ConversationThread";
import { Conversation, Message } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { useHaptics } from "@/hooks/useHaptics";
import { useTabletLayoutValidator } from "@/hooks/useTabletLayoutValidator";
import { Sparkles } from "lucide-react";

interface TabletLayoutProps {
  filter?:
    | "my-tickets"
    | "unassigned"
    | "sla-risk"
    | "all-open"
    | "awaiting-reply"
    | "completed"
    | "sent"
    | "high-priority"
    | "vip-customers"
    | "escalations"
    | "triaged"
    | "needs-me"
    | "snoozed"
    | "cleared"
    | "fyi"
    | "unread"
    | "drafts-ready";
}

export const TabletLayout = ({ filter = "all-open" }: TabletLayoutProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const { trigger } = useHaptics();

  // Layout validation (dev mode only)
  useTabletLayoutValidator();

  const handleUpdate = async () => {
    if (selectedConversation) {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', selectedConversation.id)
        .order('created_at', { ascending: true });

      if (data) {
        setMessages(data as unknown as Message[]);
      }
    }
  };

  const handleSelectConversation = async (conv: Conversation) => {
    setSelectedConversation(conv);
    trigger("medium");

    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });

    if (data) {
      setMessages(data as unknown as Message[]);
    }
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Column 1: Collapsed sidebar (icons only) */}
      <div data-sidebar className="flex-shrink-0 border-r border-border/20 bg-card z-10">
        <Sidebar forceCollapsed onNavigate={() => setSelectedConversation(null)} />
      </div>

      {/* Column 2: Master list (fixed width) */}
      <div className="w-[320px] flex-shrink-0 border-r border-border/20 flex flex-col min-h-0 overflow-hidden">
        <JaceStyleInbox
          onSelect={handleSelectConversation}
          selectedId={selectedConversation?.id}
          filter={filter}
        />
      </div>

      {/* Column 3: Detail pane (fluid) */}
      <div data-main-content className="flex-1 flex flex-col min-h-0 min-w-0 relative h-full">
        {selectedConversation ? (
          <ConversationThread
            conversation={selectedConversation}
            onBack={() => setSelectedConversation(null)}
            onUpdate={handleUpdate}
            hideBackButton={true}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
            <div className="h-14 w-14 rounded-2xl bg-muted/30 flex items-center justify-center">
              <Sparkles className="h-7 w-7 text-muted-foreground/30" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground/60">Select a conversation</p>
              <p className="text-xs text-muted-foreground/50 mt-1">Choose from the list to get started</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};