import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ClassificationBreakdown } from './ClassificationBreakdown';
import { VoiceDNASummary } from './VoiceDNASummary';
import { ResponsePlaybook } from './ResponsePlaybook';
import { ConfidenceAssessment } from './ConfidenceAssessment';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Brain } from 'lucide-react';

interface AILearningReportProps {
  workspaceId: string;
  onNext: () => void;
  onBack: () => void;
}

export function AILearningReport({ workspaceId, onNext, onBack }: AILearningReportProps) {
  const [isReady, setIsReady] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkStatus() {
      try {
        // Check if voice profile exists
        const { data: profile } = await supabase
          .from('voice_profiles')
          .select('voice_dna, playbook, emails_analyzed')
          .eq('workspace_id', workspaceId)
          .single();

        // Check if we have classified emails
        const { count: emailCount } = await supabase
          .from('email_import_queue')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .not('category', 'is', null);

        setIsReady(!!profile?.voice_dna && (emailCount || 0) > 0);
      } catch (err) {
        console.error('Error checking learning status:', err);
        setIsReady(false);
      } finally {
        setChecking(false);
      }
    }

    checkStatus();
  }, [workspaceId]);

  if (checking) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading your learning report...</p>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-4 py-8">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto">
            <Brain className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Learning In Progress</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              BizzyBee is still analyzing your emails. This usually takes a few minutes 
              after connecting your inbox.
            </p>
          </div>
        </div>

        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button onClick={onNext} variant="outline">
            Skip for now
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
          <Brain className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">What BizzyBee Learned About You</h2>
        <p className="text-sm text-muted-foreground">
          Review what we learned from your emails before going live
        </p>
      </div>

      {/* Report sections */}
      <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
        <ClassificationBreakdown workspaceId={workspaceId} />
        <VoiceDNASummary workspaceId={workspaceId} />
        <ResponsePlaybook workspaceId={workspaceId} />
        <ConfidenceAssessment workspaceId={workspaceId} />
      </div>

      {/* Success message */}
      <div className="flex items-center justify-center gap-2 py-2 text-sm text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-4 w-4" />
        <span>Your digital clone is ready!</span>
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onNext}>
          Looks Good
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
