import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ReviewQueueItem } from '@/components/review/ReviewQueueItem';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  ChevronDown, 
  ChevronRight, 
  Check, 
  RefreshCw, 
  SkipForward, 
  Sparkles,
  Bot,
  FileEdit,
  Eye,
  Keyboard,
  CheckCheck,
  X
} from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useReviewFeedback } from '@/hooks/useReviewFeedback';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';

interface ReviewConversation {
  id: string;
  title: string;
  summary_for_human: string;
  decision_bucket: string;
  why_this_needs_you: string;
  triage_confidence: number;
  created_at: string;
  channel?: string;
  customer: {
    name: string;
    email: string;
  } | null;
  messages: {
    body: string;
    created_at: string;
  }[];
}

// New state-based labels
const bucketLabels: Record<string, string> = {
  act_now: 'Needs attention',
  quick_win: 'Needs reply',
  wait: 'FYI',
  auto_handled: 'Done',
};

const bucketColors: Record<string, string> = {
  act_now: 'bg-red-500 text-white',
  quick_win: 'bg-amber-500 text-white',
  wait: 'bg-slate-500 text-white',
  auto_handled: 'bg-green-500 text-white',
};

type AutomationLevel = 'auto' | 'draft_first' | 'always_review';
type TonePreference = 'keep_current' | 'more_formal' | 'more_brief';

export default function Review() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showChangePicker, setShowChangePicker] = useState(false);
  const [showTeachMore, setShowTeachMore] = useState(false);
  const [automationLevel, setAutomationLevel] = useState<AutomationLevel>('auto');
  const [tonePreference, setTonePreference] = useState<TonePreference>('keep_current');
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { celebrateConfirmation, celebratePatternLearned, celebrateQueueComplete } = useReviewFeedback();

  // Fetch conversations needing review
  const { data: reviewQueue = [], isLoading } = useQuery({
    queryKey: ['review-queue'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user.id)
        .single();

      if (!userData?.workspace_id) return [];

      const { data, error } = await supabase
        .from('conversations')
        .select(`
          id,
          title,
          summary_for_human,
          decision_bucket,
          why_this_needs_you,
          triage_confidence,
          created_at,
          channel,
          customer:customers(name, email),
          messages(body, created_at)
        `)
        .eq('workspace_id', userData.workspace_id)
        .eq('needs_review', true)
        .is('reviewed_at', null)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      return (data || []).map(c => ({
        ...c,
        customer: c.customer?.[0] || null,
        messages: c.messages || [],
      })) as ReviewConversation[];
    },
    staleTime: 30000,
  });

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if in input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      switch (e.key) {
        case 'ArrowUp':
        case 'k':
          e.preventDefault();
          setCurrentIndex(prev => Math.max(0, prev - 1));
          setShowChangePicker(false);
          break;
        case 'ArrowDown':
        case 'j':
          e.preventDefault();
          setCurrentIndex(prev => Math.min(reviewQueue.length - 1, prev + 1));
          setShowChangePicker(false);
          break;
        case 'Enter':
        case 'l':
          if (!showChangePicker && currentConversation) {
            e.preventDefault();
            handleConfirm();
          }
          break;
        case 'h':
          if (!showChangePicker) {
            e.preventDefault();
            setShowChangePicker(true);
          }
          break;
        case 's':
          e.preventDefault();
          handleSkip();
          break;
        case 'Escape':
          if (showChangePicker) {
            e.preventDefault();
            setShowChangePicker(false);
          }
          break;
        case '1':
          if (showChangePicker) {
            e.preventDefault();
            handleChange('act_now');
          }
          break;
        case '2':
          if (showChangePicker) {
            e.preventDefault();
            handleChange('quick_win');
          }
          break;
        case '3':
          if (showChangePicker) {
            e.preventDefault();
            handleChange('wait');
          }
          break;
        case '4':
          if (showChangePicker) {
            e.preventDefault();
            handleChange('auto_handled');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reviewQueue.length, showChangePicker, currentIndex]);

  // Mutation for confirming/changing review with teaching data
  const reviewMutation = useMutation({
    mutationFn: async ({ 
      conversationId, 
      outcome, 
      newBucket,
      teachingData
    }: { 
      conversationId: string; 
      outcome: 'confirmed' | 'changed';
      newBucket?: string;
      teachingData?: {
        automationLevel: AutomationLevel;
        tonePreference: TonePreference;
      };
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const updates: Record<string, any> = {
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
        review_outcome: outcome,
        needs_review: false,
      };

      if (newBucket) {
        updates.decision_bucket = newBucket;
      }

      const { error } = await supabase
        .from('conversations')
        .update(updates)
        .eq('id', conversationId);

      if (error) throw error;

      const currentConv = reviewQueue[currentIndex];
      const senderEmail = currentConv?.customer?.email;
      const senderDomain = senderEmail?.split('@')[1];

      // Get workspace ID
      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user.id)
        .single();

      // Log to triage_corrections if changed
      if (outcome === 'changed' && newBucket) {
        await supabase.from('triage_corrections').insert({
          conversation_id: conversationId,
          original_classification: currentConv?.decision_bucket,
          new_classification: newBucket,
          corrected_by: user.id,
          sender_email: senderEmail,
          sender_domain: senderDomain,
          workspace_id: userData?.workspace_id,
        });
      }

      // Update or create sender rule with teaching data
      if (senderDomain && userData?.workspace_id && teachingData) {
        const { data: existingRule } = await supabase
          .from('sender_rules')
          .select('id')
          .eq('sender_pattern', `@${senderDomain}`)
          .eq('workspace_id', userData.workspace_id)
          .single();

        if (existingRule) {
          await supabase
            .from('sender_rules')
            .update({
              automation_level: teachingData.automationLevel,
              tone_preference: teachingData.tonePreference,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingRule.id);
        } else {
          await supabase.from('sender_rules').insert({
            workspace_id: userData.workspace_id,
            sender_pattern: `@${senderDomain}`,
            default_classification: newBucket === 'auto_handled' ? 'automated_notification' : 'customer_inquiry',
            default_requires_reply: newBucket !== 'auto_handled' && newBucket !== 'wait',
            automation_level: teachingData.automationLevel,
            tone_preference: teachingData.tonePreference,
          });
        }

        return { ruleCreated: true, domain: senderDomain };
      }

      // Check if we should create a rule (3+ corrections from same domain)
      if (outcome === 'changed' && senderDomain && userData?.workspace_id) {
        const { count } = await supabase
          .from('triage_corrections')
          .select('id', { count: 'exact', head: true })
          .eq('sender_domain', senderDomain)
          .eq('workspace_id', userData.workspace_id);

        if (count && count >= 3) {
          const { data: existingRule } = await supabase
            .from('sender_rules')
            .select('id')
            .eq('sender_pattern', `@${senderDomain}`)
            .eq('workspace_id', userData.workspace_id)
            .single();

          if (!existingRule) {
            await supabase.from('sender_rules').insert({
              workspace_id: userData.workspace_id,
              sender_pattern: `@${senderDomain}`,
              default_classification: newBucket === 'auto_handled' ? 'automated_notification' : 'customer_inquiry',
              default_requires_reply: newBucket !== 'auto_handled' && newBucket !== 'wait',
            });

            return { ruleCreated: true, domain: senderDomain };
          }
        }
      }

      return { ruleCreated: false };
    },
    onSuccess: (result, variables) => {
      // Mark this conversation as reviewed locally
      setReviewedIds(prev => new Set([...prev, variables.conversationId]));
      
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-view-counts'] });

      if (variables.outcome === 'confirmed') {
        celebrateConfirmation();
      }

      if (result.ruleCreated && result.domain) {
        celebratePatternLearned(result.domain);
      }

      // Reset teaching options
      setShowTeachMore(false);
      setAutomationLevel('auto');
      setTonePreference('keep_current');
      setShowChangePicker(false);

      // Move to next unreviewed item
      const nextUnreviewedIndex = reviewQueue.findIndex((conv, idx) => 
        idx > currentIndex && !reviewedIds.has(conv.id) && conv.id !== variables.conversationId
      );
      
      if (nextUnreviewedIndex !== -1) {
        setCurrentIndex(nextUnreviewedIndex);
      } else if (reviewedIds.size + 1 >= reviewQueue.length) {
        celebrateQueueComplete(reviewQueue.length);
      }
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save review. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Batch review mutation
  const batchReviewMutation = useMutation({
    mutationFn: async ({ 
      conversationIds, 
      outcome, 
      newBucket 
    }: { 
      conversationIds: string[]; 
      outcome: 'confirmed' | 'changed';
      newBucket?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const updates: Record<string, any> = {
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
        review_outcome: outcome,
        needs_review: false,
      };

      if (newBucket) {
        updates.decision_bucket = newBucket;
      }

      const { error } = await supabase
        .from('conversations')
        .update(updates)
        .in('id', conversationIds);

      if (error) throw error;

      return { count: conversationIds.length };
    },
    onSuccess: (result, variables) => {
      // Mark all as reviewed locally
      setReviewedIds(prev => {
        const newSet = new Set(prev);
        variables.conversationIds.forEach(id => newSet.add(id));
        return newSet;
      });
      
      // Clear selection
      setSelectedIds(new Set());
      setIsMultiSelectMode(false);
      
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-view-counts'] });

      toast({
        title: 'Batch review complete',
        description: `${result.count} items reviewed`,
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to batch review. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const currentConversation = reviewQueue[currentIndex];
  const reviewedCount = reviewedIds.size;
  const totalCount = reviewQueue.length;
  const progress = totalCount > 0 ? (reviewedCount / totalCount) * 100 : 0;

  // Get current domain for batch actions
  const senderDomain = currentConversation?.customer?.email?.split('@')[1];

  // Get all conversations from the same domain
  const sameDomainConversations = useMemo(() => {
    if (!senderDomain) return [];
    return reviewQueue.filter(conv => 
      conv.customer?.email?.endsWith(`@${senderDomain}`) && 
      !reviewedIds.has(conv.id)
    );
  }, [reviewQueue, senderDomain, reviewedIds]);

  // Handle multi-select click with shift support
  const handleItemClick = useCallback((index: number, event: React.MouseEvent) => {
    if (isMultiSelectMode) {
      const convId = reviewQueue[index].id;
      
      if (event.shiftKey && lastClickedIndex !== null) {
        // Shift-click: select range
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        setSelectedIds(prev => {
          const newSet = new Set(prev);
          for (let i = start; i <= end; i++) {
            newSet.add(reviewQueue[i].id);
          }
          return newSet;
        });
      } else {
        // Regular click: toggle selection
        setSelectedIds(prev => {
          const newSet = new Set(prev);
          if (newSet.has(convId)) {
            newSet.delete(convId);
          } else {
            newSet.add(convId);
          }
          return newSet;
        });
      }
      setLastClickedIndex(index);
    } else {
      setCurrentIndex(index);
      setShowChangePicker(false);
    }
  }, [isMultiSelectMode, lastClickedIndex, reviewQueue]);

  // Toggle item selection
  const toggleSelection = useCallback((convId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(convId)) {
        newSet.delete(convId);
      } else {
        newSet.add(convId);
      }
      return newSet;
    });
  }, []);

  // Select all unreviewed
  const selectAll = useCallback(() => {
    const unreviewedIds = reviewQueue
      .filter(conv => !reviewedIds.has(conv.id))
      .map(conv => conv.id);
    setSelectedIds(new Set(unreviewedIds));
  }, [reviewQueue, reviewedIds]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsMultiSelectMode(false);
  }, []);

  // Batch approve all from same domain
  const handleBatchApproveDomain = useCallback(() => {
    if (sameDomainConversations.length === 0) return;
    
    batchReviewMutation.mutate({
      conversationIds: sameDomainConversations.map(c => c.id),
      outcome: 'confirmed',
    });
  }, [sameDomainConversations, batchReviewMutation]);

  // Batch mark selected as specific bucket
  const handleBatchAction = useCallback((bucket: string) => {
    if (selectedIds.size === 0) return;
    
    batchReviewMutation.mutate({
      conversationIds: Array.from(selectedIds),
      outcome: 'changed',
      newBucket: bucket,
    });
  }, [selectedIds, batchReviewMutation]);

  // Batch confirm selected
  const handleBatchConfirm = useCallback(() => {
    if (selectedIds.size === 0) return;
    
    batchReviewMutation.mutate({
      conversationIds: Array.from(selectedIds),
      outcome: 'confirmed',
    });
  }, [selectedIds, batchReviewMutation]);

  const handleConfirm = useCallback(() => {
    if (!currentConversation) return;
    
    const hasTeachingData = showTeachMore && (automationLevel !== 'auto' || tonePreference !== 'keep_current');
    
    reviewMutation.mutate({
      conversationId: currentConversation.id,
      outcome: 'confirmed',
      teachingData: hasTeachingData ? { automationLevel, tonePreference } : undefined,
    });
  }, [currentConversation, showTeachMore, automationLevel, tonePreference, reviewMutation]);

  const handleChange = useCallback((newBucket: string) => {
    if (!currentConversation) return;
    
    const hasTeachingData = showTeachMore && (automationLevel !== 'auto' || tonePreference !== 'keep_current');
    
    reviewMutation.mutate({
      conversationId: currentConversation.id,
      outcome: 'changed',
      newBucket,
      teachingData: hasTeachingData ? { automationLevel, tonePreference } : undefined,
    });
  }, [currentConversation, showTeachMore, automationLevel, tonePreference, reviewMutation]);

  const handleSkip = useCallback(() => {
    if (currentIndex < reviewQueue.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setShowChangePicker(false);
      setShowTeachMore(false);
    }
  }, [currentIndex, reviewQueue.length]);

  // Empty state
  if (!isLoading && reviewQueue.length === 0) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">All caught up!</h2>
            <p className="text-muted-foreground">
              BizzyBee is confident about all your emails. Check back later or head to your inbox.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-purple-500" />
              <h1 className="text-xl font-semibold">Teach BizzyBee</h1>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Keyboard className="h-3.5 w-3.5" />
              <span>↑↓ navigate • L confirm • H change • S skip</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Progress value={progress} className="flex-1 h-2" />
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {reviewedCount} of {totalCount} reviewed
            </span>
          </div>
        </div>

        {/* Split panel layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Queue list */}
          <div className="w-72 border-r flex-shrink-0 flex flex-col bg-muted/20">
            {/* Queue header with batch actions */}
            <div className="px-3 py-2 border-b bg-muted/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Review Queue
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setIsMultiSelectMode(!isMultiSelectMode);
                    if (isMultiSelectMode) {
                      setSelectedIds(new Set());
                    }
                  }}
                >
                  {isMultiSelectMode ? (
                    <>
                      <X className="h-3 w-3 mr-1" />
                      Cancel
                    </>
                  ) : (
                    <>
                      <CheckCheck className="h-3 w-3 mr-1" />
                      Select
                    </>
                  )}
                </Button>
              </div>

              {/* Multi-select mode actions */}
              {isMultiSelectMode && (
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={selectAll}
                  >
                    Select all
                  </Button>
                  {selectedIds.size > 0 && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
                        onClick={handleBatchConfirm}
                        disabled={batchReviewMutation.isPending}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Approve ({selectedIds.size})
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => handleBatchAction('auto_handled')}
                        disabled={batchReviewMutation.isPending}
                      >
                        Mark done ({selectedIds.size})
                      </Button>
                    </>
                  )}
                </div>
              )}

              {/* Domain batch action */}
              {!isMultiSelectMode && senderDomain && sameDomainConversations.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-7 text-xs justify-start"
                  onClick={handleBatchApproveDomain}
                  disabled={batchReviewMutation.isPending}
                >
                  <CheckCheck className="h-3 w-3 mr-1.5" />
                  Approve all from @{senderDomain} ({sameDomainConversations.length})
                </Button>
              )}
            </div>

            <ScrollArea className="flex-1">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground animate-pulse">
                  Loading...
                </div>
              ) : (
                reviewQueue.map((conv, idx) => (
                  <ReviewQueueItem
                    key={conv.id}
                    conversation={conv}
                    isActive={idx === currentIndex && !isMultiSelectMode}
                    isReviewed={reviewedIds.has(conv.id)}
                    isSelected={selectedIds.has(conv.id)}
                    isMultiSelectMode={isMultiSelectMode}
                    onClick={(e) => handleItemClick(idx, e)}
                    onToggleSelect={() => toggleSelection(conv.id)}
                  />
                ))
              )}
            </ScrollArea>
          </div>

          {/* Right: Detail + Decision */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {isLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="animate-pulse text-muted-foreground">Loading...</div>
              </div>
            ) : currentConversation ? (
              <div className="flex-1 flex flex-col overflow-y-auto p-6">
                <Card className="flex-1 flex flex-col max-w-3xl mx-auto w-full p-6">
                  {/* Sender info */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                      {currentConversation.channel && (
                        <ChannelIcon channel={currentConversation.channel} className="h-4 w-4" />
                      )}
                      <div>
                        <p className="font-medium">
                          {currentConversation.customer?.name || 'Unknown Sender'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {currentConversation.customer?.email || 'No email'}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {format(new Date(currentConversation.created_at), 'MMM d, h:mm a')}
                    </span>
                  </div>

                  {/* Subject */}
                  <h3 className="font-semibold text-lg mb-4">
                    {currentConversation.title || 'No subject'}
                  </h3>

                  {/* Preview */}
                  <div className="bg-muted/50 rounded-lg p-4 mb-4 flex-1 max-h-48 overflow-y-auto">
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {currentConversation.messages[0]?.body?.substring(0, 500) || 
                       currentConversation.summary_for_human || 
                       'No preview available'}
                      {(currentConversation.messages[0]?.body?.length || 0) > 500 && '...'}
                    </p>
                  </div>

                  {/* BizzyBee's decision */}
                  <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-4 w-4 text-purple-500" />
                      <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                        BizzyBee thinks:
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className={bucketColors[currentConversation.decision_bucket] || 'bg-gray-500'}>
                        {bucketLabels[currentConversation.decision_bucket] || currentConversation.decision_bucket}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {currentConversation.why_this_needs_you || 'No explanation provided'}
                      </span>
                    </div>
                    {currentConversation.triage_confidence && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Confidence: {Math.round(currentConversation.triage_confidence * 100)}%
                      </p>
                    )}
                  </div>

                  {/* Teach BizzyBee More - Collapsible */}
                  <Collapsible open={showTeachMore} onOpenChange={setShowTeachMore} className="mb-4">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between text-muted-foreground hover:text-foreground">
                        <span className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4" />
                          Teach BizzyBee more (optional)
                        </span>
                        {showTeachMore ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 pt-4">
                      <div className="bg-muted/30 rounded-lg p-4 space-y-4">
                        {senderDomain && (
                          <p className="text-sm font-medium text-muted-foreground">
                            For emails from @{senderDomain}:
                          </p>
                        )}
                        
                        {/* Automation Level */}
                        <div className="space-y-3">
                          <Label className="text-sm font-medium">How should BizzyBee handle these?</Label>
                          <RadioGroup 
                            value={automationLevel} 
                            onValueChange={(val) => setAutomationLevel(val as AutomationLevel)}
                            className="space-y-2"
                          >
                            <div className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50">
                              <RadioGroupItem value="auto" id="auto" />
                              <Label htmlFor="auto" className="flex items-center gap-2 cursor-pointer font-normal">
                                <Bot className="h-4 w-4 text-green-500" />
                                Always auto-handle (don't bother me)
                              </Label>
                            </div>
                            <div className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50">
                              <RadioGroupItem value="draft_first" id="draft_first" />
                              <Label htmlFor="draft_first" className="flex items-center gap-2 cursor-pointer font-normal">
                                <FileEdit className="h-4 w-4 text-amber-500" />
                                Draft replies but ask me first
                              </Label>
                            </div>
                            <div className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50">
                              <RadioGroupItem value="always_review" id="always_review" />
                              <Label htmlFor="always_review" className="flex items-center gap-2 cursor-pointer font-normal">
                                <Eye className="h-4 w-4 text-blue-500" />
                                Always show in Review first
                              </Label>
                            </div>
                          </RadioGroup>
                        </div>

                        {/* Tone Preference */}
                        <div className="space-y-3 pt-2 border-t border-border/50">
                          <Label className="text-sm font-medium">Tone preference:</Label>
                          <RadioGroup 
                            value={tonePreference} 
                            onValueChange={(val) => setTonePreference(val as TonePreference)}
                            className="flex flex-wrap gap-4"
                          >
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="keep_current" id="keep_current" />
                              <Label htmlFor="keep_current" className="cursor-pointer font-normal">Keep current</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="more_formal" id="more_formal" />
                              <Label htmlFor="more_formal" className="cursor-pointer font-normal">More formal</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="more_brief" id="more_brief" />
                              <Label htmlFor="more_brief" className="cursor-pointer font-normal">More brief</Label>
                            </div>
                          </RadioGroup>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Actions */}
                  <div className="flex items-center gap-3 pt-2">
                    {!showChangePicker ? (
                      <>
                        <Button 
                          onClick={handleConfirm}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                          disabled={reviewMutation.isPending}
                        >
                          <Check className="h-4 w-4 mr-2" />
                          Looks right
                          <span className="ml-2 text-xs opacity-70">(L)</span>
                        </Button>
                        <Button 
                          variant="outline"
                          onClick={() => setShowChangePicker(true)}
                          className="flex-1"
                          disabled={reviewMutation.isPending}
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Handle differently
                          <span className="ml-2 text-xs opacity-70">(H)</span>
                        </Button>
                      </>
                    ) : (
                      <div className="flex-1 space-y-3">
                        <p className="text-sm font-medium">Where should this go?</p>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            className="justify-start"
                            onClick={() => handleChange('act_now')}
                            disabled={reviewMutation.isPending}
                          >
                            <span className="w-2 h-2 rounded-full bg-red-500 mr-2" />
                            Needs attention
                            <span className="ml-auto text-xs opacity-50">(1)</span>
                          </Button>
                          <Button
                            variant="outline"
                            className="justify-start"
                            onClick={() => handleChange('quick_win')}
                            disabled={reviewMutation.isPending}
                          >
                            <span className="w-2 h-2 rounded-full bg-amber-500 mr-2" />
                            Needs reply
                            <span className="ml-auto text-xs opacity-50">(2)</span>
                          </Button>
                          <Button
                            variant="outline"
                            className="justify-start"
                            onClick={() => handleChange('wait')}
                            disabled={reviewMutation.isPending}
                          >
                            <span className="w-2 h-2 rounded-full bg-slate-500 mr-2" />
                            FYI
                            <span className="ml-auto text-xs opacity-50">(3)</span>
                          </Button>
                          <Button
                            variant="outline"
                            className="justify-start"
                            onClick={() => handleChange('auto_handled')}
                            disabled={reviewMutation.isPending}
                          >
                            <span className="w-2 h-2 rounded-full bg-green-500 mr-2" />
                            Done
                            <span className="ml-auto text-xs opacity-50">(4)</span>
                          </Button>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowChangePicker(false)}
                          className="w-full"
                        >
                          Cancel (Esc)
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Skip option */}
                  {!showChangePicker && currentIndex < reviewQueue.length - 1 && (
                    <div className="text-center mt-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSkip}
                        className="text-muted-foreground"
                      >
                        <SkipForward className="h-4 w-4 mr-2" />
                        Skip for now
                        <span className="ml-2 text-xs opacity-70">(S)</span>
                      </Button>
                    </div>
                  )}
                </Card>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
