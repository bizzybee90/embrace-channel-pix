import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import PullToRefresh from 'react-simple-pull-to-refresh';

interface MobileConversationListProps {
  conversations: Conversation[];
  onSelect: (conversation: Conversation) => void;
  filterTitle: string;
  statusFilter: string;
  priorityFilter: string;
  channelFilter: string;
  categoryFilter: string;
  onStatusFilterChange: (value: string) => void;
  onPriorityFilterChange: (value: string) => void;
  onChannelFilterChange: (value: string) => void;
  onCategoryFilterChange: (value: string) => void;
  onRefresh: () => Promise<void>;
}

export const MobileConversationList = ({ 
  conversations, 
  onSelect,
  filterTitle,
  statusFilter,
  priorityFilter,
  channelFilter,
  categoryFilter,
  onStatusFilterChange,
  onPriorityFilterChange,
  onChannelFilterChange,
  onCategoryFilterChange,
  onRefresh
}: MobileConversationListProps) => {
  const getPriorityColor = (priority: string | null) => {
    switch (priority) {
      case 'urgent': return 'destructive';
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      case 'low': return 'outline';
      default: return 'secondary';
    }
  };

  const isOverdue = (conversation: Conversation) => {
    if (!conversation.sla_due_at) return false;
    return new Date() > new Date(conversation.sla_due_at);
  };

  const filters = [
    { 
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
      label: 'Priority', 
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
      label: 'Channel', 
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
    { 
      label: 'Category', 
      value: categoryFilter, 
      onChange: onCategoryFilterChange,
      options: [
        { label: 'All', value: 'all' },
        { label: 'Billing', value: 'billing' },
        { label: 'Technical', value: 'technical' },
        { label: 'General', value: 'general' },
      ]
    },
  ];

  return (
    <div className="h-screen flex flex-col bg-muted/30">
      {/* Large Title Header */}
      <div className="px-5 pt-6 pb-4 bg-background border-b border-border/50">
        <h1 className="text-[34px] font-bold leading-tight tracking-tight text-foreground mb-1">
          {filterTitle}
        </h1>
        <p className="text-[15px] text-muted-foreground">
          {conversations.length} conversation{conversations.length !== 1 ? 's' : ''} need{conversations.length === 1 ? 's' : ''} review
        </p>
      </div>

      {/* Horizontal Scrollable Filter Chips */}
      <div className="px-5 py-4 bg-background border-b border-border/50">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {filters.map((filter) => (
            <div key={filter.label} className="flex-shrink-0">
              <button
                onClick={() => {
                  const currentIndex = filter.options.findIndex(opt => opt.value === filter.value);
                  const nextIndex = (currentIndex + 1) % filter.options.length;
                  filter.onChange(filter.options[nextIndex].value);
                }}
                className={cn(
                  "h-9 px-4 rounded-full text-sm font-medium transition-all",
                  "border-2 border-border/60",
                  filter.value !== 'all' 
                    ? "bg-primary text-primary-foreground border-primary" 
                    : "bg-background text-foreground hover:bg-muted"
                )}
              >
                {filter.label}: {filter.options.find(opt => opt.value === filter.value)?.label}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Conversation Cards with Pull-to-Refresh */}
      <div className="flex-1 overflow-hidden">
        <PullToRefresh
          onRefresh={onRefresh}
          pullingContent=""
          refreshingContent={
            <div className="flex justify-center py-4">
              <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          }
          className="h-full overflow-y-auto"
        >
          <div className="p-5 space-y-3">
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <p className="text-[17px] font-semibold text-foreground mb-2">No conversations</p>
                <p className="text-[15px] text-muted-foreground">
                  There are no conversations matching your current filters.
                </p>
              </div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => onSelect(conversation)}
                  className="w-full text-left bg-card rounded-[24px] p-4 shadow-sm border border-border/50 hover:shadow-md hover:scale-[1.01] transition-all active:scale-[0.99]"
                >
                  {/* Top Row */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-[17px] font-semibold text-foreground truncate">
                          {conversation.title || 'Untitled Conversation'}
                        </h3>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  </div>

                  {/* Middle Row - Badges */}
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Badge 
                      variant={getPriorityColor(conversation.priority)}
                      className="rounded-full text-xs font-medium h-6 px-2"
                    >
                      {conversation.priority || 'medium'}
                    </Badge>
                    
                    <div className="flex items-center gap-2 px-2 h-6 rounded-full bg-muted/50">
                      <ChannelIcon channel={conversation.channel} className="h-3 w-3" />
                      <span className="text-xs font-medium text-foreground capitalize">
                        {conversation.channel}
                      </span>
                    </div>

                    {isOverdue(conversation) && (
                      <Badge variant="destructive" className="rounded-full text-xs font-medium h-6 px-2">
                        Overdue
                      </Badge>
                    )}
                  </div>

                  {/* Bottom Row - Metadata */}
                  <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    {conversation.category && (
                      <>
                        <span className="capitalize">{conversation.category}</span>
                        <span>•</span>
                      </>
                    )}
                    <span>
                      {conversation.created_at && formatDistanceToNow(new Date(conversation.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </PullToRefresh>
      </div>
    </div>
  );
};
