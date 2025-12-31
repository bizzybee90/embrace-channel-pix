import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { 
  ChevronLeft, 
  ChevronRight, 
  Loader2, 
  Brain, 
  CheckCircle2, 
  Mail, 
  MessageSquare,
  Sparkles,
  TrendingUp
} from 'lucide-react';
import { toast } from 'sonner';

interface InboxLearningStepProps {
  workspaceId: string;
  onComplete: (results: { 
    emailsAnalyzed: number; 
    patternsLearned: number;
    voiceProfileBuilt: boolean;
  }) => void;
  onBack: () => void;
}

interface LearningPhase {
  id: string;
  label: string;
  icon: React.ReactNode;
  status: 'pending' | 'running' | 'complete' | 'error';
  progress?: number;
  result?: string;
}

interface LearningSummary {
  totalEmailsAnalyzed: number;
  outboundAnalyzed: number;
  patternsLearned: number;
  learnedResponses: number;
  toneDescriptors: string[];
  formalityScore: number;
  topCategories: { category: string; count: number }[];
  avgResponseTimeHours?: number;
}

export function InboxLearningStep({ workspaceId, onComplete, onBack }: InboxLearningStepProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'complete'>('idle');
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [summary, setSummary] = useState<LearningSummary | null>(null);
  const [phases, setPhases] = useState<LearningPhase[]>([
    { id: 'categorize', label: 'Categorizing your emails', icon: <Mail className="h-4 w-4" />, status: 'pending' },
    { id: 'voice_profile', label: 'Learning your writing style', icon: <MessageSquare className="h-4 w-4" />, status: 'pending' },
    { id: 'patterns', label: 'Analyzing email patterns', icon: <TrendingUp className="h-4 w-4" />, status: 'pending' },
    { id: 'responses', label: 'Extracting best practices', icon: <Sparkles className="h-4 w-4" />, status: 'pending' },
  ]);

  const updatePhase = (id: string, updates: Partial<LearningPhase>) => {
    setPhases(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const runLearning = async () => {
    setStatus('running');

    try {
      // Phase 1: Init to get counts
      const { data: initData } = await supabase.functions.invoke('learn-from-inbox', {
        body: { workspace_id: workspaceId, phase: 'init' }
      });
      
      const totalEmails = initData?.totals?.conversations || 0;
      const totalOutbound = initData?.totals?.outbound || 0;

      // Phase 2: Categorize emails
      updatePhase('categorize', { status: 'running', progress: 0 });
      setCurrentPhaseIndex(0);
      
      let hasMore = true;
      let totalCategorized = 0;
      while (hasMore) {
        const { data, error } = await supabase.functions.invoke('learn-from-inbox', {
          body: { workspace_id: workspaceId, phase: 'categorize' }
        });
        
        if (error) throw error;
        
        totalCategorized += data?.categorized || 0;
        hasMore = data?.hasMore || false;
        
        const progress = Math.min(100, Math.round((totalCategorized / Math.max(totalEmails, 1)) * 100));
        updatePhase('categorize', { progress });
        
        // Safety: max 50 iterations
        if (totalCategorized > 5000) break;
      }
      
      updatePhase('categorize', { 
        status: 'complete', 
        progress: 100,
        result: `${totalCategorized.toLocaleString()} emails categorized`
      });

      // Phase 3: Voice profile
      updatePhase('voice_profile', { status: 'running', progress: 50 });
      setCurrentPhaseIndex(1);
      
      const { data: voiceData, error: voiceError } = await supabase.functions.invoke('learn-from-inbox', {
        body: { workspace_id: workspaceId, phase: 'voice_profile' }
      });
      
      if (voiceError) {
        console.error('Voice profile error:', voiceError);
        updatePhase('voice_profile', { status: 'error', result: 'Could not analyze writing style' });
      } else {
        const emailsAnalyzed = voiceData?.result?.emails_analyzed || 0;
        updatePhase('voice_profile', { 
          status: 'complete', 
          progress: 100,
          result: `Analyzed ${emailsAnalyzed} outbound messages`
        });
      }

      // Phase 4: Patterns
      updatePhase('patterns', { status: 'running', progress: 50 });
      setCurrentPhaseIndex(2);
      
      const { data: patternsData, error: patternsError } = await supabase.functions.invoke('learn-from-inbox', {
        body: { workspace_id: workspaceId, phase: 'patterns' }
      });
      
      if (patternsError) {
        console.error('Patterns error:', patternsError);
        updatePhase('patterns', { status: 'error' });
      } else {
        updatePhase('patterns', { 
          status: 'complete', 
          progress: 100,
          result: `Found ${patternsData?.insights?.categories?.length || 0} inquiry types`
        });
      }

      // Phase 5: Response extraction
      updatePhase('responses', { status: 'running', progress: 50 });
      setCurrentPhaseIndex(3);
      
      const { data: responsesData, error: responsesError } = await supabase.functions.invoke('learn-from-inbox', {
        body: { workspace_id: workspaceId, phase: 'responses' }
      });
      
      if (responsesError) {
        console.error('Responses error:', responsesError);
        updatePhase('responses', { status: 'error' });
      } else {
        updatePhase('responses', { 
          status: 'complete', 
          progress: 100,
          result: `Learned ${responsesData?.patternsLearned || 0} successful patterns`
        });
      }

      // Get final summary
      const { data: summaryData } = await supabase.functions.invoke('learn-from-inbox', {
        body: { workspace_id: workspaceId, phase: 'summary' }
      });
      
      setSummary(summaryData?.summary || null);
      setStatus('complete');
      toast.success('Learning complete!');

    } catch (error) {
      console.error('Learning error:', error);
      toast.error('Failed to complete learning');
      setStatus('idle');
    }
  };

  const overallProgress = phases.reduce((acc, phase) => {
    if (phase.status === 'complete') return acc + 25;
    if (phase.status === 'running') return acc + (phase.progress || 0) * 0.25;
    return acc;
  }, 0);

  const getToneLabel = (descriptors: string[]) => {
    if (!descriptors || descriptors.length === 0) return 'Professional';
    return descriptors.slice(0, 3).map(d => 
      d.charAt(0).toUpperCase() + d.slice(1)
    ).join(' • ');
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">Learn from Your Emails</h2>
        <p className="text-sm text-muted-foreground">
          BizzyBee will study your inbox to understand your business
        </p>
      </div>

      {status === 'idle' && (
        <Card className="p-8 text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Brain className="h-8 w-8 text-primary" />
          </div>
          <h3 className="font-semibold mb-2">Ready to learn</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            BizzyBee will analyze your entire inbox to understand your communication style, 
            common inquiries, and successful response patterns.
          </p>
          <Button onClick={runLearning} size="lg">
            <Brain className="h-4 w-4 mr-2" />
            Start Learning
          </Button>
        </Card>
      )}

      {status === 'running' && (
        <Card className="p-6">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="font-medium">Learning from your emails...</span>
            </div>
            
            <Progress value={overallProgress} className="h-2" />
            
            <div className="space-y-3">
              {phases.map((phase, index) => (
                <div 
                  key={phase.id}
                  className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                    phase.status === 'running' ? 'bg-primary/5 border border-primary/20' :
                    phase.status === 'complete' ? 'bg-green-50 dark:bg-green-900/10' :
                    'bg-muted/30'
                  }`}
                >
                  <div className={`flex-shrink-0 ${
                    phase.status === 'complete' ? 'text-green-600' :
                    phase.status === 'running' ? 'text-primary' :
                    'text-muted-foreground'
                  }`}>
                    {phase.status === 'running' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : phase.status === 'complete' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      phase.icon
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${
                      phase.status === 'pending' ? 'text-muted-foreground' : ''
                    }`}>
                      {phase.label}
                    </p>
                    {phase.result && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {phase.result}
                      </p>
                    )}
                  </div>
                  {phase.status === 'running' && phase.progress !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      {Math.round(phase.progress)}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {status === 'complete' && summary && (
        <Card className="p-8">
          <div className="text-center space-y-6">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold text-lg">Learning Complete!</h3>
              <p className="text-sm text-muted-foreground">
                BizzyBee now understands your communication style
              </p>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-muted/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-foreground">
                  {summary.totalEmailsAnalyzed.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">Emails analyzed</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-foreground">
                  {summary.outboundAnalyzed.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">Responses studied</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-green-600">
                  {summary.patternsLearned}
                </div>
                <p className="text-xs text-muted-foreground">Patterns learned</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-amber-600">
                  {summary.topCategories?.length || 0}
                </div>
                <p className="text-xs text-muted-foreground">Inquiry types</p>
              </div>
            </div>

            {/* Voice profile */}
            <div className="bg-primary/5 rounded-lg p-4 text-left">
              <p className="text-xs text-muted-foreground mb-1">Your communication style</p>
              <p className="font-medium text-primary">
                {getToneLabel(summary.toneDescriptors)}
              </p>
              {summary.topCategories && summary.topCategories.length > 0 && (
                <div className="mt-3 pt-3 border-t border-primary/10">
                  <p className="text-xs text-muted-foreground mb-2">Most common inquiries</p>
                  <div className="flex flex-wrap gap-2">
                    {summary.topCategories.slice(0, 4).map((cat, i) => (
                      <span 
                        key={i}
                        className="text-xs bg-background px-2 py-1 rounded-full"
                      >
                        {cat.category} ({cat.count})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Button 
              onClick={() => onComplete({ 
                emailsAnalyzed: summary.totalEmailsAnalyzed,
                patternsLearned: summary.patternsLearned,
                voiceProfileBuilt: summary.outboundAnalyzed > 0
              })} 
              size="lg" 
              className="w-full"
            >
              Continue
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </Card>
      )}

      {status === 'idle' && (
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button 
            variant="ghost" 
            onClick={() => onComplete({ emailsAnalyzed: 0, patternsLearned: 0, voiceProfileBuilt: false })} 
            className="ml-auto"
          >
            Skip this step
          </Button>
        </div>
      )}
    </div>
  );
}
