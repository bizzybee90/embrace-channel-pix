/**
 * TabletLayout - Two-state layout for tablet devices (760-1199px)
 *
 * STATE 1 (List View):
 * - Collapsed sidebar (72px) + Full-width ticket list
 * - Shows when: selectedConversation === null
 *
 * STATE 2 (Conversation View):
 * - Collapsed sidebar (72px) + Full-width conversation workspace
 * - Shows when: selectedConversation !== null
 *
 * CRITICAL: Do not add third column. Customer Info/Actions use slide-over drawer.
 *
 * @breakpoints 760px - 1199px
 * @states list | conversation
 */

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ConversationList } from "@/components/conversations/ConversationList";
import { MobileConversationView } from "@/components/conversations/mobile/MobileConversationView";
import { Conversation, Message } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { useHaptics } from "@/hooks/useHaptics";
import { useTabletLayoutValidator } from "@/hooks/useTabletLayoutValidator";

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
    | "triaged";
}

export const TabletLayout = ({ filter = "all-open" }: TabletLayoutProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const { trigger } = useHaptics();

  // Layout validation (dev mode only)
  useTabletLayoutValidator();

  const handleUpdate = async () => {
    setRefreshKey((prev) => prev + 1);
    
    if (selectedConversation) {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', selectedConversation.id)
        .order('created_at', { ascending: true });
      
      if (data) {
        setMessages(data as Message[]);
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
      setMessages(data as Message[]);
    }
  };

  const handleBackToList = () => {
    setSelectedConversation(null);
    setMessages([]);
    trigger("light");
  };

  const getFilterTitle = () => {
    switch (filter) {
      case "my-tickets":
        return "My Tickets";
      case "unassigned":
        return "Unassigned";
      case "sla-risk":
        return "SLA Risk";
      case "all-open":
        return "All Open";
      case "completed":
        return "Completed";
      case "high-priority":
        return "High Priority";
      case "vip-customers":
        return "VIP Customers";
      case "escalations":
        return "Escalations";
      default:
        return "Conversations";
    }
  };

  // Two-state tablet layout
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar - with data attribute for layout validator */}
      <div data-sidebar className="flex-shrink-0 border-r border-border/40 bg-card shadow-sm">
        <Sidebar onNavigate={handleBackToList} />
      </div>

      {/* Main Content Area - with data attribute for layout validator */}
      <div data-main-content className="flex-1 flex flex-col min-h-0 min-w-0 relative h-full">
        {!selectedConversation ? (
          // STATE 1: Ticket List View
          <div className="flex flex-col h-full min-h-0 animate-slide-in-left">
            {/* Header */}
            <div className="px-4 md:px-8 py-6 border-b border-border/30 bg-card/50 backdrop-blur-sm">
              <h1 className="text-2xl font-bold text-foreground mb-1 truncate">{getFilterTitle()}</h1>
              <p className="text-sm text-muted-foreground">Support escalations</p>
            </div>

            {/* Ticket List - Full Width */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-6">
              <ConversationList
                selectedId={selectedConversation?.id}
                onSelect={handleSelectConversation}
                filter={filter}
                key={refreshKey}
              />
            </div>
          </div>
        ) : (
          // STATE 2: Conversation View - Using MobileConversationView pattern for reliable scrolling
          <MobileConversationView
            conversation={selectedConversation}
            messages={messages}
            onBack={handleBackToList}
            onUpdate={handleUpdate}
          />
        )}
      </div>
    </div>
  );
};
