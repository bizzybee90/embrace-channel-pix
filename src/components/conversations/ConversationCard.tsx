import { memo } from 'react';
import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Clock, CheckCircle2, UserPlus, FileEdit, User, Bot, AlertTriangle, MessageSquare, Hourglass, Star, Mail, Ban, Megaphone, Briefcase, Receipt, Settings2 } from 'lucide-react';
import { ChannelIcon } from '../shared/ChannelIcon';
import { cn } from '@/lib/utils';
import { useIsTablet } from '@/hooks/use-tablet';
import { useHaptics } from '@/hooks/useHaptics';
import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { TriageQuickActions } from './TriageQuickActions';

// Email classification badge helper
const getClassificationBadge = (classification: string | null | undefined) => {
  if (!classification) return null;
  
  const badges: Record<string, { icon: typeof Mail; label: string; className: string }> = {
    customer_inquiry: { icon: Mail, label: 'Inquiry', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
    automated_notification: { icon: Bot, label: 'Auto', className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20' },
    spam_phishing: { icon: Ban, label: 'Spam', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
    marketing_newsletter: { icon: Megaphone, label: 'Marketing', className: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20' },
    recruitment_hr: { icon: Briefcase, label: 'Recruitment', className: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' },
    receipt_confirmation: { icon: Receipt, label: 'Receipt', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
    internal_system: { icon: Settings2, label: 'System', className: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20' },
  };
  
  return badges[classification] || null;
};

interface ConversationCardProps {
  conversation: Conversation;
  selected: boolean;
  onClick: () => void;
  onUpdate?: () => void;
  showTriageActions?: boolean;
}

const ConversationCardComponent = ({ conversation, selected, onClick, onUpdate, showTriageActions }: ConversationCardProps) => {
  const isTablet = useIsTablet();
  const { trigger } = useHaptics();
  const { toast } = useToast();

  // Draft detection state
  const [hasDraft, setHasDraft] = useState(false);
  const [assignedUserName, setAssignedUserName] = useState<string | null>(null);

  // Check for draft on mount and when conversation changes
  useEffect(() => {
    const draftKey = `draft-${conversation.id}`;
    const draft = localStorage.getItem(draftKey);
    setHasDraft(!!draft && draft.trim().length > 0);
  }, [conversation.id]);

  // Fetch assigned user name
  useEffect(() => {
    const fetchAssignedUser = async () => {
      if (!conversation.assigned_to) {
        setAssignedUserName(null);
        return;
      }
      
      const { data } = await supabase
        .from('users')
        .select('name')
        .eq('id', conversation.assigned_to)
        .single();
      
      if (data) {
        setAssignedUserName(data.name);
      }
    };
    
    fetchAssignedUser();
  }, [conversation.assigned_to]);

  // Swipe gesture state
  const [swipeDistance, setSwipeDistance] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartX = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  
  const SWIPE_THRESHOLD = 120;
  const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const handleClick = () => {
    if (!isSwiping) {
      trigger('light');
      onClick();
    }
  };

  // Swipe gesture handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isTouchDevice || !isTablet) return;
    touchStartX.current = e.touches[0].clientX;
    setIsSwiping(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isTouchDevice || !isTablet) return;
    const currentX = e.touches[0].clientX;
    const distance = currentX - touchStartX.current;
    
    // Only allow horizontal swipes (not vertical scrolling)
    if (Math.abs(distance) > 10) {
      setIsSwiping(true);
      setSwipeDistance(distance);
    }
  };

  const handleTouchEnd = async () => {
    if (!isTouchDevice || !isTablet || !isSwiping) {
      setSwipeDistance(0);
      setIsSwiping(false);
      return;
    }

    const absDistance = Math.abs(swipeDistance);
    
    // Execute action if threshold met
    if (absDistance >= SWIPE_THRESHOLD) {
      if (swipeDistance > 0) {
        // Right swipe: Assign to me
        await handleAssignToMe();
      } else {
        // Left swipe: Resolve
        await handleResolve();
      }
    }
    
    // Snap back animation
    setSwipeDistance(0);
    setIsSwiping(false);
  };

  const handleAssignToMe = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    trigger('success');
    toast({ title: "Assigned to you" });

    const { error } = await supabase
      .from('conversations')
      .update({ assigned_to: user.id })
      .eq('id', conversation.id);

    if (error) {
      toast({ 
        title: "Assignment failed", 
        description: error.message, 
        variant: "destructive" 
      });
      trigger('warning');
    } else {
      onUpdate?.();
    }
  };

  const handleResolve = async () => {
    trigger('success');
    toast({ title: "Conversation resolved" });

    const { error } = await supabase
      .from('conversations')
      .update({ 
        status: 'resolved', 
        resolved_at: new Date().toISOString() 
      })
      .eq('id', conversation.id);

    if (error) {
      toast({ 
        title: "Failed to resolve", 
        description: error.message, 
        variant: "destructive" 
      });
      trigger('warning');
    } else {
      onUpdate?.();
    }
  };
  
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


  const swipeProgress = Math.min(Math.abs(swipeDistance) / SWIPE_THRESHOLD, 1);
  const isRightSwipe = swipeDistance > 0;

  const isOverdue = conversation.sla_due_at && new Date() > new Date(conversation.sla_due_at);
  
  // Status-based visual indicators
  const getStatusBadge = () => {
    switch (conversation.status) {
      case 'open':
        return { icon: MessageSquare, label: 'Customer Replied', className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' };
      case 'waiting_customer':
        return { icon: Hourglass, label: 'Awaiting Reply', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' };
      case 'ai_handling':
        return { icon: Bot, label: 'AI Handling', className: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' };
      case 'pending_review':
        return { icon: FileEdit, label: 'Draft Ready', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' };
      case 'escalated':
        return { icon: AlertTriangle, label: 'Escalated', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' };
      case 'resolved':
        return { icon: CheckCircle2, label: 'Resolved', className: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' };
      default:
        return null;
    }
  };
  
  const statusBadge = getStatusBadge();

  // Compact tablet layout
  if (isTablet) {
    return (
      <div 
        ref={cardRef}
        className="relative overflow-hidden touch-pan-y mb-3"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Swipe Action Background - Left (Resolve) */}
        <div 
          className="absolute inset-0 bg-blue-500/20 flex items-center justify-end pr-8 pointer-events-none transition-opacity duration-200"
          style={{ 
            opacity: !isRightSwipe && isSwiping ? swipeProgress : 0 
          }}
        >
          <CheckCircle2 
            className="h-6 w-6 text-blue-600 dark:text-blue-400 transition-transform duration-200" 
            style={{ 
              transform: `scale(${swipeProgress})` 
            }}
          />
        </div>

        {/* Swipe Action Background - Right (Assign) */}
        <div 
          className="absolute inset-0 bg-green-500/20 flex items-center justify-start pl-8 pointer-events-none transition-opacity duration-200"
          style={{ 
            opacity: isRightSwipe && isSwiping ? swipeProgress : 0 
          }}
        >
          <UserPlus 
            className="h-6 w-6 text-green-600 dark:text-green-400 transition-transform duration-200" 
            style={{ 
              transform: `scale(${swipeProgress})` 
            }}
          />
        </div>

        {/* Main Card */}
        <div
          onClick={handleClick}
          className={cn(
            "relative cursor-pointer transition-all duration-300 rounded-[22px] overflow-hidden",
            "bg-card border border-border/30 hover:border-primary/30",
            "apple-shadow hover:apple-shadow-lg spring-press",
            selected && "border-primary/50 apple-shadow-lg bg-gradient-to-br from-primary/8 via-primary/4 to-card"
          )}
          style={{
            transform: isSwiping ? `translateX(${swipeDistance}px)` : 'translateX(0)',
            transition: isSwiping ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
        {/* Priority/Status Accent Bar */}
        <div 
          className={cn(
            "absolute top-0 left-0 right-0 h-1",
            conversation.status === 'resolved' 
              ? "bg-green-500" 
              : conversation.priority 
                ? getPriorityBarColor(conversation.priority)
                : "bg-muted"
          )}
        />
        
        {/* Overdue Badge */}
        {isOverdue && (
          <Badge variant="priority-urgent" className="absolute top-4 right-4 text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full shadow-sm">
            Overdue
          </Badge>
        )}

        <div className="p-5">
          {/* Title */}
          <h3 className={cn(
            "font-semibold text-base leading-snug mb-2.5 line-clamp-2 text-foreground",
            isOverdue && "pr-20"
          )}>
            {conversation.title || 'Untitled Conversation'}
          </h3>

          {/* Description */}
          {(conversation.summary_for_human || conversation.ai_reason_for_escalation) && (
            <p className="text-sm text-muted-foreground leading-relaxed mb-3.5 line-clamp-2">
              {conversation.summary_for_human || conversation.ai_reason_for_escalation}
            </p>
          )}

          {/* Badge Row */}
          <div className="flex flex-wrap items-center gap-2 mb-3.5">
            {conversation.priority && (
              <Badge 
                variant={getPriorityVariant(conversation.priority)}
                className="rounded-full text-xs font-bold uppercase tracking-wide px-3 py-1.5 shadow-sm"
              >
                {conversation.priority}
              </Badge>
            )}
            
            <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 border-border/50 flex items-center gap-1.5">
              <ChannelIcon channel={conversation.channel} className="h-3.5 w-3.5" />
              {conversation.channel}
            </Badge>

            {/* Email Classification Badge */}
            {(() => {
              const classificationBadge = getClassificationBadge((conversation as any).email_classification);
              if (!classificationBadge) return null;
              const ClassIcon = classificationBadge.icon;
              return (
                <Badge variant="outline" className={cn("rounded-full text-xs font-semibold px-3 py-1.5 border flex items-center gap-1.5", classificationBadge.className)}>
                  <ClassIcon className="h-3 w-3" />
                  {classificationBadge.label}
                </Badge>
              );
            })()}

            {hasDraft && (
              <Badge variant="secondary" className="rounded-full text-xs font-semibold px-3 py-1.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-1.5">
                <FileEdit className="h-3 w-3" />
                Draft
              </Badge>
            )}

            {statusBadge && (
              <Badge variant="outline" className={cn("rounded-full text-xs font-semibold px-3 py-1.5 border flex items-center gap-1.5", statusBadge.className)}>
                <statusBadge.icon className="h-3 w-3" />
                {statusBadge.label}
              </Badge>
            )}

            {conversation.assigned_to ? (
              <Badge variant="secondary" className="rounded-full text-xs font-semibold px-3 py-1.5 flex items-center gap-1.5">
                <User className="h-3 w-3" />
                {assignedUserName || 'Assigned'}
              </Badge>
            ) : (
              <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 text-amber-600 border-amber-500/20 flex items-center gap-1.5">
                Unassigned
              </Badge>
            )}

            {conversation.customer_satisfaction && (
              <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20 flex items-center gap-1.5">
                <Star className="h-3 w-3 fill-current" />
                {conversation.customer_satisfaction}/5
              </Badge>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
            <span className="uppercase tracking-wide">
              {conversation.category?.replace(/_/g, ' ') || 'General'}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="opacity-40">•</span>
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(conversation.updated_at || conversation.created_at!), { addSuffix: true })}
            </span>
          </div>
          
          {/* Triage Quick Actions */}
          {showTriageActions && (
            <TriageQuickActions conversation={conversation} onUpdate={onUpdate} />
          )}
          </div>
        </div>
      </div>
    );
  }

  // Desktop layout
  return (
    <div
      onClick={handleClick}
      className={cn(
        "relative cursor-pointer transition-all duration-300 ease-out rounded-[22px] mb-3 overflow-hidden",
        "bg-card border border-border/30 hover:border-primary/30",
        "apple-shadow hover:apple-shadow-lg spring-press",
        selected && "border-primary/50 apple-shadow-lg bg-gradient-to-br from-primary/8 via-primary/4 to-card"
      )}
    >
      {/* Priority/Status Accent Bar */}
      <div 
        className={cn(
          "absolute top-0 left-0 right-0 h-1",
          conversation.status === 'resolved' 
            ? "bg-green-500" 
            : conversation.priority 
              ? getPriorityBarColor(conversation.priority)
              : "bg-muted"
        )}
      />
      
      {/* Overdue Badge */}
      {isOverdue && (
        <Badge variant="priority-urgent" className="absolute top-4 right-4 text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full shadow-sm">
          Overdue
        </Badge>
      )}

      <div className="p-6">
        {/* Title */}
        <h3 className={cn(
          "font-semibold text-lg leading-snug mb-2.5 text-foreground line-clamp-2",
          isOverdue && "pr-20"
        )}>
          {conversation.title || 'Untitled Conversation'}
        </h3>

        {/* Description */}
        {conversation.ai_reason_for_escalation && (
          <p className="text-[15px] text-muted-foreground leading-relaxed mb-4 line-clamp-2">
            {conversation.ai_reason_for_escalation}
          </p>
        )}

        {/* Badge Row */}
        <div className="flex flex-wrap items-center gap-2.5 mb-4">
          {conversation.priority && (
            <Badge 
              variant={getPriorityVariant(conversation.priority)}
              className="rounded-full text-xs font-bold uppercase tracking-wide px-3 py-1.5 shadow-sm"
            >
              {conversation.priority}
            </Badge>
          )}
          
          <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 border-border/50 flex items-center gap-1.5">
            <ChannelIcon channel={conversation.channel} className="h-3.5 w-3.5" />
            {conversation.channel}
          </Badge>

          {/* Email Classification Badge */}
          {(() => {
            const classificationBadge = getClassificationBadge((conversation as any).email_classification);
            if (!classificationBadge) return null;
            const ClassIcon = classificationBadge.icon;
            return (
              <Badge variant="outline" className={cn("rounded-full text-xs font-semibold px-3 py-1.5 border flex items-center gap-1.5", classificationBadge.className)}>
                <ClassIcon className="h-3 w-3" />
                {classificationBadge.label}
              </Badge>
            );
          })()}

          {hasDraft && (
            <Badge variant="secondary" className="rounded-full text-xs font-semibold px-3 py-1.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-1.5">
              <FileEdit className="h-3 w-3" />
              Draft
            </Badge>
          )}

          {statusBadge && (
            <Badge variant="outline" className={cn("rounded-full text-xs font-semibold px-3 py-1.5 border flex items-center gap-1.5", statusBadge.className)}>
              <statusBadge.icon className="h-3 w-3" />
              {statusBadge.label}
            </Badge>
          )}

          {conversation.assigned_to ? (
            <Badge variant="secondary" className="rounded-full text-xs font-semibold px-3 py-1.5 flex items-center gap-1.5">
              <User className="h-3 w-3" />
              {assignedUserName || 'Assigned'}
            </Badge>
          ) : (
            <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 text-amber-600 border-amber-500/20 flex items-center gap-1.5">
              Unassigned
            </Badge>
          )}

          {conversation.customer_satisfaction && (
            <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20 flex items-center gap-1.5">
              <Star className="h-3 w-3 fill-current" />
              {conversation.customer_satisfaction}/5
            </Badge>
          )}
        </div>

        {/* Meta Row */}
        <div className="flex items-center justify-between text-[13px] text-muted-foreground font-medium">
          <span className="uppercase tracking-wide">
            {conversation.category?.replace(/_/g, ' ') || 'General'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="opacity-40">•</span>
            {formatDistanceToNow(new Date(conversation.updated_at || conversation.created_at!), { addSuffix: true })}
          </span>
        </div>
        
        {/* Triage Quick Actions */}
        {showTriageActions && (
          <TriageQuickActions conversation={conversation} onUpdate={onUpdate} />
        )}
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export const ConversationCard = memo(ConversationCardComponent, (prevProps, nextProps) => {
  // Only re-render if these props change
  return (
    prevProps.conversation.id === nextProps.conversation.id &&
    prevProps.conversation.updated_at === nextProps.conversation.updated_at &&
    prevProps.conversation.status === nextProps.conversation.status &&
    prevProps.conversation.priority === nextProps.conversation.priority &&
    prevProps.selected === nextProps.selected &&
    prevProps.showTriageActions === nextProps.showTriageActions
  );
});
