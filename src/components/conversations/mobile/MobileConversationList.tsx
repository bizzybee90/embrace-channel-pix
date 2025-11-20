import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { ChevronRight, Inbox, ChevronLeft } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import PullToRefresh from 'react-simple-pull-to-refresh';
import { useState } from 'react';

interface MobileConversationListProps {
  conversations: Conversation[];
  onSelect: (conversation: Conversation) => void;
  filterTitle: string;
  statusFilter: string;
  priorityFilter: string;
  channelFilter: string;
  onStatusFilterChange: (value: string) => void;
  onPriorityFilterChange: (value: string) => void;
  onChannelFilterChange: (value: string) => void;
  onRefresh: () => Promise<void>;
}

export const MobileConversationList = ({ 
  conversations, 
  onSelect,
  filterTitle,
  statusFilter,
  priorityFilter,
  channelFilter,
  onStatusFilterChange,
  onPriorityFilterChange,
  onChannelFilterChange,
  onRefresh
}: MobileConversationListProps) => {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const getPriorityColor = (priority: string | null) => {
    if (!priority) return 'secondary';
    if (priority === 'urgent') return 'destructive';
    if (priority === 'high') return 'default';
    if (priority === 'medium') return 'secondary';
    return 'outline';
  };

  const filterCategories = [
    {
      id: 'status',
      label: 'Status',
      value: statusFilter,
      onChange: onStatusFilterChange,
      options: [
        { label: 'All', value: 'all' },
        { label: 'New', value: 'new' },
        { label: 'Open', value: 'open' },
        { label: 'Pending', value: 'pending' },
      ]
    },
    {
      id: 'priority',
      label: 'Urgency',
      value: priorityFilter,
      onChange: onPriorityFilterChange,
      options: [
        { label: 'All', value: 'all' },
        { label: 'Urgent', value: 'urgent' },
        { label: 'High', value: 'high' },
        { label: 'Medium', value: 'medium' },
        { label: 'Low', value: 'low' },
      ]
    },
    {
      id: 'channel',
      label: 'Channels',
      value: channelFilter,
      onChange: onChannelFilterChange,
      options: [
        { label: 'All', value: 'all' },
        { label: 'SMS', value: 'sms' },
        { label: 'Email', value: 'email' },
        { label: 'WhatsApp', value: 'whatsapp' },
        { label: 'Phone', value: 'phone' },
      ]
    },
  ];

  const activeFilter = filterCategories.find(f => f.id === activeCategory);

  return (
    <div className="h-screen flex flex-col bg-gradient-to-b from-background to-muted/20">
      {/* iOS Large Title Header */}
      <div className="px-5 pt-safe pb-4 bg-background/95 backdrop-blur-xl border-b border-border/40 sticky top-0 z-50">
        <div className="pt-3">
          <h1 className="text-[34px] font-bold leading-[41px] tracking-tight text-foreground mb-1">
            {filterTitle}
          </h1>
          <p className="text-[15px] text-muted-foreground font-normal">
            {conversations.length} conversation{conversations.length !== 1 ? 's' : ''} need your attention
          </p>
        </div>
      </div>

      {/* Premium Accent Bar */}
      <div className="h-[3px] bg-gradient-to-r from-primary/60 via-primary to-primary/60 shadow-sm" />

      {/* Two-Level Filter System */}
      <div className="px-5 py-4 bg-background/50 backdrop-blur-sm">
        <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide -mx-5 px-5">
          {!activeCategory ? (
            // Level 1: Category selection
            filterCategories.map((category) => (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className="rounded-[20px] px-5 py-2.5 text-[14px] font-semibold whitespace-nowrap transition-all duration-300 border bg-gradient-to-b from-primary to-primary/90 text-primary-foreground border-primary/20 shadow-lg shadow-primary/25 flex-shrink-0 active:scale-95"
              >
                {category.label}
              </button>
            ))
          ) : (
            // Level 2: Options for selected category
            <>
              <button
                onClick={() => setActiveCategory(null)}
                className="rounded-[20px] px-4 py-2.5 text-[14px] font-semibold whitespace-nowrap transition-all duration-300 border bg-background/80 text-foreground border-border/60 hover:bg-accent/50 flex-shrink-0 active:scale-95 flex items-center gap-1.5"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
              {activeFilter?.options.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    activeFilter.onChange(option.value);
                    setActiveCategory(null);
                  }}
                  className={cn(
                    "rounded-[20px] px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-all duration-300 border flex-shrink-0",
                    activeFilter.value === option.value 
                      ? "bg-gradient-to-b from-primary to-primary/90 text-primary-foreground border-primary/20 shadow-lg shadow-primary/25" 
                      : "bg-background/80 text-foreground border-border/60 hover:bg-accent/50 hover:border-primary/30 active:scale-95"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Apple-Quality Conversation List */}
      <PullToRefresh 
        onRefresh={onRefresh} 
        className="flex-1 overflow-y-auto"
        pullingContent={<div className="text-center py-4 text-muted-foreground text-sm">Pull to refresh...</div>}
      >
        <div className="px-5 py-4 space-y-3 pb-20">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center px-8">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-4">
                <Inbox className="w-10 h-10 text-primary/40" />
              </div>
              <h3 className="text-[22px] font-semibold text-foreground mb-2">All Clear</h3>
              <p className="text-[15px] text-muted-foreground leading-relaxed">
                No conversations match your filters.
                <br />
                Try adjusting them to see more.
              </p>
            </div>
          ) : (
            conversations.map((conversation, index) => (
              <div
                key={conversation.id}
                onClick={() => onSelect(conversation)}
                className="bg-gradient-to-b from-background to-background/95 rounded-[24px] p-5 border border-border/50 active:scale-[0.97] transition-all duration-200 shadow-lg shadow-black/5 hover:shadow-xl hover:shadow-black/10 active:shadow-md"
                style={{ 
                  animationDelay: `${index * 50}ms`,
                }}
              >
                {/* Title */}
                <h3 className="font-semibold text-[17px] leading-snug mb-3 text-foreground tracking-tight">
                  {conversation.title || 'Untitled Conversation'}
                </h3>

                {/* Badges Row */}
                <div className="flex items-center gap-2 mb-3.5 flex-wrap">
                  {conversation.priority && (
                    <Badge 
                      variant={getPriorityColor(conversation.priority)} 
                      className="text-[11px] rounded-full px-2.5 py-0.5 font-semibold tracking-wide uppercase"
                    >
                      {conversation.priority}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[11px] rounded-full px-2.5 py-0.5 font-medium border-border/60">
                    <ChannelIcon channel={conversation.channel} className="mr-1.5 h-3 w-3" />
                    {conversation.channel}
                  </Badge>
                </div>

                {/* Metadata Footer */}
                <div className="flex items-center justify-between text-[13px] text-muted-foreground pt-2 border-t border-border/30">
                  {conversation.category ? (
                    <span className="font-medium">{conversation.category}</span>
                  ) : (
                    <span className="font-medium text-muted-foreground/50">No category</span>
                  )}
                  <span className="flex items-center gap-1.5 font-medium">
                    {formatDistanceToNow(new Date(conversation.created_at!), { addSuffix: true })}
                    <ChevronRight className="h-3.5 w-3.5 text-primary/60" />
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </PullToRefresh>
    </div>
  );
};
