import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { 
  ChevronLeft, 
  Loader2, 
  Brain, 
  CheckCircle2,
  Sparkles
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

interface LearningResult {
  emailsAnalyzed: number;
  totalConversations: number;
  totalOutbound: number;
  profile: {
    tone: string;
    tone_description: string;
    formality_level: number;
  } | null;
  topCategories: { category: string; count: number }[];
}

export function InboxLearningStep({ workspaceId, onComplete, onBack }: InboxLearningStepProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'complete' | 'error'>('idle');
  const [result, setResult] = useState<LearningResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runLearning = async () => {
    setStatus('running');
    setError(null);

    try {
      console.log('[InboxLearning] Starting simplified learning...');
      
      const { data, error: fnError } = await supabase.functions.invoke('learn-from-inbox', {
        body: { workspace_id: workspaceId }
      });

      if (fnError) {
        console.error('[InboxLearning] Function error:', fnError);
        throw fnError;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      console.log('[InboxLearning] Result:', data);
      
      setResult({
        emailsAnalyzed: data.emailsAnalyzed || 0,
        totalConversations: data.totalConversations || 0,
        totalOutbound: data.totalOutbound || 0,
        profile: data.profile,
        topCategories: data.topCategories || [],
      });
      
      setStatus('complete');
      toast.success('Learning complete!');

    } catch (err) {
      console.error('[InboxLearning] Error:', err);
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
      toast.error('Learning failed - you can try again or continue');
    }
  };

  const handleContinue = () => {
    onComplete({
      emailsAnalyzed: result?.emailsAnalyzed || 0,
      patternsLearned: result?.topCategories?.length || 0,
      voiceProfileBuilt: !!result?.profile,
    });
  };

  const getToneLabel = (tone: string) => {
    const labels: Record<string, string> = {
      friendly: '😊 Friendly & Approachable',
      professional: '💼 Professional & Polished',
      casual: '👋 Casual & Relaxed',
      formal: '📋 Formal & Business-like',
    };
    return labels[tone] || tone;
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">Learn from Your Emails</h2>
        <p className="text-sm text-muted-foreground">
          BizzyBee will study your inbox to understand how you communicate
        </p>
      </div>

      {status === 'idle' && (
        <Card className="p-8 text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Brain className="h-8 w-8 text-primary" />
          </div>
          <h3 className="font-semibold mb-2">Ready to learn your style</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            We'll analyze a sample of your emails to understand your tone, 
            common phrases, and how you handle different situations.
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            This usually takes about 15 seconds
          </p>
          <Button onClick={runLearning} size="lg">
            <Sparkles className="h-4 w-4 mr-2" />
            Start Learning
          </Button>
        </Card>
      )}

      {status === 'running' && (
        <Card className="p-8 text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <h3 className="font-semibold mb-2">Learning from your emails...</h3>
          <p className="text-sm text-muted-foreground">
            Analyzing your communication style with AI
          </p>
          <p className="text-xs text-muted-foreground mt-4">
            This should only take about 15 seconds
          </p>
        </Card>
      )}

      {status === 'error' && (
        <Card className="p-8 text-center">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Brain className="h-8 w-8 text-destructive" />
          </div>
          <h3 className="font-semibold mb-2">Something went wrong</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {error || 'Unable to analyze emails. You can try again or continue without this step.'}
          </p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={runLearning}>
              Try Again
            </Button>
            <Button onClick={() => onComplete({ emailsAnalyzed: 0, patternsLearned: 0, voiceProfileBuilt: false })}>
              Continue Anyway
            </Button>
          </div>
        </Card>
      )}

      {status === 'complete' && result && (
        <div className="space-y-4">
          <Card className="p-6">
            <div className="text-center space-y-4">
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
              <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto">
                <div className="bg-muted/30 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-foreground">
                    {result.emailsAnalyzed}
                  </div>
                  <p className="text-xs text-muted-foreground">Emails analyzed</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-green-600">
                    {result.topCategories.length}
                  </div>
                  <p className="text-xs text-muted-foreground">Patterns found</p>
                </div>
              </div>

              {/* Voice profile */}
              {result.profile && (
                <div className="bg-primary/5 rounded-lg p-4 text-left max-w-md mx-auto">
                  <p className="text-xs text-muted-foreground mb-1">Your communication style</p>
                  <p className="font-medium text-primary mb-2">
                    {getToneLabel(result.profile.tone)}
                  </p>
                  {result.profile.tone_description && (
                    <p className="text-sm text-muted-foreground">
                      {result.profile.tone_description}
                    </p>
                  )}
                </div>
              )}

              {/* Top categories */}
              {result.topCategories.length > 0 && (
                <div className="text-left max-w-md mx-auto">
                  <p className="text-xs text-muted-foreground mb-2">Common email types you handle</p>
                  <div className="flex flex-wrap gap-2">
                    {result.topCategories.slice(0, 5).map((cat, i) => (
                      <span 
                        key={i}
                        className="px-2 py-1 bg-muted/50 rounded text-xs capitalize"
                      >
                        {cat.category.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={onBack}>
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button onClick={handleContinue}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* Back button for idle and running states */}
      {(status === 'idle' || status === 'running') && (
        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          {status === 'running' && (
            <Button 
              variant="ghost" 
              onClick={() => onComplete({ emailsAnalyzed: 0, patternsLearned: 0, voiceProfileBuilt: false })}
            >
              Skip for now
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
