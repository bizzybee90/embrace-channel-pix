import { useState } from 'react';
import { ChevronRight, Plus, Smile, Meh, Frown } from 'lucide-react';
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

  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-muted/20 via-background to-background relative">
      {/* iOS Large Title Header */}
      <div className="pt-safe bg-background/95 backdrop-blur-xl border-b border-border/40 shadow-sm">
        <div className="pt-12 pb-4 px-6">
          <h1 className="text-[34px] font-bold text-foreground leading-[1.2] tracking-tight mb-1">
            {filterTitle}
          </h1>
          <p className="text-[15px] text-muted-foreground font-medium">
            {conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'} {conversations.length === 1 ? 'needs' : 'need'} review
          </p>
        </div>

        {/* iOS Segmented Filter Bar - Sticky */}
        <div className="px-6 pb-3">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            <button
              onClick={() => cycleFilter(statusFilter, statusOptions, onStatusFilterChange)}
              className={`flex items-center gap-1.5 h-8 px-3.5 rounded-full flex-shrink-0 font-semibold text-[12px] transition-all active:scale-95 ${
                statusFilter === 'all'
                  ? 'bg-muted/80 text-muted-foreground backdrop-blur-sm'
                  : 'bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
              }`}
            >
              Status
            </button>

            <button
              onClick={() => cycleFilter(priorityFilter, priorityOptions, onPriorityFilterChange)}
              className={`flex items-center gap-1.5 h-8 px-3.5 rounded-full flex-shrink-0 font-semibold text-[12px] transition-all active:scale-95 ${
                priorityFilter === 'all'
                  ? 'bg-muted/80 text-muted-foreground backdrop-blur-sm'
                  : 'bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
              }`}
            >
              Priority
            </button>

            <button
              onClick={() => cycleFilter(channelFilter, channelOptions, onChannelFilterChange)}
              className={`flex items-center gap-1.5 h-8 px-3.5 rounded-full flex-shrink-0 font-semibold text-[12px] transition-all active:scale-95 ${
                channelFilter === 'all'
                  ? 'bg-muted/80 text-muted-foreground backdrop-blur-sm'
                  : 'bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
              }`}
            >
              Channel
            </button>

            <button
              onClick={() => cycleFilter(categoryFilter, categoryOptions, setCategoryFilter)}
              className={`flex items-center gap-1.5 h-8 px-3.5 rounded-full flex-shrink-0 font-semibold text-[12px] transition-all active:scale-95 ${
                categoryFilter === 'all'
                  ? 'bg-muted/80 text-muted-foreground backdrop-blur-sm'
                  : 'bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
              }`}
            >
              Category
            </button>
          </div>
        </div>
      </div>

      {/* Premium Conversation Cards with Pull-to-Refresh */}
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
          <div className="h-full overflow-y-auto overscroll-contain">
            <div className="pt-6 px-6 pb-[140px] space-y-[18px]">
              {conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 px-6 text-center">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-muted/50 to-muted/30 flex items-center justify-center mb-6 shadow-inner">
                    <ChevronRight className="h-10 w-10 text-muted-foreground/40" />
                  </div>
                  <p className="text-[22px] font-bold text-foreground mb-2">
                    All Clear
                  </p>
                  <p className="text-[15px] text-muted-foreground max-w-[280px] leading-relaxed">
                    No conversations match your filters. Take a break or adjust your view.
                  </p>
                </div>
              ) : (
                conversations.map((conversation) => {
                  const isOverdueTicket = isOverdue(conversation);
                  const priorityColor = conversation.priority === 'high' 
                    ? 'from-red-50/80 to-red-50/40' 
                    : conversation.priority === 'medium'
                    ? 'from-yellow-50/80 to-yellow-50/40'
                    : 'from-background to-background';

                  return (
                    <button
                      key={conversation.id}
                      onClick={() => onSelect(conversation)}
                      className="w-full text-left bg-gradient-to-b from-card to-card/95 rounded-[24px] p-5 
                        shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.04)]
                        hover:shadow-[0_4px_16px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.08)]
                        transition-all duration-200 active:scale-[0.97] border border-border/40
                        relative overflow-hidden"
                    >
                      {/* Subtle gradient overlay */}
                      <div className={`absolute inset-0 bg-gradient-to-br ${priorityColor} opacity-30 pointer-events-none`} />

                      {/* Content */}
                      <div className="relative">
                        {/* Top Row: Avatar + Title + Channel Icon */}
                        <div className="flex items-start gap-3 mb-3">
                          <Avatar className="h-11 w-11 ring-2 ring-border/20 flex-shrink-0">
                            <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/10 text-primary font-bold text-[13px]">
                              {getCustomerInitials(conversation)}
                            </AvatarFallback>
                          </Avatar>

                          <div className="flex-1 min-w-0">
                            <h3 className="text-[17px] font-bold text-foreground leading-tight line-clamp-2 mb-1">
                              {conversation.title || 'Untitled Conversation'}
                            </h3>
                            <p className="text-[13px] text-muted-foreground line-clamp-1 leading-relaxed">
                              {getMessagePreview(conversation)}
                            </p>
                          </div>

                          <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                            <ChannelIcon 
                              channel={conversation.channel} 
                              className="h-5 w-5 text-primary/70" 
                            />
                            {getSentimentEmoji(conversation.ai_sentiment)}
                          </div>
                        </div>

                        {/* Badges Row */}
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          {conversation.priority === 'high' && (
                            <Badge
                              variant="destructive"
                              className="rounded-full text-[10px] font-bold h-6 px-2.5 uppercase tracking-wider"
                            >
                              {conversation.priority}
                            </Badge>
                          )}

                          {isOverdueTicket && (
                            <Badge
                              variant="destructive"
                              className="rounded-full text-[10px] font-bold h-6 px-2.5 uppercase tracking-wider animate-pulse"
                            >
                              Overdue
                            </Badge>
                          )}

                          {conversation.category && (
                            <Badge
                              variant="outline"
                              className="rounded-full text-[10px] font-semibold h-6 px-2.5 capitalize bg-muted/50"
                            >
                              {conversation.category}
                            </Badge>
                          )}
                        </div>

                        {/* Bottom Meta Row */}
                        <div className="flex items-center justify-between text-[12px] text-muted-foreground">
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
                          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
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

      {/* Floating Bottom Bar - iOS Blur */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-background/80 backdrop-blur-2xl border-t border-border/40 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] pointer-events-none">
        <div className="flex items-center justify-center h-full pointer-events-auto px-6">
          <button className="h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-[0_4px_16px_rgba(0,0,0,0.16)] flex items-center justify-center transition-all active:scale-95 hover:shadow-[0_6px_20px_rgba(0,0,0,0.2)]">
            <Plus className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  );
};
