import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  ChevronDown, 
  ChevronRight, 
  Check, 
  RefreshCw, 
  SkipForward, 
  Sparkles,
  Bot,
  FileEdit,
  Eye
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
  customer: {
    name: string;
    email: string;
  } | null;
  messages: {
    body: string;
    created_at: string;
  }[];
}

const bucketLabels: Record<string, string> = {
  act_now: 'To Reply (Urgent)',
  quick_win: 'To Reply (Quick)',
  wait: 'FYI',
  auto_handled: 'Done (Auto)',
};

const bucketColors: Record<string, string> = {
  act_now: 'bg-destructive text-destructive-foreground',
  quick_win: 'bg-amber-500 text-white',
  wait: 'bg-blue-500 text-white',
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

      const currentConversation = reviewQueue[currentIndex];
      const senderEmail = currentConversation?.customer?.email;
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
          original_classification: currentConversation?.decision_bucket,
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
          // Update existing rule
          await supabase
            .from('sender_rules')
            .update({
              automation_level: teachingData.automationLevel,
              tone_preference: teachingData.tonePreference,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingRule.id);
        } else {
          // Create new rule
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

      // Move to next or complete
      if (currentIndex >= reviewQueue.length - 1) {
        celebrateQueueComplete(reviewQueue.length);
        setCurrentIndex(0);
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

  const currentConversation = reviewQueue[currentIndex];
  const progress = reviewQueue.length > 0 
    ? ((currentIndex) / reviewQueue.length) * 100 
    : 0;

  const handleConfirm = () => {
    if (!currentConversation) return;
    
    const hasTeachingData = showTeachMore && (automationLevel !== 'auto' || tonePreference !== 'keep_current');
    
    reviewMutation.mutate({
      conversationId: currentConversation.id,
      outcome: 'confirmed',
      teachingData: hasTeachingData ? { automationLevel, tonePreference } : undefined,
    });
  };

  const handleChange = (newBucket: string) => {
    if (!currentConversation) return;
    
    const hasTeachingData = showTeachMore && (automationLevel !== 'auto' || tonePreference !== 'keep_current');
    
    reviewMutation.mutate({
      conversationId: currentConversation.id,
      outcome: 'changed',
      newBucket,
      teachingData: hasTeachingData ? { automationLevel, tonePreference } : undefined,
    });
  };

  const handleSkip = () => {
    if (currentIndex < reviewQueue.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setShowChangePicker(false);
      setShowTeachMore(false);
    }
  };

  const senderDomain = currentConversation?.customer?.email?.split('@')[1];

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
        <div className="border-b p-6">
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="h-6 w-6 text-purple-500" />
            <h1 className="text-2xl font-semibold">Teach BizzyBee</h1>
          </div>
          <p className="text-muted-foreground mb-4">
            Your feedback helps BizzyBee learn how your business works
          </p>
          <div className="flex items-center gap-4">
            <Progress value={progress} className="flex-1 h-2" />
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {currentIndex + 1} of {reviewQueue.length}
            </span>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
          {isLoading ? (
            <div className="animate-pulse">Loading...</div>
          ) : currentConversation ? (
            <Card className="w-full max-w-2xl p-6 space-y-6">
              {/* Sender info */}
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">
                    {currentConversation.customer?.name || 'Unknown Sender'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {currentConversation.customer?.email || 'No email'}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground">
                  {format(new Date(currentConversation.created_at), 'MMM d, h:mm a')}
                </span>
              </div>

              {/* Subject */}
              <div>
                <h3 className="font-semibold text-lg">
                  {currentConversation.title || 'No subject'}
                </h3>
              </div>

              {/* Preview */}
              <div className="bg-muted/50 rounded-lg p-4 max-h-48 overflow-y-auto">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {currentConversation.messages[0]?.body?.substring(0, 500) || 
                   currentConversation.summary_for_human || 
                   'No preview available'}
                  {(currentConversation.messages[0]?.body?.length || 0) > 500 && '...'}
                </p>
              </div>

              {/* BizzyBee's decision */}
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
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
              <Collapsible open={showTeachMore} onOpenChange={setShowTeachMore}>
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
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={() => setShowChangePicker(true)}
                      className="flex-1"
                      disabled={reviewMutation.isPending}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Handle differently
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
                        <span className="w-2 h-2 rounded-full bg-destructive mr-2" />
                        To Reply (Urgent)
                      </Button>
                      <Button
                        variant="outline"
                        className="justify-start"
                        onClick={() => handleChange('quick_win')}
                        disabled={reviewMutation.isPending}
                      >
                        <span className="w-2 h-2 rounded-full bg-amber-500 mr-2" />
                        To Reply (Quick)
                      </Button>
                      <Button
                        variant="outline"
                        className="justify-start"
                        onClick={() => handleChange('wait')}
                        disabled={reviewMutation.isPending}
                      >
                        <span className="w-2 h-2 rounded-full bg-blue-500 mr-2" />
                        FYI
                      </Button>
                      <Button
                        variant="outline"
                        className="justify-start"
                        onClick={() => handleChange('auto_handled')}
                        disabled={reviewMutation.isPending}
                      >
                        <span className="w-2 h-2 rounded-full bg-green-500 mr-2" />
                        Done (Auto)
                      </Button>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowChangePicker(false)}
                      className="w-full"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>

              {/* Skip option */}
              {!showChangePicker && currentIndex < reviewQueue.length - 1 && (
                <div className="text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSkip}
                    className="text-muted-foreground"
                  >
                    <SkipForward className="h-4 w-4 mr-2" />
                    Skip for now
                  </Button>
                </div>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}