import { useState } from 'react';
import { Conversation, Message } from '@/lib/types';
import { MessageTimeline } from './MessageTimeline';
import { AIContextPanel } from './AIContextPanel';
import { CustomerContext } from '@/components/context/CustomerContext';
import { QuickActions } from './QuickActions';
import { Sparkles, User, Zap, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

interface MobileConversationViewProps {
  conversation: Conversation;
  messages: Message[];
  onUpdate: () => void;
  onBack: () => void;
}

type SheetType = 'ai' | 'profile' | 'actions' | null;

export const MobileConversationView = ({ 
  conversation, 
  messages, 
  onUpdate, 
  onBack 
}: MobileConversationViewProps) => {
  const [activeSheet, setActiveSheet] = useState<SheetType>(null);

  return (
    <div className="flex-1 flex flex-col h-full relative">
      {/* Main Conversation View - Always Visible */}
      <div className="flex-1 overflow-y-auto pb-4">
        <MessageTimeline messages={messages} />
      </div>

      {/* Floating Action Buttons */}
      <div className="fixed right-4 bottom-24 flex flex-col gap-3 z-20">
        <Button
          onClick={() => setActiveSheet('ai')}
          className="h-14 w-14 rounded-full shadow-lg mobile-spring-bounce bg-primary hover:bg-primary/90"
          size="icon"
        >
          <Sparkles className="h-6 w-6" />
        </Button>
        <Button
          onClick={() => setActiveSheet('profile')}
          className="h-14 w-14 rounded-full shadow-lg mobile-spring-bounce bg-secondary hover:bg-secondary/90"
          size="icon"
        >
          <User className="h-6 w-6" />
        </Button>
        <Button
          onClick={() => setActiveSheet('actions')}
          className="h-14 w-14 rounded-full shadow-lg mobile-spring-bounce bg-accent hover:bg-accent/90"
          size="icon"
        >
          <Zap className="h-6 w-6" />
        </Button>
      </div>

      {/* AI Context Sheet */}
      <Sheet open={activeSheet === 'ai'} onOpenChange={(open) => !open && setActiveSheet(null)}>
        <SheetContent side="bottom" className="h-[85vh] rounded-t-3xl mobile-frosted">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-2xl font-bold">AI Context</SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto h-[calc(100%-60px)] pb-6">
            <AIContextPanel conversation={conversation} onUpdate={onUpdate} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Customer Profile Sheet */}
      <Sheet open={activeSheet === 'profile'} onOpenChange={(open) => !open && setActiveSheet(null)}>
        <SheetContent side="bottom" className="h-[85vh] rounded-t-3xl mobile-frosted">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-2xl font-bold">Customer Profile</SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto h-[calc(100%-60px)] pb-6">
            <CustomerContext conversation={conversation} onUpdate={onUpdate} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Quick Actions Sheet */}
      <Sheet open={activeSheet === 'actions'} onOpenChange={(open) => !open && setActiveSheet(null)}>
        <SheetContent side="bottom" className="h-[85vh] rounded-t-3xl mobile-frosted">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-2xl font-bold">Quick Actions</SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto h-[calc(100%-60px)] pb-6">
            <QuickActions 
              conversation={conversation} 
              onUpdate={onUpdate}
              onBack={onBack}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};
