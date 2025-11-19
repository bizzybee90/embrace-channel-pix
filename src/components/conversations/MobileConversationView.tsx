import { useState } from 'react';
import { Conversation, Message } from '@/lib/types';
import { MessageTimeline } from './MessageTimeline';
import { AIContextPanel } from './AIContextPanel';
import { CustomerContext } from '@/components/context/CustomerContext';
import { QuickActions } from './QuickActions';
import { MessageSquare, Sparkles, User, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

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
    <div className="flex-1 flex flex-col h-full">
      {/* Apple-style Content Area with smooth transitions */}
      <div className="flex-1 overflow-y-auto mobile-slide-up">
        {activeTab === 'conversation' && (
          <div className="p-4 pb-2 mobile-section-spacing">
            <MessageTimeline messages={messages} />
          </div>
        )}
        
        {activeTab === 'ai' && (
          <div className="p-4 mobile-section-spacing bg-muted/20">
            <h2 className="text-xl font-bold mb-4 px-1">AI Context</h2>
            <AIContextPanel conversation={conversation} onUpdate={onUpdate} />
          </div>
        )}
        
        {activeTab === 'profile' && (
          <div className="p-4 mobile-section-spacing bg-muted/20">
            <h2 className="text-xl font-bold mb-4 px-1">Customer Profile</h2>
            <CustomerContext conversation={conversation} onUpdate={onUpdate} />
          </div>
        )}
        
        {activeTab === 'actions' && (
          <div className="p-4 mobile-section-spacing bg-muted/20">
            <h2 className="text-xl font-bold mb-4 px-1">Quick Actions</h2>
            <QuickActions 
              conversation={conversation} 
              onUpdate={onUpdate}
              onBack={onBack}
            />
          </div>
        )}
      </div>

      {/* iOS-style Bottom Tab Bar */}
      <div className="border-t border-border/30 bg-card/95 backdrop-blur-lg safe-area-bottom">
        <div className="grid grid-cols-4 gap-1 px-2 py-1">
          <button
            onClick={() => setActiveTab('conversation')}
            className={cn(
              "mobile-bottom-tab mobile-spring-bounce",
              activeTab === 'conversation' && "mobile-bottom-tab-active"
            )}
          >
            <MessageSquare className="h-5 w-5" />
            <span className="text-[10px] font-medium">Thread</span>
          </button>
          
          <button
            onClick={() => setActiveTab('ai')}
            className={cn(
              "mobile-bottom-tab mobile-spring-bounce",
              activeTab === 'ai' && "mobile-bottom-tab-active"
            )}
          >
            <Sparkles className="h-5 w-5" />
            <span className="text-[10px] font-medium">AI</span>
          </button>
          
          <button
            onClick={() => setActiveTab('profile')}
            className={cn(
              "mobile-bottom-tab mobile-spring-bounce",
              activeTab === 'profile' && "mobile-bottom-tab-active"
            )}
          >
            <User className="h-5 w-5" />
            <span className="text-[10px] font-medium">Profile</span>
          </button>
          
          <button
            onClick={() => setActiveTab('actions')}
            className={cn(
              "mobile-bottom-tab mobile-spring-bounce",
              activeTab === 'actions' && "mobile-bottom-tab-active"
            )}
          >
            <Zap className="h-5 w-5" />
            <span className="text-[10px] font-medium">Actions</span>
          </button>
        </div>
      </div>
    </div>
  );
};
