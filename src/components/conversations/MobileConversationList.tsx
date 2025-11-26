import { Conversation } from '@/lib/types';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { Inbox, SlidersHorizontal } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import PullToRefresh from 'react-simple-pull-to-refresh';
import { useState, useEffect, useRef } from 'react';
import { MobileFilterSheet } from './mobile/MobileFilterSheet';

interface MobileConversationListProps {
  conversations: Conversation[];
  onSelect: (conversation: Conversation) => void;
  filterTitle: string;
  statusFilter: string[];
  priorityFilter: string[];
  channelFilter: string[];
  categoryFilter: string[];
  sortBy: string;
  onStatusFilterChange: (value: string[]) => void;
  onPriorityFilterChange: (value: string[]) => void;
  onChannelFilterChange: (value: string[]) => void;
  onCategoryFilterChange: (value: string[]) => void;
  onSortByChange: (value: string) => void;
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
  sortBy,
  onStatusFilterChange,
  onPriorityFilterChange,
  onChannelFilterChange,
  onCategoryFilterChange,
  onSortByChange,
  onRefresh
}: MobileConversationListProps) => {
  const [isHeaderCompact, setIsHeaderCompact] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (scrollRef.current) {
        setIsHeaderCompact(scrollRef.current.scrollTop > 60);
      }
    };

    const scrollElement = scrollRef.current;
    scrollElement?.addEventListener('scroll', handleScroll);
    return () => scrollElement?.removeEventListener('scroll', handleScroll);
  }, []);

  const getPriorityColor = (priority: string | null) => {
    if (!priority) return { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' };
    switch (priority.toLowerCase()) {
      case 'urgent': 
        return { bg: 'bg-red-500', text: 'text-white', border: 'border-red-500' };
      case 'high': 
        return { bg: 'bg-amber-500', text: 'text-white', border: 'border-amber-500' };
      case 'medium': 
        return { bg: 'bg-yellow-500', text: 'text-white', border: 'border-yellow-500' };
      case 'low': 
        return { bg: 'bg-slate-400', text: 'text-white', border: 'border-slate-400' };
      default: 
        return { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' };
    }
  };

  const isOverdue = (conversation: Conversation) => {
    if (!conversation.sla_due_at) return false;
    return new Date(conversation.sla_due_at) < new Date();
  };

  const statusOptions = [
    { label: 'All', value: 'all' },
    { label: 'New', value: 'new' },
    { label: 'Open', value: 'open' },
    { label: 'Pending', value: 'pending' },
  ];

  const priorityOptions = [
    { label: 'All', value: 'all' },
    { label: 'Urgent', value: 'urgent' },
    { label: 'High', value: 'high' },
    { label: 'Medium', value: 'medium' },
    { label: 'Low', value: 'low' },
  ];

  const channelOptions = [
    { label: 'All', value: 'all' },
    { label: 'SMS', value: 'sms' },
    { label: 'Email', value: 'email' },
    { label: 'WhatsApp', value: 'whatsapp' },
    { label: 'Phone', value: 'phone' },
  ];

  const getActiveFilterCount = () => {
    return statusFilter.length + priorityFilter.length + channelFilter.length + categoryFilter.length;
  };

  const activeFilterCount = getActiveFilterCount();

  return (
    <>
      <MobileFilterSheet
        open={isFilterSheetOpen}
        onOpenChange={setIsFilterSheetOpen}
        statusFilter={statusFilter}
        priorityFilter={priorityFilter}
        channelFilter={channelFilter}
        categoryFilter={categoryFilter}
        sortBy={sortBy}
        onStatusFilterChange={onStatusFilterChange}
        onPriorityFilterChange={onPriorityFilterChange}
        onChannelFilterChange={onChannelFilterChange}
        onCategoryFilterChange={onCategoryFilterChange}
        onSortByChange={onSortByChange}
      />
    <div className="h-screen flex flex-col bg-gradient-to-b from-background to-muted/10">
      {/* iOS Large Title Header with Scroll Behavior */}
      <div 
        className={cn(
          "px-5 pt-safe bg-background/95 backdrop-blur-xl border-b border-border/40 sticky top-0 z-50 transition-all duration-300",
          isHeaderCompact ? "pb-3" : "pb-4"
        )}
      >
        <div className={cn(
          "transition-all duration-300",
          isHeaderCompact ? "pt-2" : "pt-8"
        )}>
          <h1 className={cn(
            "font-semibold tracking-tight text-foreground transition-all duration-300",
            isHeaderCompact ? "text-[20px] leading-[24px]" : "text-[32px] leading-[38px] mb-1"
          )}>
            {filterTitle}
          </h1>
          {!isHeaderCompact && (
            <p className="text-[15px] text-muted-foreground font-normal">
              {conversations.length} conversation{conversations.length !== 1 ? 's' : ''} need your attention
            </p>
          )}
        </div>
      </div>


      {/* Conversation List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <PullToRefresh onRefresh={onRefresh}>
          <div className="px-5 py-5 space-y-4 pb-8">
            {conversations.length === 0 ? (
              <div className="bg-white rounded-[24px] border border-black/[0.06] shadow-[0_6px_20px_rgba(0,0,0,0.04)] p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 mx-auto">
                  <Inbox className="h-8 w-8 text-primary/40" />
                </div>
                <p className="text-[17px] font-semibold text-foreground mb-2">
                  No {filterTitle.toLowerCase()}
                </p>
                <p className="text-[15px] text-muted-foreground max-w-[280px] mx-auto">
                  When something needs your attention, it will appear here
                </p>
              </div>
            ) : (
              conversations.map((conversation) => {
                const priorityColors = getPriorityColor(conversation.priority);
                const overdueStatus = isOverdue(conversation);
                
                return (
                  <button
                    key={conversation.id}
                    onClick={() => onSelect(conversation)}
                    className="w-full text-left group active:scale-[0.98] transition-transform duration-200"
                  >
                    <div className="relative bg-white rounded-[24px] border border-black/[0.06] shadow-[0_6px_20px_rgba(0,0,0,0.04)] p-5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-shadow duration-200">
                      {/* Priority Accent Bar */}
                      {conversation.priority && (
                        <div 
                          className={cn(
                            "absolute top-0 left-0 right-0 h-[3px] rounded-t-[24px]",
                            priorityColors.bg
                          )} 
                        />
                      )}
                      
                      {/* Overdue Indicator */}
                      {overdueStatus && (
                        <div className="absolute top-4 right-4">
                          <div className="bg-red-500 text-white text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full">
                            Overdue
                          </div>
                        </div>
                      )}

                      {/* Title */}
                      <h3 className="text-[17px] font-semibold text-foreground leading-snug mb-2 line-clamp-2 pr-16">
                        {conversation.title || 'Untitled Conversation'}
                      </h3>

                      {/* Escalation Reason / Description */}
                      {conversation.ai_reason_for_escalation && (
                        <p className="text-[15px] text-muted-foreground leading-relaxed mb-3 line-clamp-3">
                          {conversation.ai_reason_for_escalation}
                        </p>
                      )}

                      {/* Badge Row */}
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        {/* Priority Badge */}
                        {conversation.priority && (
                          <div 
                            className={cn(
                              "px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide",
                              priorityColors.bg,
                              priorityColors.text
                            )}
                          >
                            {conversation.priority}
                          </div>
                        )}
                        
                        {/* Channel Badge */}
                        <div className="px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-muted text-muted-foreground flex items-center gap-1.5">
                          <ChannelIcon channel={conversation.channel} className="h-3.5 w-3.5" />
                          {conversation.channel}
                        </div>
                      </div>

                      {/* Meta Row */}
                      <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                        <span className="uppercase tracking-wide font-medium">
                          {conversation.category?.replace(/_/g, ' ') || 'General'}
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="text-muted-foreground/60">•</span>
                          {formatDistanceToNow(new Date(conversation.created_at || new Date()), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </PullToRefresh>
      </div>

      {/* Sticky Filter Button at Bottom - Minimal Design */}
      <div className="sticky bottom-0 left-0 right-0 px-5 py-3 pb-safe">
        <button
          onClick={() => setIsFilterSheetOpen(true)}
          className={cn(
            "w-full h-[44px] rounded-full text-[14px] font-medium transition-all duration-200",
            "flex items-center justify-center gap-2",
            "active:scale-95 backdrop-blur-sm",
            activeFilterCount > 0
              ? "bg-primary/90 text-primary-foreground shadow-sm"
              : "bg-background/60 text-muted-foreground border border-border/30"
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="font-semibold">{activeFilterCount}</span>
          )}
        </button>
      </div>
    </div>
    </>
  );
};
