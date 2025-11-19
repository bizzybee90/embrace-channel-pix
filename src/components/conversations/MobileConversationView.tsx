import { useState } from 'react';
import { Conversation, Message } from '@/lib/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MessageTimeline } from './MessageTimeline';
import { AIContextPanel } from './AIContextPanel';
import { CustomerContext } from '@/components/context/CustomerContext';
import { QuickActions } from './QuickActions';
import { MessageSquare, Sparkles, User, Zap } from 'lucide-react';

interface MobileConversationViewProps {
  conversation: Conversation;
  messages: Message[];
  onUpdate: () => void;
  onBack: () => void;
}

export const MobileConversationView = ({ 
  conversation, 
  messages, 
  onUpdate, 
  onBack 
}: MobileConversationViewProps) => {
  const [activeTab, setActiveTab] = useState('conversation');

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col h-full">
      <TabsList className="grid w-full grid-cols-4 rounded-none border-b border-border bg-card h-12 p-0">
        <TabsTrigger 
          value="conversation" 
          className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary h-full"
        >
          <MessageSquare className="h-4 w-4 md:mr-2" />
          <span className="hidden md:inline">Thread</span>
        </TabsTrigger>
        <TabsTrigger 
          value="ai" 
          className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary h-full"
        >
          <Sparkles className="h-4 w-4 md:mr-2" />
          <span className="hidden md:inline">AI</span>
        </TabsTrigger>
        <TabsTrigger 
          value="profile" 
          className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary h-full"
        >
          <User className="h-4 w-4 md:mr-2" />
          <span className="hidden md:inline">Profile</span>
        </TabsTrigger>
        <TabsTrigger 
          value="actions" 
          className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary h-full"
        >
          <Zap className="h-4 w-4 md:mr-2" />
          <span className="hidden md:inline">Actions</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="conversation" className="flex-1 overflow-y-auto m-0 p-4 pb-2">
        <MessageTimeline messages={messages} />
      </TabsContent>

      <TabsContent value="ai" className="flex-1 overflow-y-auto m-0 p-4">
        <AIContextPanel conversation={conversation} onUpdate={onUpdate} />
      </TabsContent>

      <TabsContent value="profile" className="flex-1 overflow-y-auto m-0 p-4">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold mb-4">Customer Profile</h2>
          <CustomerContext conversation={conversation} onUpdate={onUpdate} />
        </div>
      </TabsContent>

      <TabsContent value="actions" className="flex-1 overflow-y-auto m-0 p-4">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <QuickActions 
            conversation={conversation} 
            onUpdate={onUpdate}
            onBack={onBack}
          />
        </div>
      </TabsContent>
    </Tabs>
  );
};
