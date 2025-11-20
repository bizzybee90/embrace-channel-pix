import { useState } from 'react';
import { Plus, Smile, Meh, Frown, SlidersHorizontal, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
const categoryOptions = ['all', 'billing', 'technical', 'general', 'support'];

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
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const getSentimentEmoji = (sentiment: string | null) => {
    if (!sentiment) return null;
    switch (sentiment.toLowerCase()) {
      case 'positive': return <Smile className="h-4 w-4 text-green-500" />;
      case 'negative': return <Frown className="h-4 w-4 text-red-500" />;
      case 'neutral': return <Meh className="h-4 w-4 text-gray-400" />;
      default: return null;
    }
  };

  const getCustomerInitials = (conversation: Conversation) => {
    // Extract initials from title or use default
    const words = conversation.title?.split(' ') || ['U', 'N'];
    return words.slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'UN';
  };

  const getMessagePreview = (conversation: Conversation) => {
    return conversation.summary_for_human || 'No preview available';
  };
  const getPriorityColor = (priority: string | null): "default" | "secondary" | "destructive" | "outline" => {
    switch (priority) {
      case 'urgent': return 'destructive';
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      case 'low': return 'outline';
      default: return 'default';
    }
  };

  const getAccentBarColor = (conversation: Conversation) => {
    const isOverdue = conversation.sla_due_at && new Date() > new Date(conversation.sla_due_at);
    
    if (isOverdue) return 'bg-red-500';
    
    const priority = conversation.priority;
    if (priority === 'high') {
      return 'bg-red-500';
    } else if (priority === 'medium') {
      return 'bg-yellow-500';
    } else if (priority === 'low') {
      return 'bg-green-500';
    }
    return 'bg-gray-300';
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

  const hasActiveFilters = statusFilter !== 'all' || priorityFilter !== 'all' || channelFilter !== 'all' || categoryFilter !== 'all';

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-background via-muted/5 to-background relative overflow-hidden">
      {/* Subtle ambient background */}
      <div className="absolute inset-0 bg-gradient-radial from-primary/3 via-transparent to-transparent opacity-40 pointer-events-none" />
      
      {/* iOS Large Title Header */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-xl border-b border-border/20 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <div className="pt-16 pb-4 px-6">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1">
              <h1 className="text-[36px] font-bold text-foreground leading-[1.1] tracking-tight mb-1.5 
                bg-gradient-to-b from-foreground to-foreground/80 bg-clip-text">
                {filterTitle}
              </h1>
              <p className="text-[14px] text-muted-foreground/70 font-medium tracking-wide">
                {conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'}
              </p>
            </div>
            
            {/* Filter Button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`h-9 px-4 rounded-full flex items-center gap-2 font-semibold text-[13px] 
                transition-all duration-200 active:scale-95 mt-1 ${
                hasActiveFilters 
                  ? 'bg-primary text-primary-foreground shadow-[0_2px_12px_rgba(0,0,0,0.15)]' 
                  : 'bg-muted/60 text-muted-foreground/80'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filter
              {hasActiveFilters && (
                <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
              )}
            </button>
          </div>

          {/* Collapsible Filter Panel */}
          {showFilters && (
            <div className="mt-4 pt-4 border-t border-border/20 animate-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] font-semibold text-foreground/60 uppercase tracking-wider">Filters</span>
                {hasActiveFilters && (
                  <button
                    onClick={() => {
                      onStatusFilterChange('all');
                      onPriorityFilterChange('all');
                      onChannelFilterChange('all');
                      setCategoryFilter('all');
                    }}
                    className="text-[13px] font-semibold text-primary active:scale-95 transition-transform"
                  >
                    Clear All
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => cycleFilter(statusFilter, statusOptions, onStatusFilterChange)}
                  className={`flex items-center gap-1.5 h-8 px-3.5 rounded-full flex-shrink-0 font-semibold text-[12px] transition-all duration-200 active:scale-95 ${
                    statusFilter === 'all'
                      ? 'bg-muted/50 text-muted-foreground/60 border border-border/30'
                      : 'bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
                  }`}
                >
                  {statusFilter === 'all' ? 'Status' : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}
                </button>

                <button
                  onClick={() => cycleFilter(priorityFilter, priorityOptions, onPriorityFilterChange)}
                  className={`flex items-center gap-1.5 h-8 px-3.5 rounded-full flex-shrink-0 font-semibold text-[12px] transition-all duration-200 active:scale-95 ${
                    priorityFilter === 'all'
                      ? 'bg-muted/50 text-muted-foreground/60 border border-border/30'
                      : 'bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
                  }`}
                >
                  {priorityFilter === 'all' ? 'Priority' : priorityFilter.charAt(0).toUpperCase() + priorityFilter.slice(1)}
                </button>

                <button
                  onClick={() => cycleFilter(channelFilter, channelOptions, onChannelFilterChange)}
                  className={`flex items-center gap-1.5 h-8 px-3.5 rounded-full flex-shrink-0 font-semibold text-[12px] transition-all duration-200 active:scale-95 ${
                    channelFilter === 'all'
                      ? 'bg-muted/50 text-muted-foreground/60 border border-border/30'
                      : 'bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
                  }`}
                >
                  {channelFilter === 'all' ? 'Channel' : channelFilter.charAt(0).toUpperCase() + channelFilter.slice(1)}
                </button>

                <button
                  onClick={() => cycleFilter(categoryFilter, categoryOptions, setCategoryFilter)}
                  className={`flex items-center gap-1.5 h-8 px-3.5 rounded-full flex-shrink-0 font-semibold text-[12px] transition-all duration-200 active:scale-95 ${
                    categoryFilter === 'all'
                      ? 'bg-muted/50 text-muted-foreground/60 border border-border/30'
                      : 'bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
                  }`}
                >
                  {categoryFilter === 'all' ? 'Category' : categoryFilter.charAt(0).toUpperCase() + categoryFilter.slice(1)}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Premium Conversation Cards with Pull-to-Refresh */}
      <div className="flex-1 overflow-hidden relative">
        <PullToRefresh
          onRefresh={onRefresh}
          pullingContent=""
          refreshingContent={
            <div className="flex justify-center py-6">
              <div className="h-8 w-8 border-[3px] border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          }
          className="h-full"
        >
          <div className="h-full overflow-y-auto overscroll-contain">
            <div className="pt-6 px-5 pb-[140px] space-y-[18px]">
              {conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 px-6 text-center">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-muted/40 to-muted/20 flex items-center justify-center mb-6 shadow-inner">
                    <div className="w-12 h-12 rounded-full bg-muted/30" />
                  </div>
                  <p className="text-[20px] font-semibold text-foreground mb-2">
                    All Clear
                  </p>
                  <p className="text-[15px] text-muted-foreground/70 max-w-[260px] leading-relaxed">
                    No conversations match your filters. Adjust your view or take a break.
                  </p>
                </div>
              ) : (
                conversations.map((conversation) => {
                  const isOverdueTicket = isOverdue(conversation);
                  const accentColor = getAccentBarColor(conversation);

                  return (
                    <button
                      key={conversation.id}
                      onClick={() => onSelect(conversation)}
                      className="w-full text-left bg-card rounded-[24px] p-5 
                        shadow-[0_1px_3px_rgba(0,0,0,0.05),0_4px_12px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.03)]
                        hover:shadow-[0_2px_6px_rgba(0,0,0,0.08),0_8px_20px_rgba(0,0,0,0.06)]
                        transition-all duration-300 ease-out
                        active:scale-[0.97]
                        border border-border/40
                        relative overflow-hidden
                        bg-gradient-to-b from-card via-card to-card/95"
                    >
                      {/* Left Accent Bar */}
                      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentColor} ${isOverdueTicket ? 'animate-pulse' : ''}`} />

                      {/* Card Content */}
                      <div className="relative pl-1">
                        {/* Top Row: Avatar + Title + Channel Icon */}
                        <div className="flex items-start gap-3 mb-3">
                          <Avatar className="h-12 w-12 ring-2 ring-border/30 flex-shrink-0 shadow-sm">
                            <AvatarFallback className="bg-gradient-to-br from-primary/15 to-primary/5 text-primary font-bold text-[14px]">
                              {getCustomerInitials(conversation)}
                            </AvatarFallback>
                          </Avatar>

                          <div className="flex-1 min-w-0">
                            <h3 className="text-[18px] font-semibold text-foreground leading-tight mb-1 line-clamp-1">
                              {conversation.title || 'Untitled Conversation'}
                            </h3>
                            <p className="text-[14px] text-muted-foreground/80 line-clamp-2 leading-[1.4]">
                              {getMessagePreview(conversation)}
                            </p>
                          </div>

                          <div className="flex-shrink-0 flex flex-col items-end gap-2">
                            <ChannelIcon 
                              channel={conversation.channel} 
                              className="h-5 w-5 text-primary/60" 
                            />
                            {getSentimentEmoji(conversation.ai_sentiment)}
                          </div>
                        </div>

                        {/* Badges Row */}
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          {conversation.priority === 'high' && (
                            <Badge
                              variant="destructive"
                              className="rounded-full text-[11px] font-bold h-5 px-2.5 uppercase tracking-wide shadow-sm"
                            >
                              {conversation.priority}
                            </Badge>
                          )}

                          {isOverdueTicket && (
                            <Badge
                              variant="destructive"
                              className="rounded-full text-[11px] font-bold h-5 px-2.5 uppercase tracking-wide animate-pulse shadow-sm"
                            >
                              Overdue
                            </Badge>
                          )}

                          {conversation.category && (
                            <Badge
                              variant="outline"
                              className="rounded-full text-[11px] font-semibold h-5 px-2.5 capitalize bg-muted/40 border-border/60"
                            >
                              {conversation.category}
                            </Badge>
                          )}
                        </div>

                        {/* Bottom Metadata Row */}
                        <div className="flex items-center justify-between text-[12px] text-muted-foreground/60">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {conversation.created_at &&
                                formatDistanceToNow(new Date(conversation.created_at), {
                                  addSuffix: true,
                                })}
                            </span>
                            {conversation.sla_due_at && (
                              <>
                                <span>•</span>
                                <span className={isOverdueTicket ? 'text-destructive font-semibold' : 'font-medium'}>
                                  SLA: {formatDistanceToNow(new Date(conversation.sla_due_at))}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </PullToRefresh>
      </div>

      {/* Translucent Blurred Floating Bottom Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-28 bg-background/70 backdrop-blur-2xl border-t border-border/30 shadow-[0_-2px_16px_rgba(0,0,0,0.06)] pointer-events-none">
        <div className="flex items-center justify-center h-full pointer-events-auto px-6">
          <button 
            className="h-14 w-14 rounded-full bg-primary text-primary-foreground 
              shadow-[0_4px_20px_rgba(0,0,0,0.15),0_2px_8px_rgba(0,0,0,0.1)] 
              flex items-center justify-center 
              transition-all duration-200 
              active:scale-95 
              hover:shadow-[0_6px_24px_rgba(0,0,0,0.2),0_4px_12px_rgba(0,0,0,0.15)]"
          >
            <Plus className="h-6 w-6" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
};
