import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { Conversation } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import PullToRefresh from 'react-simple-pull-to-refresh';

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

const statusOptions = ['all', 'new', 'open', 'pending', 'resolved'];
const priorityOptions = ['all', 'urgent', 'high', 'medium', 'low'];
const channelOptions = ['all', 'email', 'sms', 'whatsapp', 'phone', 'webchat'];

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
  onRefresh,
}: MobileConversationListProps) => {
  const getPriorityColor = (priority: string | null): "default" | "secondary" | "destructive" | "outline" => {
    switch (priority) {
      case 'urgent': return 'destructive';
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      case 'low': return 'outline';
      default: return 'default';
    }
  };

  const isOverdue = (conversation: Conversation) => {
    if (!conversation.sla_due_at) return false;
    return new Date(conversation.sla_due_at) < new Date();
  };

  const cycleFilter = (current: string, options: string[], onChange: (value: string) => void) => {
    const currentIndex = options.indexOf(current);
    const nextIndex = (currentIndex + 1) % options.length;
    onChange(options[nextIndex]);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Large Title Header with Gradient */}
      <div className="bg-gradient-to-b from-muted/30 to-transparent pt-16 pb-6 px-6">
        <h1 className="text-[34px] font-bold text-foreground leading-tight mb-2">
          {filterTitle}
        </h1>
        <p className="text-[15px] text-muted-foreground">
          {conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'} {conversations.length === 1 ? 'needs' : 'need'} review
        </p>
      </div>

      {/* Filter Chips - Horizontal Scrollable */}
      <div className="px-6 pb-4">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => cycleFilter(statusFilter, statusOptions, onStatusFilterChange)}
            className={`flex items-center gap-2 h-9 px-4 rounded-full flex-shrink-0 font-medium text-[13px] transition-all active:scale-95 ${
              statusFilter === 'all'
                ? 'bg-muted text-muted-foreground'
                : 'bg-primary text-primary-foreground shadow-sm'
            }`}
          >
            Status: {statusFilter}
          </button>

          <button
            onClick={() => cycleFilter(priorityFilter, priorityOptions, onPriorityFilterChange)}
            className={`flex items-center gap-2 h-9 px-4 rounded-full flex-shrink-0 font-medium text-[13px] transition-all active:scale-95 ${
              priorityFilter === 'all'
                ? 'bg-muted text-muted-foreground'
                : 'bg-primary text-primary-foreground shadow-sm'
            }`}
          >
            Priority: {priorityFilter}
          </button>

          <button
            onClick={() => cycleFilter(channelFilter, channelOptions, onChannelFilterChange)}
            className={`flex items-center gap-2 h-9 px-4 rounded-full flex-shrink-0 font-medium text-[13px] transition-all active:scale-95 ${
              channelFilter === 'all'
                ? 'bg-muted text-muted-foreground'
                : 'bg-primary text-primary-foreground shadow-sm'
            }`}
          >
            Channel: {channelFilter}
          </button>
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
        >
          <div className="h-full overflow-y-auto">
            <div className="px-6 pb-6 space-y-3">
              {conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
                  <div className="w-24 h-24 rounded-full bg-muted/50 flex items-center justify-center mb-6">
                    <ChevronRight className="h-12 w-12 text-muted-foreground/50" />
                  </div>
                  <p className="text-[20px] font-semibold text-foreground mb-2">
                    All Clear
                  </p>
                  <p className="text-[15px] text-muted-foreground max-w-[280px]">
                    No conversations match your filters. Take a break or adjust your view.
                  </p>
                </div>
              ) : (
                conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => onSelect(conversation)}
                    className="w-full text-left bg-card rounded-[28px] p-5 shadow-sm border border-border/50 hover:shadow-md transition-all active:scale-[0.98]"
                  >
                    {/* Title Row */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <h3 className="text-[17px] font-semibold text-foreground leading-snug line-clamp-2 flex-1">
                        {conversation.title || 'Untitled Conversation'}
                      </h3>
                      <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    </div>

                    {/* Status Badges */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <Badge
                        variant={getPriorityColor(conversation.priority)}
                        className="rounded-full text-[11px] font-semibold h-7 px-3 uppercase tracking-wide"
                      >
                        {conversation.priority || 'medium'}
                      </Badge>

                      <div className="flex items-center gap-2 px-3 h-7 rounded-full bg-muted/50">
                        <ChannelIcon channel={conversation.channel} className="h-3.5 w-3.5" />
                        <span className="text-[11px] font-semibold text-foreground capitalize tracking-wide">
                          {conversation.channel}
                        </span>
                      </div>

                      {isOverdue(conversation) && (
                        <Badge
                          variant="destructive"
                          className="rounded-full text-[11px] font-semibold h-7 px-3 uppercase tracking-wide"
                        >
                          Overdue
                        </Badge>
                      )}
                    </div>

                    {/* Meta Row */}
                    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      {conversation.category && (
                        <>
                          <span className="capitalize font-medium">{conversation.category}</span>
                          <span>•</span>
                        </>
                      )}
                      <span>
                        {conversation.created_at &&
                          formatDistanceToNow(new Date(conversation.created_at), {
                            addSuffix: true,
                          })}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </PullToRefresh>
      </div>
    </div>
  );
};
