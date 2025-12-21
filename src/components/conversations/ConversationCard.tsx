import { memo } from 'react';
import { Conversation, DecisionBucket } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { Clock, CheckCircle2, UserPlus, FileEdit, User, Bot, AlertTriangle, MessageSquare, Hourglass, Star, Mail, Ban, Megaphone, Briefcase, Receipt, Settings2, Zap, Users, Package, Info, ThumbsUp, MessageCircle, CircleAlert, CircleCheck, CirclePause, Timer, RotateCcw, History } from 'lucide-react';
import { ChannelIcon } from '../shared/ChannelIcon';
import { cn } from '@/lib/utils';
import { useIsTablet } from '@/hooks/use-tablet';
import { useHaptics } from '@/hooks/useHaptics';
import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { TriageQuickActions } from './TriageQuickActions';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Decision bucket badge helper - PRIMARY display
const getDecisionBucketBadge = (bucket: DecisionBucket | string | null | undefined) => {
  if (!bucket) return null;
  
  const badges: Record<string, { icon: typeof CircleAlert; label: string; emoji: string; className: string }> = {
    act_now: { 
      icon: CircleAlert, 
      label: 'Act Now', 
      emoji: '🔴',
      className: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30 font-bold' 
    },
    quick_win: { 
      icon: Timer, 
      label: 'Quick Win', 
      emoji: '🟡',
      className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-bold' 
    },
    auto_handled: { 
      icon: CircleCheck, 
      label: 'Auto-Handled', 
      emoji: '🟢',
      className: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30 font-bold' 
    },
    wait: { 
      icon: CirclePause, 
      label: 'Wait', 
      emoji: '🔵',
      className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 font-bold' 
    },
  };
  
  return badges[bucket] || null;
};

// Email classification badge helper - SECONDARY display
const getClassificationBadge = (classification: string | null | undefined) => {
  if (!classification) return null;
  
  const badges: Record<string, { icon: typeof Mail; label: string; className: string }> = {
    customer_inquiry: { icon: Mail, label: 'Inquiry', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
    customer_complaint: { icon: AlertTriangle, label: 'Complaint', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
    customer_feedback: { icon: ThumbsUp, label: 'Feedback', className: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' },
    lead_new: { icon: UserPlus, label: 'New Lead', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
    lead_followup: { icon: MessageCircle, label: 'Follow-up', className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' },
    supplier_invoice: { icon: Receipt, label: 'Invoice', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
    supplier_urgent: { icon: Zap, label: 'Supplier', className: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20' },
    partner_request: { icon: Users, label: 'Partner', className: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' },
    automated_notification: { icon: Bot, label: 'Auto', className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20' },
    spam_phishing: { icon: Ban, label: 'Spam', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
    marketing_newsletter: { icon: Megaphone, label: 'Marketing', className: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20' },
    recruitment_hr: { icon: Briefcase, label: 'Recruitment', className: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' },
    receipt_confirmation: { icon: Receipt, label: 'Receipt', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
    internal_system: { icon: Settings2, label: 'System', className: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20' },
    informational_only: { icon: Info, label: 'Info', className: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20' },
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

  const [hasDraft, setHasDraft] = useState(false);
  const [assignedUserName, setAssignedUserName] = useState<string | null>(null);
  const [correction, setCorrection] = useState<{
    original_classification: string | null;
    new_classification: string | null;
    original_requires_reply: boolean | null;
    new_requires_reply: boolean | null;
  } | null>(null);
  const [isReopening, setIsReopening] = useState(false);

  useEffect(() => {
    const draftKey = `draft-${conversation.id}`;
    const draft = localStorage.getItem(draftKey);
    setHasDraft(!!draft && draft.trim().length > 0);
  }, [conversation.id]);

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

  // Fetch correction history for this conversation
  useEffect(() => {
    const fetchCorrection = async () => {
      const { data } = await supabase
        .from('triage_corrections')
        .select('original_classification, new_classification, original_requires_reply, new_requires_reply')
        .eq('conversation_id', conversation.id)
        .order('corrected_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data) {
        setCorrection(data);
      }
    };
    
    fetchCorrection();
  }, [conversation.id]);

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

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isTouchDevice || !isTablet) return;
    touchStartX.current = e.touches[0].clientX;
    setIsSwiping(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isTouchDevice || !isTablet) return;
    const currentX = e.touches[0].clientX;
    const distance = currentX - touchStartX.current;
    
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
    
    if (absDistance >= SWIPE_THRESHOLD) {
      if (swipeDistance > 0) {
        await handleAssignToMe();
      } else {
        await handleResolve();
      }
    }
    
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

  const handleReopen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsReopening(true);
    trigger('medium');
    
    const { error } = await supabase
      .from('conversations')
      .update({ 
        status: 'open',
        decision_bucket: 'quick_win',
        requires_reply: true,
        resolved_at: null
      })
      .eq('id', conversation.id);

    if (error) {
      toast({ 
        title: "Failed to reopen", 
        description: error.message, 
        variant: "destructive" 
      });
      trigger('warning');
    } else {
      toast({ title: "Conversation reopened", description: "Moved to Needs Me queue" });
      onUpdate?.();
    }
    setIsReopening(false);
  };

  // Helper to format classification for display
  const formatClassification = (classification: string | null) => {
    if (!classification) return 'Unknown';
    return classification
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  };
  
  const getBucketBarColor = (bucket: string | null | undefined) => {
    if (!bucket) return 'bg-muted';
    switch (bucket) {
      case 'act_now': return 'bg-red-500';
      case 'quick_win': return 'bg-amber-500';
      case 'auto_handled': return 'bg-green-500';
      case 'wait': return 'bg-blue-500';
      default: return 'bg-muted';
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
  
  // Get decision bucket badge (primary)
  const bucketBadge = getDecisionBucketBadge(conversation.decision_bucket);
  
  // Determine the primary description to show
  const primaryDescription = conversation.why_this_needs_you || conversation.summary_for_human || conversation.ai_reason_for_escalation;

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
        {/* Swipe backgrounds */}
        <div 
          className="absolute inset-0 bg-blue-500/20 flex items-center justify-end pr-8 pointer-events-none transition-opacity duration-200"
          style={{ opacity: !isRightSwipe && isSwiping ? swipeProgress : 0 }}
        >
          <CheckCircle2 
            className="h-6 w-6 text-blue-600 dark:text-blue-400 transition-transform duration-200" 
            style={{ transform: `scale(${swipeProgress})` }}
          />
        </div>

        <div 
          className="absolute inset-0 bg-green-500/20 flex items-center justify-start pl-8 pointer-events-none transition-opacity duration-200"
          style={{ opacity: isRightSwipe && isSwiping ? swipeProgress : 0 }}
        >
          <UserPlus 
            className="h-6 w-6 text-green-600 dark:text-green-400 transition-transform duration-200" 
            style={{ transform: `scale(${swipeProgress})` }}
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
          {/* Decision Bucket Accent Bar - PRIMARY indicator */}
          <div 
            className={cn(
              "absolute top-0 left-0 right-0 h-1.5",
              conversation.decision_bucket 
                ? getBucketBarColor(conversation.decision_bucket)
                : conversation.status === 'resolved' 
                  ? "bg-green-500" 
                  : getPriorityBarColor(conversation.priority)
            )}
          />
          
          {isOverdue && (
            <Badge variant="destructive" className="absolute top-4 right-4 text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full shadow-sm">
              Overdue
            </Badge>
          )}

          <div className="p-5">
            {/* Decision Bucket Badge - FIRST AND PROMINENT */}
            {bucketBadge && (
              <div className="mb-3">
                <Badge 
                  variant="outline" 
                  className={cn(
                    "rounded-full text-sm px-4 py-2 border-2 flex items-center gap-2 w-fit",
                    bucketBadge.className
                  )}
                >
                  <span className="text-base">{bucketBadge.emoji}</span>
                  <bucketBadge.icon className="h-4 w-4" />
                  {bucketBadge.label}
                </Badge>
              </div>
            )}

            {/* Title */}
            <h3 className={cn(
              "font-semibold text-base leading-snug mb-2 line-clamp-2 text-foreground",
              isOverdue && !bucketBadge && "pr-20"
            )}>
              {conversation.title || 'Untitled Conversation'}
            </h3>

            {/* Why This Needs You - PRIMARY description */}
            {primaryDescription && (
              <p className={cn(
                "text-sm leading-relaxed mb-3 line-clamp-2",
                conversation.why_this_needs_you 
                  ? "text-foreground font-medium" 
                  : "text-muted-foreground"
              )}>
                {primaryDescription}
              </p>
            )}

            {/* Secondary Badge Row - Compact */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <Badge variant="outline" className="rounded-full text-[11px] font-medium px-2.5 py-1 border-border/50 flex items-center gap-1">
                <ChannelIcon channel={conversation.channel} className="h-3 w-3" />
                {conversation.channel}
              </Badge>

              {/* Classification badge - secondary */}
              {(() => {
                const classificationBadge = getClassificationBadge(conversation.email_classification);
                if (!classificationBadge) return null;
                const ClassIcon = classificationBadge.icon;
                return (
                  <Badge variant="outline" className={cn("rounded-full text-[11px] font-medium px-2.5 py-1 border flex items-center gap-1", classificationBadge.className)}>
                    <ClassIcon className="h-3 w-3" />
                    {classificationBadge.label}
                  </Badge>
                );
              })()}

              {hasDraft && (
                <Badge variant="secondary" className="rounded-full text-[11px] font-medium px-2.5 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-1">
                  <FileEdit className="h-3 w-3" />
                  Draft
                </Badge>
              )}

              {conversation.assigned_to && (
                <Badge variant="secondary" className="rounded-full text-[11px] font-medium px-2.5 py-1 flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {assignedUserName || 'Assigned'}
                </Badge>
              )}

              {/* Correction badge - shows when this email was reclassified */}
              {correction && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="rounded-full text-[11px] font-medium px-2.5 py-1 bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 flex items-center gap-1 cursor-help">
                      <History className="h-3 w-3" />
                      Corrected
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-xs">
                      <span className="font-semibold">You corrected this:</span><br />
                      {correction.original_classification && correction.new_classification && (
                        <>Classification: {formatClassification(correction.original_classification)} → {formatClassification(correction.new_classification)}<br /></>
                      )}
                      {correction.original_requires_reply !== correction.new_requires_reply && (
                        <>Reply needed: {correction.original_requires_reply ? 'Yes' : 'No'} → {correction.new_requires_reply ? 'Yes' : 'No'}</>
                      )}
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
              <span className="uppercase tracking-wide text-[10px]">
                {conversation.category?.replace(/_/g, ' ') || 'General'}
              </span>
              <div className="flex items-center gap-2">
                {/* Reopen button for resolved/auto-handled conversations */}
                {(conversation.status === 'resolved' || conversation.decision_bucket === 'auto_handled') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReopen}
                    disabled={isReopening}
                    className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Reopen
                  </Button>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(conversation.updated_at || conversation.created_at!), { addSuffix: true })}
                </span>
              </div>
            </div>
          
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
      {/* Decision Bucket Accent Bar */}
      <div 
        className={cn(
          "absolute top-0 left-0 right-0 h-1.5",
          conversation.decision_bucket 
            ? getBucketBarColor(conversation.decision_bucket)
            : conversation.status === 'resolved' 
              ? "bg-green-500" 
              : getPriorityBarColor(conversation.priority)
        )}
      />
      
      {isOverdue && (
        <Badge variant="destructive" className="absolute top-4 right-4 text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full shadow-sm">
          Overdue
        </Badge>
      )}

      <div className="p-6">
        {/* Decision Bucket Badge - FIRST AND PROMINENT */}
        {bucketBadge && (
          <div className="mb-3">
            <Badge 
              variant="outline" 
              className={cn(
                "rounded-full text-sm px-4 py-2 border-2 flex items-center gap-2 w-fit",
                bucketBadge.className
              )}
            >
              <span className="text-base">{bucketBadge.emoji}</span>
              <bucketBadge.icon className="h-4 w-4" />
              {bucketBadge.label}
            </Badge>
          </div>
        )}

        {/* Title */}
        <h3 className={cn(
          "font-semibold text-lg leading-snug mb-2 text-foreground line-clamp-2",
          isOverdue && !bucketBadge && "pr-20"
        )}>
          {conversation.title || 'Untitled Conversation'}
        </h3>

        {/* Why This Needs You - PRIMARY description */}
        {primaryDescription && (
          <p className={cn(
            "text-[15px] leading-relaxed mb-4 line-clamp-2",
            conversation.why_this_needs_you 
              ? "text-foreground font-medium" 
              : "text-muted-foreground"
          )}>
            {primaryDescription}
          </p>
        )}

        {/* Secondary Badge Row */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 border-border/50 flex items-center gap-1.5">
            <ChannelIcon channel={conversation.channel} className="h-3.5 w-3.5" />
            {conversation.channel}
          </Badge>

          {/* Classification badge - secondary */}
          {(() => {
            const classificationBadge = getClassificationBadge(conversation.email_classification);
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

          {/* Low confidence indicator */}
          {conversation.triage_confidence !== null && conversation.triage_confidence !== undefined && conversation.triage_confidence < 0.7 && (
            <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              Review
            </Badge>
          )}

          {/* Correction badge - shows when this email was reclassified */}
          {correction && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="rounded-full text-xs font-semibold px-3 py-1.5 bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 flex items-center gap-1.5 cursor-help">
                  <History className="h-3 w-3" />
                  Corrected
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-xs">
                  <span className="font-semibold">You corrected this:</span><br />
                  {correction.original_classification && correction.new_classification && (
                    <>Classification: {formatClassification(correction.original_classification)} → {formatClassification(correction.new_classification)}<br /></>
                  )}
                  {correction.original_requires_reply !== correction.new_requires_reply && (
                    <>Reply needed: {correction.original_requires_reply ? 'Yes' : 'No'} → {correction.new_requires_reply ? 'Yes' : 'No'}</>
                  )}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Meta Row */}
        <div className="flex items-center justify-between text-[13px] text-muted-foreground font-medium">
          <span className="uppercase tracking-wide text-[11px]">
            {conversation.category?.replace(/_/g, ' ') || 'General'}
          </span>
          <div className="flex items-center gap-2">
            {/* Reopen button for resolved/auto-handled conversations */}
            {(conversation.status === 'resolved' || conversation.decision_bucket === 'auto_handled') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReopen}
                disabled={isReopening}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Reopen
              </Button>
            )}
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {formatDistanceToNow(new Date(conversation.updated_at || conversation.created_at!), { addSuffix: true })}
            </span>
          </div>
        </div>
        
        {showTriageActions && (
          <TriageQuickActions conversation={conversation} onUpdate={onUpdate} />
        )}
      </div>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders
export const ConversationCard = memo(ConversationCardComponent, (prevProps, nextProps) => {
  return (
    prevProps.conversation.id === nextProps.conversation.id &&
    prevProps.conversation.updated_at === nextProps.conversation.updated_at &&
    prevProps.conversation.status === nextProps.conversation.status &&
    prevProps.conversation.priority === nextProps.conversation.priority &&
    prevProps.conversation.decision_bucket === nextProps.conversation.decision_bucket &&
    prevProps.conversation.why_this_needs_you === nextProps.conversation.why_this_needs_you &&
    prevProps.selected === nextProps.selected &&
    prevProps.showTriageActions === nextProps.showTriageActions
  );
});
