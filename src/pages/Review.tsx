import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { MobileHeader } from '@/components/sidebar/MobileHeader';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ReviewQueueItem } from '@/components/review/ReviewQueueItem';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { CategoryLabel } from '@/components/shared/CategoryLabel';
import { BackButton } from '@/components/shared/BackButton';
import { DraftReplyEditor } from '@/components/review/DraftReplyEditor';
import { ReviewExplainer } from '@/components/review/ReviewExplainer';
import { SmartBatchActions } from '@/components/review/SmartBatchActions';
import { EmailPreview } from '@/components/review/EmailPreview';
import { TriageCorrectionFlow } from '@/components/conversations/TriageCorrectionFlow';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
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
  X,
  Send,
  Home
} from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useReviewFeedback } from '@/hooks/useReviewFeedback';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import DOMPurify from 'dompurify';

// Helper to strip HTML tags and get plain text safely using DOMPurify
const stripHtml = (html: string): string => {
  if (!html) return '';
  // DOMPurify removes all HTML tags safely, preventing XSS
  return DOMPurify.sanitize(html, { 
    ALLOWED_TAGS: [], // Strip all tags
    KEEP_CONTENT: true // Keep text content
  });
};

interface ReviewConversation {
  id: string;
  title: string;
  summary_for_human: string;
  decision_bucket: string;
  why_this_needs_you: string;
  triage_confidence: number;
  created_at: string;
  channel?: string;
  email_classification?: string;
  ai_draft_response?: string;
  customer: {
    name: string;
    email: string;
  } | null;
  messages: {
    body: string;
    created_at: string;
    raw_payload?: { body?: string } | null;
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
  act_now: 'bg-red-50 text-red-700 border border-red-200',
  quick_win: 'bg-amber-50 text-amber-700 border border-amber-200',
  wait: 'bg-slate-50 text-slate-700 border border-slate-200',
  auto_handled: 'bg-green-50 text-green-700 border border-green-200',
};

type AutomationLevel = 'auto' | 'draft_first' | 'always_review';
type TonePreference = 'keep_current' | 'more_formal' | 'more_brief';
type ReviewTab = 'triage' | 'low_confidence';

interface LowConfidenceEmail {
  id: string;
  from_email: string;
  subject: string;
  body: string;
  category: string;
  confidence: number;
  direction: string;
  received_at: string;
}

export default function Review() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showChangePicker, setShowChangePicker] = useState(false);
  const [showTeachMore, setShowTeachMore] = useState(false);
  const [showDraftEditor, setShowDraftEditor] = useState(false);
  const [showCorrectionFlow, setShowCorrectionFlow] = useState(false);
  const [automationLevel, setAutomationLevel] = useState<AutomationLevel>('auto');
  const [tonePreference, setTonePreference] = useState<TonePreference>('keep_current');
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [activeTab, setActiveTab] = useState<ReviewTab>('triage');
  const [lcIndex, setLcIndex] = useState(0);
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
          email_classification,
          ai_draft_response,
          customer:customers(name, email),
          messages(body, created_at, raw_payload)
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

  // Fetch low-confidence bulk-classified emails
  const { data: lowConfidenceEmails = [], isLoading: lcLoading } = useQuery({
    queryKey: ['low-confidence-emails'],
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
        .from('email_import_queue')
        .select('id, from_email, subject, body, category, confidence, direction, received_at')
        .eq('workspace_id', userData.workspace_id)
        .eq('needs_review', true)
        .not('category', 'is', null)
        .order('confidence', { ascending: true })
        .limit(50);

      if (error) throw error;
      return (data || []) as LowConfidenceEmail[];
    },
    staleTime: 30000,
  });

  // Low-confidence correction mutation
  const lcCorrectionMutation = useMutation({
    mutationFn: async ({ emailId, correctedCategory, correctedRequiresReply }: {
      emailId: string;
      correctedCategory: string;
      correctedRequiresReply: boolean;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user.id)
        .single();

      if (!userData?.workspace_id) throw new Error('No workspace');

      const email = lowConfidenceEmails.find(e => e.id === emailId);
      
      // Classification corrections migrated to n8n — direct table update
      const { error: updateError } = await supabase
        .from('email_import_queue')
        .update({
          category: correctedCategory,
          requires_reply: correctedRequiresReply,
          needs_review: false,
          confidence: 0.9,
        })
        .eq('id', emailId);

      if (updateError) throw updateError;

      // Log correction for learning
      await supabase.from('triage_corrections').insert({
        workspace_id: userData.workspace_id,
        original_classification: email?.category,
        new_classification: correctedCategory,
        corrected_by: user.id,
        sender_email: email?.from_email,
        sender_domain: email?.from_email?.split('@')[1],
      });

      return { siblings_updated: 0, rule_created: false };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['low-confidence-emails'] });
      const msg = result?.siblings_updated > 0
        ? `Corrected! Also fixed ${result.siblings_updated} similar emails.${result.rule_created ? ` Auto-rule created for sender domain.` : ''}`
        : `Correction saved.${result?.rule_created ? ` Auto-rule created for sender domain.` : ''}`;
      toast({ title: '✅ Learned', description: msg });
      setLcIndex(prev => Math.min(prev, lowConfidenceEmails.length - 2));
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to save correction.', variant: 'destructive' });
    },
  });

  const lcConfirmMutation = useMutation({
    mutationFn: async (emailId: string) => {
      const { error } = await supabase
        .from('email_import_queue')
        .update({ needs_review: false, confidence: 0.85 })
        .eq('id', emailId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['low-confidence-emails'] });
      toast({ title: '✅ Confirmed', description: 'Classification confirmed.' });
      setLcIndex(prev => Math.min(prev, lowConfidenceEmails.length - 2));
    },
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

  // Empty state - Celebration when training is complete
  if (!isLoading && reviewQueue.length === 0) {
    if (isMobile) {
      return (
        <div className="flex flex-col h-screen bg-background overflow-hidden">
          <MobileHeader 
            onMenuClick={() => setSidebarOpen(true)}
          />
          <MobileSidebarSheet
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            onNavigate={() => setSidebarOpen(false)}
          />
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center max-w-xs">
              <div className="w-16 h-16 bg-gradient-to-br from-green-100 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-500/10">
                <Sparkles className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-lg font-semibold mb-2">BizzyBee is confident!</h2>
              <p className="text-sm text-muted-foreground break-words">
                No messages need training right now. BizzyBee is handling emails automatically.
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
          <div className="p-4 border-b">
            <BackButton to="/" label="Home" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md px-6">
              <div className="w-20 h-20 bg-gradient-to-br from-green-100 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-green-500/10">
                <Sparkles className="h-10 w-10 text-green-600" />
              </div>
              <h2 className="text-2xl font-semibold mb-3">🎉 BizzyBee is confident!</h2>
              <p className="text-muted-foreground mb-2">
                There are no messages that need training right now.
              </p>
              <p className="text-sm text-muted-foreground">
                BizzyBee is automatically handling routine emails based on what it has learned from you.
                You'll only see messages here when BizzyBee wants to double-check something new.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Mobile layout
  if (isMobile) {
    const conv = currentConversation;
    const rawEmailBody = conv?.messages?.[0]?.raw_payload?.body || conv?.messages?.[0]?.body || '';
    const emailBody = stripHtml(rawEmailBody);
    
    // Mobile Detail View
    if (mobileShowDetail && conv) {
      return (
        <div className="flex flex-col h-screen bg-background overflow-hidden">
          <MobileHeader 
            onMenuClick={() => setSidebarOpen(true)}
            showBackButton
            onBackClick={() => setMobileShowDetail(false)}
            backToText="Back"
          />
          <MobileSidebarSheet
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            onNavigate={() => setSidebarOpen(false)}
          />
          
          {/* Detail content */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-4">
              {/* Header */}
              <div>
                <h2 className="font-semibold text-base break-words">
                  {conv.customer?.name || conv.customer?.email || 'Unknown Sender'}
                </h2>
                <p className="text-xs text-muted-foreground">{conv.customer?.email || 'No email'}</p>
              </div>
              
              {/* Title */}
              <div>
                <h3 className="font-medium text-sm break-words">{conv.title}</h3>
              </div>
              
              {/* Email content preview */}
              <Card className="p-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words line-clamp-6">
                  {emailBody}
                </p>
                {emailBody.length > 300 && (
                  <Button variant="link" size="sm" className="p-0 h-auto mt-2 text-xs">
                    View full message
                  </Button>
                )}
              </Card>
              
              {/* AI Draft section */}
              {conv.ai_draft_response && (
                <Card className="p-3 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-400">AI draft ready</span>
                  </div>
                  <p className="text-xs text-muted-foreground break-words line-clamp-3">
                    {conv.ai_draft_response}
                  </p>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="mt-2 w-full"
                    onClick={() => setShowDraftEditor(true)}
                  >
                    <FileEdit className="h-3.5 w-3.5 mr-1.5" />
                    Edit & Send Reply
                  </Button>
                </Card>
              )}
              
              {/* BizzyBee thinks */}
              <Card className="p-3 bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-purple-600" />
                  <span className="text-sm font-medium text-purple-700 dark:text-purple-400">BizzyBee thinks:</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <Badge className={cn("text-xs", bucketColors[conv.decision_bucket || 'wait'])}>
                    {bucketLabels[conv.decision_bucket || 'wait']}
                  </Badge>
                  {conv.email_classification && (
                    <Badge variant="outline" className="text-xs">
                      {conv.email_classification.replace(/_/g, ' ')}
                    </Badge>
                  )}
                </div>
                {conv.why_this_needs_you && (
                  <p className="text-xs text-muted-foreground break-words">
                    {conv.why_this_needs_you}
                  </p>
                )}
              </Card>
            </div>
          </div>
          
          {/* Fixed bottom action bar */}
          <div className="flex-shrink-0 border-t bg-background p-4 space-y-2">
            <div className="flex gap-2">
              <Button 
                className="flex-1 h-11"
                onClick={handleConfirm}
                disabled={reviewMutation.isPending}
              >
                <Check className="h-4 w-4 mr-1.5" />
                Confirm
              </Button>
              <Button 
                variant="outline"
                className="flex-1 h-11"
                onClick={() => setShowChangePicker(true)}
              >
                Change
              </Button>
            </div>
            <Button 
              variant="ghost" 
              size="sm"
              className="w-full"
              onClick={handleSkip}
            >
              <SkipForward className="h-4 w-4 mr-1.5" />
              Skip for now
            </Button>
          </div>
          
          {/* Change picker bottom sheet */}
          {showChangePicker && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setShowChangePicker(false)}>
              <div 
                className="bg-background w-full rounded-t-2xl p-4 space-y-3 max-h-[60vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Change classification</h3>
                  <Button variant="ghost" size="sm" onClick={() => setShowChangePicker(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {Object.entries(bucketLabels).map(([bucket, label]) => (
                  <Button
                    key={bucket}
                    variant="outline"
                    className="w-full justify-start h-12"
                    onClick={() => { handleChange(bucket); setMobileShowDetail(false); }}
                    disabled={reviewMutation.isPending}
                  >
                    <Badge className={cn("mr-2", bucketColors[bucket])}>{label}</Badge>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }
    
    // Mobile List View
    return (
      <div className="flex flex-col h-screen bg-background overflow-hidden">
        <MobileHeader 
          onMenuClick={() => setSidebarOpen(true)}
        />
        <MobileSidebarSheet
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          onNavigate={() => setSidebarOpen(false)}
        />
        
        {/* Mobile Header with progress */}
        <div className="px-4 py-3 border-b bg-card/50 flex-shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-purple-500/10 flex-shrink-0">
              <Sparkles className="h-5 w-5 text-purple-500" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold truncate">Teach BizzyBee</h1>
              <p className="text-xs text-muted-foreground">
                {totalCount - reviewedCount} examples remaining
              </p>
            </div>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        {/* Mobile Queue List */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-2">
            {reviewQueue.map((conv, idx) => {
              const isReviewed = reviewedIds.has(conv.id);
              
              return (
                <Card 
                  key={conv.id}
                  className={cn(
                    "p-3 cursor-pointer transition-all border active:scale-[0.98]",
                    isReviewed && "opacity-50 bg-muted/30"
                  )}
                  onClick={() => {
                    setCurrentIndex(idx);
                    setMobileShowDetail(true);
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm break-words">
                        {conv.customer?.name || conv.customer?.email || 'Unknown'}
                      </p>
                      <p className="text-xs text-muted-foreground break-words line-clamp-2 mt-0.5">
                        {conv.title || conv.summary_for_human}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <Badge 
                        variant="outline" 
                        className={cn("text-xs", bucketColors[conv.decision_bucket || 'wait'])}
                      >
                        {bucketLabels[conv.decision_bucket || 'wait']}
                      </Badge>
                      {conv.ai_draft_response && (
                        <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                          Draft ready
                        </Badge>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <BackButton to="/" label="Home" />
              <Sparkles className="h-5 w-5 text-purple-500" />
              <div>
                <h1 className="text-xl font-semibold">Teach BizzyBee ✨</h1>
                <p className="text-sm text-muted-foreground">Your feedback helps BizzyBee work more independently over time</p>
              </div>
              <ReviewExplainer />
            </div>
            <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
              <Keyboard className="h-3.5 w-3.5" />
              <span>↑↓ navigate • L confirm • H change • S skip</span>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3">
            <Progress value={activeTab === 'triage' ? progress : 0} className="flex-1 h-2" />
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {activeTab === 'triage' 
                ? `${totalCount - reviewedCount} training examples remaining`
                : `${lowConfidenceEmails.length} low-confidence items`
              }
            </span>
          </div>
          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            <Button
              variant={activeTab === 'triage' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setActiveTab('triage')}
            >
              <Eye className="h-3 w-3 mr-1" />
              Triage Review
              {reviewQueue.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{reviewQueue.length}</Badge>
              )}
            </Button>
            <Button
              variant={activeTab === 'low_confidence' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setActiveTab('low_confidence')}
            >
              <Bot className="h-3 w-3 mr-1" />
              Low Confidence
              {lowConfidenceEmails.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{lowConfidenceEmails.length}</Badge>
              )}
            </Button>
          </div>
        </div>

        {/* Low Confidence Tab */}
        {activeTab === 'low_confidence' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Low-confidence list */}
            <div className="w-72 border-r flex-shrink-0 flex flex-col bg-muted/20">
              <div className="px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Low Confidence Emails
                </span>
              </div>
              <ScrollArea className="flex-1">
                {lcLoading ? (
                  <div className="p-4 text-center text-muted-foreground animate-pulse">Loading...</div>
                ) : lowConfidenceEmails.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">
                    No low-confidence emails to review
                  </div>
                ) : (
                  lowConfidenceEmails.map((email, idx) => (
                    <div
                      key={email.id}
                      className={cn(
                        "px-3 py-2.5 border-b cursor-pointer transition-colors",
                        idx === lcIndex ? "bg-accent" : "hover:bg-muted/50"
                      )}
                      onClick={() => setLcIndex(idx)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium truncate max-w-[160px]">
                          {email.from_email || 'Unknown'}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1 h-4">
                          {Math.round((email.confidence || 0) * 100)}%
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{email.subject || '(no subject)'}</p>
                      <Badge variant="secondary" className="text-[10px] mt-1">{email.category}</Badge>
                    </div>
                  ))
                )}
              </ScrollArea>
            </div>

            {/* Right: Detail + actions */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {lowConfidenceEmails[lcIndex] ? (() => {
                const lcEmail = lowConfidenceEmails[lcIndex];
                return (
                  <>
                    <div className="p-6 border-b">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h2 className="font-semibold text-lg">{lcEmail.subject || '(no subject)'}</h2>
                          <p className="text-sm text-muted-foreground">From: {lcEmail.from_email}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            AI classified: <span className="font-semibold ml-1">{lcEmail.category}</span>
                          </Badge>
                          <Badge variant="secondary">
                            {Math.round((lcEmail.confidence || 0) * 100)}% confident
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <ScrollArea className="flex-1 p-6">
                      <div className="max-w-2xl">
                        <p className="text-sm whitespace-pre-wrap">{(lcEmail.body || '').substring(0, 1000)}</p>
                      </div>
                    </ScrollArea>
                    <div className="border-t p-4 flex items-center gap-3">
                      <Button
                        onClick={() => lcConfirmMutation.mutate(lcEmail.id)}
                        disabled={lcConfirmMutation.isPending}
                        className="gap-1.5"
                      >
                        <Check className="h-4 w-4" />
                        Looks right
                      </Button>
                      <div className="flex items-center gap-1.5 ml-2">
                        <span className="text-sm text-muted-foreground">Change to:</span>
                        {['inquiry', 'booking', 'quote', 'complaint', 'follow_up', 'spam', 'notification', 'personal'].filter(c => c !== lcEmail.category).map(cat => (
                          <Button
                            key={cat}
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => lcCorrectionMutation.mutate({
                              emailId: lcEmail.id,
                              correctedCategory: cat,
                              correctedRequiresReply: !['spam', 'notification'].includes(cat),
                            })}
                            disabled={lcCorrectionMutation.isPending}
                          >
                            {cat.replace('_', ' ')}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </>
                );
              })() : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  No low-confidence emails to review
                </div>
              )}
            </div>
          </div>
        )}

        {/* Triage Review - Split panel layout */}
        {activeTab === 'triage' && <div className="flex-1 flex overflow-hidden">
          {/* Left: Queue list */}
          <div className="w-72 border-r flex-shrink-0 flex flex-col bg-muted/20">
            {/* Queue header with batch actions */}
            <div className="px-3 py-2 border-b bg-muted/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Training Queue
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

            {/* Smart batch actions */}
            {!isMultiSelectMode && (
              <SmartBatchActions
                reviewQueue={reviewQueue}
                reviewedIds={reviewedIds}
                onBatchApprove={(ids) => {
                  batchReviewMutation.mutate({
                    conversationIds: ids,
                    outcome: 'confirmed',
                  });
                }}
                isPending={batchReviewMutation.isPending}
              />
            )}
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
                  <EmailPreview
                    body={currentConversation.messages[0]?.body || ''}
                    summary={currentConversation.summary_for_human}
                    maxLength={600}
                    rawHtmlBody={(currentConversation.messages[0]?.raw_payload as { body?: string })?.body}
                  />

                  {/* AI Draft Available */}
                  {currentConversation.ai_draft_response && (
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800 mb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-green-600" />
                          <span className="text-sm font-medium text-green-700 dark:text-green-300">
                            AI draft ready
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5 border-green-300 text-green-700 hover:bg-green-100"
                          onClick={() => setShowDraftEditor(true)}
                        >
                          <Send className="h-3 w-3" />
                          Edit & Send Reply
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                        {currentConversation.ai_draft_response.substring(0, 150)}...
                      </p>
                    </div>
                  )}

                  {/* BizzyBee's decision */}
                  <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-4 w-4 text-purple-500" />
                      <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                        BizzyBee thinks:
                      </span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge className={bucketColors[currentConversation.decision_bucket] || 'bg-gray-500'}>
                        {bucketLabels[currentConversation.decision_bucket] || currentConversation.decision_bucket}
                      </Badge>
                      {/* Editable classification type */}
                      <CategoryLabel 
                        classification={currentConversation.email_classification} 
                        size="sm" 
                        editable={true}
                        onClick={() => setShowCorrectionFlow(true)}
                      />
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
                          className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
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
        </div>}
      </div>

      {/* Draft Reply Editor Sheet */}
      {currentConversation && currentConversation.ai_draft_response && (
        <DraftReplyEditor
          open={showDraftEditor}
          onOpenChange={setShowDraftEditor}
          conversationId={currentConversation.id}
          conversationTitle={currentConversation.title || 'No subject'}
          customerEmail={currentConversation.customer?.email || ''}
          aiDraft={currentConversation.ai_draft_response}
          onSent={() => {
            // Move to next unreviewed item
            const nextUnreviewedIndex = reviewQueue.findIndex((conv, idx) => 
              idx > currentIndex && !reviewedIds.has(conv.id)
            );
            if (nextUnreviewedIndex !== -1) {
              setCurrentIndex(nextUnreviewedIndex);
            }
          }}
        />
      )}

      {/* Classification Correction Dialog */}
      {currentConversation && (
        <TriageCorrectionFlow
          conversation={{
            id: currentConversation.id,
            title: currentConversation.title,
            channel: currentConversation.channel || 'email',
            email_classification: currentConversation.email_classification,
            requires_reply: currentConversation.decision_bucket !== 'auto_handled' && currentConversation.decision_bucket !== 'wait',
            customer: currentConversation.customer,
          } as any}
          open={showCorrectionFlow}
          onOpenChange={setShowCorrectionFlow}
          onUpdate={() => {
            queryClient.invalidateQueries({ queryKey: ['review-queue'] });
          }}
        />
      )}
    </div>
  );
}
