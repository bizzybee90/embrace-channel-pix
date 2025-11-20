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
  const getPriorityVariant = (priority: string | null) => {
    if (!priority) return 'secondary';
    switch (priority.toLowerCase()) {
      case 'urgent': return 'priority-urgent';
      case 'high': return 'priority-high';
      case 'medium': return 'priority-medium';
      case 'low': return 'priority-low';
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
      <div className="px-6 pt-8 pb-6 bg-gradient-to-br from-background via-background to-primary/5">
        <h1 className="text-[40px] font-bold leading-tight tracking-tight text-foreground mb-2">
          {filterTitle}
        </h1>
        <p className="text-base text-muted-foreground font-medium">
          {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Horizontal Scrollable Filter Chips */}
      <div className="px-6 py-4 bg-background/80 backdrop-blur-sm border-b border-border/50">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {filters.map((filter) => (
            <div key={filter.label} className="flex gap-1.5 flex-shrink-0">
              {filter.options.map((option) => (
                <Badge
                  key={option.value}
                  variant={filter.value === option.value ? 'default' : 'outline'}
                  className={cn(
                    "rounded-full px-4 py-2 cursor-pointer transition-all duration-200 text-xs font-medium whitespace-nowrap",
                    filter.value === option.value 
                      ? "bg-primary text-primary-foreground shadow-sm" 
                      : "hover:bg-accent hover:border-primary/20"
                  )}
                  onClick={() => filter.onChange(option.value)}
                >
                  {option.label}
                </Badge>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Conversation List */}
      <PullToRefresh onRefresh={onRefresh} className="flex-1">
        <div className="px-4 py-3 space-y-3">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <p className="text-lg font-medium">No conversations found</p>
              <p className="text-sm mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            conversations.map((conversation) => (
              <div
                key={conversation.id}
                onClick={() => onSelect(conversation)}
                className="bg-background rounded-[28px] p-6 border border-border/50 hover:border-primary/20 active:scale-[0.98] transition-all duration-200 shadow-sm hover:shadow-md"
              >
                {/* Title */}
                <h3 className="font-bold text-lg leading-snug mb-3 text-foreground">
                  {conversation.title || 'Untitled Conversation'}
                </h3>

                {/* Priority, Channel */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {conversation.priority && (
                    <Badge variant={getPriorityVariant(conversation.priority)} className="text-xs rounded-full px-3 py-1 font-medium">
                      {conversation.priority.charAt(0).toUpperCase() + conversation.priority.slice(1)}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs rounded-full px-3 py-1 font-medium">
                    <ChannelIcon channel={conversation.channel} className="mr-1.5 h-3 w-3" />
                    {conversation.channel}
                  </Badge>
                </div>

                {/* Category and Time */}
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  {conversation.category && (
                    <span className="font-medium">{conversation.category}</span>
                  )}
                  <span className="flex items-center gap-1 font-medium">
                    {formatDistanceToNow(new Date(conversation.created_at!), { addSuffix: true })}
                    <ChevronRight className="h-4 w-4" />
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
