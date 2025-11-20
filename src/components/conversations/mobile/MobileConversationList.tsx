import { Conversation } from '@/lib/types';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { Badge } from '@/components/ui/badge';
import { Inbox, SlidersHorizontal } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import PullToRefresh from 'react-simple-pull-to-refresh';
import { useState, useEffect, useRef } from 'react';
import { MobileFilterSheet } from './MobileFilterSheet';

interface MobileConversationListProps {
  conversations: Conversation[];
  onSelect: (conversation: Conversation) => void;
  filterTitle: string;
  statusFilter: string[];
  priorityFilter: string[];
  channelFilter: string[];
  categoryFilter: string[];
  onStatusFilterChange: (value: string[]) => void;
  onPriorityFilterChange: (value: string[]) => void;
  onChannelFilterChange: (value: string[]) => void;
  onCategoryFilterChange: (value: string[]) => void;
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

  const getPriorityBarColor = (priority: string | null) => {
    if (!priority) return 'bg-muted';
    switch (priority.toLowerCase()) {
      case 'urgent': return 'bg-priority-urgent';
      case 'high': return 'bg-priority-high';
      case 'medium': return 'bg-priority-medium';
      case 'low': return 'bg-priority-low';
      default: return 'bg-muted';
    }
  };

  const isOverdue = (conversation: Conversation) => {
    if (!conversation.sla_due_at) return false;
    return new Date(conversation.sla_due_at) < new Date();
  };

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
        onStatusFilterChange={onStatusFilterChange}
        onPriorityFilterChange={onPriorityFilterChange}
        onChannelFilterChange={onChannelFilterChange}
        onCategoryFilterChange={onCategoryFilterChange}
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
                <div className="rounded-[22px] border border-border/30 apple-shadow p-8 text-center bg-card">
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
                  const overdueStatus = isOverdue(conversation);
                  
                  return (
                    <button
                      key={conversation.id}
                      onClick={() => onSelect(conversation)}
                      className="w-full text-left group spring-press"
                    >
                      <div className="relative rounded-[22px] border border-border/30 apple-shadow hover:apple-shadow-lg p-6 transition-all duration-300 bg-card">
                        {/* Priority Accent Bar */}
                        {conversation.priority && (
                          <div 
                            className={cn(
                              "absolute top-0 left-0 right-0 h-[3px] rounded-t-[22px]",
                              getPriorityBarColor(conversation.priority)
                            )} 
                          />
                        )}
                        
                        {/* Overdue Indicator */}
                        {overdueStatus && (
                          <Badge variant="priority-urgent" className="absolute top-4 right-4 text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full shadow-sm">
                            Overdue
                          </Badge>
                        )}

                        {/* Title */}
                        <h3 className="text-[17px] font-semibold text-foreground leading-snug mb-2.5 line-clamp-2 pr-20">
                          {conversation.title || 'Untitled Conversation'}
                        </h3>

                        {/* Escalation Reason / Description */}
                        {conversation.ai_reason_for_escalation && (
                          <p className="text-[15px] text-muted-foreground leading-relaxed mb-4 line-clamp-2">
                            {conversation.ai_reason_for_escalation}
                          </p>
                        )}

                        {/* Badge Row */}
                        <div className="flex flex-wrap items-center gap-2.5 mb-4">
                          {/* Priority Badge */}
                          {conversation.priority && (
                            <Badge 
                              variant={getPriorityVariant(conversation.priority)}
                              className="rounded-full text-xs font-bold uppercase tracking-wide px-3 py-1.5 shadow-sm"
                            >
                              {conversation.priority}
                            </Badge>
                          )}
                          
                          {/* Channel Badge */}
                          <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 border-border/50 flex items-center gap-1.5">
                            <ChannelIcon channel={conversation.channel} className="h-3.5 w-3.5" />
                            {conversation.channel}
                          </Badge>
                        </div>

                        {/* Meta Row */}
                        <div className="flex items-center justify-between text-[13px] text-muted-foreground font-medium">
                          <span className="uppercase tracking-wide">
                            {conversation.category?.replace(/_/g, ' ') || 'General'}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="opacity-40">•</span>
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

      {/* Sticky Filter Button at Bottom */}
      <div className="sticky bottom-0 left-0 right-0 px-5 py-4 pb-safe bg-gradient-to-t from-background via-background to-transparent">
        <button
          onClick={() => setIsFilterSheetOpen(true)}
          className={cn(
            "w-full h-12 rounded-[18px] text-sm font-semibold transition-all duration-300",
            "flex items-center justify-center gap-2.5",
            "spring-press backdrop-blur-xl",
            activeFilterCount > 0
              ? "bg-primary text-primary-foreground apple-shadow"
              : "bg-card/80 text-muted-foreground border-2 border-border/50"
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-primary-foreground/20 text-xs font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>
    </div>
    </>
  );
};
