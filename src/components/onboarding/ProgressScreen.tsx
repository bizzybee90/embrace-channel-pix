import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { 
  CheckCircle2, 
  Loader2, 
  Search, 
  FileCheck, 
  Sparkles,
  Mail,
  AlertCircle,
  ChevronRight
} from 'lucide-react';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ProgressScreenProps {
  workspaceId: string;
  onNext: () => void;
  onBack: () => void;
}

interface WorkflowProgress {
  status: string;
  details: Record<string, unknown>;
}

interface ProgressState {
  competitor: WorkflowProgress;
  email: WorkflowProgress;
}

const COMPETITOR_PHASES = [
  { key: 'pending', label: 'Waiting to start', icon: Loader2 },
  { key: 'discovering', label: 'Searching Google...', icon: Search },
  { key: 'search_complete', label: 'Verifying results...', icon: FileCheck },
  { key: 'verification_complete', label: 'Checking domains...', icon: FileCheck },
  { key: 'health_check_complete', label: 'Scraping websites...', icon: FileCheck },
  { key: 'scraping_complete', label: 'Generating FAQs...', icon: Sparkles },
  { key: 'complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'failed', label: 'Failed', icon: AlertCircle },
];

const EMAIL_PHASES = [
  { key: 'pending', label: 'Waiting to start', icon: Loader2 },
  { key: 'importing_emails', label: 'Importing emails...', icon: Mail },
  { key: 'emails_fetched', label: 'Classifying emails...', icon: FileCheck },
  { key: 'classification_complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'failed', label: 'Failed', icon: AlertCircle },
];

function getPhaseIndex(phases: typeof COMPETITOR_PHASES, currentStatus: string): number {
  const index = phases.findIndex(p => p.key === currentStatus);
  return index >= 0 ? index : 0;
}

function TrackProgress({ 
  title, 
  phases, 
  currentStatus, 
  counts,
  error
}: { 
  title: string;
  phases: typeof COMPETITOR_PHASES;
  currentStatus: string;
  counts?: { label: string; value: number }[];
  error?: string | null;
}) {
  const currentIndex = getPhaseIndex(phases, currentStatus);
  const isComplete = currentStatus === 'complete' || currentStatus === 'classification_complete';
  const isFailed = currentStatus === 'failed';
  const totalPhases = phases.length - 1; // Exclude 'failed' from progress
  const progressPercent = isComplete ? 100 : (currentIndex / (totalPhases - 1)) * 100;

  const CurrentIcon = phases[currentIndex]?.icon || Loader2;
  const currentLabel = phases[currentIndex]?.label || 'Processing...';

  return (
    <div className={cn(
      "p-4 rounded-lg border",
      isComplete && "border-success/30 bg-success/5",
      isFailed && "border-destructive/30 bg-destructive/5",
      !isComplete && !isFailed && "border-border bg-muted/30"
    )}>
      <div className="flex items-center gap-3 mb-3">
        <div className={cn(
          "h-10 w-10 rounded-full flex items-center justify-center",
          isComplete && "bg-success/10 text-success",
          isFailed && "bg-destructive/10 text-destructive",
          !isComplete && !isFailed && "bg-primary/10 text-primary"
        )}>
          {isComplete ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : isFailed ? (
            <AlertCircle className="h-5 w-5" />
          ) : (
            <CurrentIcon className={cn(
              "h-5 w-5",
              currentStatus !== 'pending' && "animate-spin"
            )} />
          )}
        </div>
        <div className="flex-1">
          <h3 className="font-medium">{title}</h3>
          <p className={cn(
            "text-sm",
            isComplete && "text-success",
            isFailed && "text-destructive",
            !isComplete && !isFailed && "text-muted-foreground"
          )}>
            {isFailed ? (error || 'An error occurred') : currentLabel}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <Progress 
        value={progressPercent} 
        className={cn(
          "h-2 mb-2",
          isComplete && "[&>div]:bg-success",
          isFailed && "[&>div]:bg-destructive"
        )} 
      />

      {/* Counts */}
      {counts && counts.length > 0 && (
        <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
          {counts.map((count, i) => (
            <span key={i}>
              <span className="font-medium text-foreground">{count.value}</span> {count.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProgressScreen({ workspaceId, onNext, onBack }: ProgressScreenProps) {
  const [progress, setProgress] = useState<ProgressState>({
    competitor: { status: 'pending', details: {} },
    email: { status: 'pending', details: {} },
  });
  const [isLoading, setIsLoading] = useState(true);
  const [elapsedTime, setElapsedTime] = useState(0);
  const startTimeRef = useRef<number>(Date.now());
  const pollIntervalRef = useRef<number | undefined>(undefined);

  // Poll for progress updates from n8n_workflow_progress table
  useEffect(() => {
    const pollProgress = async () => {
      try {
        // Use raw query to avoid TypeScript issues with new table
        const { data, error } = await supabase
          .from('n8n_workflow_progress' as 'allowed_webhook_ips') // Type workaround
          .select('*')
          .eq('workspace_id', workspaceId);

        if (error) {
          console.error('Error fetching progress:', error);
          return;
        }

        // Parse the results
        const records = (data || []) as unknown as Array<{
          workflow_type: string;
          status: string;
          details: Record<string, unknown>;
        }>;

        const competitorRecord = records.find(r => r.workflow_type === 'competitor_discovery');
        const emailRecord = records.find(r => r.workflow_type === 'email_import');

        setProgress({
          competitor: {
            status: competitorRecord?.status || 'pending',
            details: (competitorRecord?.details || {}) as Record<string, unknown>,
          },
          email: {
            status: emailRecord?.status || 'pending',
            details: (emailRecord?.details || {}) as Record<string, unknown>,
          },
        });
      } catch (error) {
        console.error('Error polling progress:', error);
      } finally {
        setIsLoading(false);
      }
    };

    // Initial poll
    pollProgress();

    // Poll every 3 seconds
    pollIntervalRef.current = window.setInterval(pollProgress, 3000);

    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
  }, [workspaceId]);

  // Track elapsed time
  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const competitorStatus = progress.competitor.status;
  const emailStatus = progress.email.status;
  
  const isCompetitorComplete = competitorStatus === 'complete';
  const isEmailComplete = emailStatus === 'complete' || emailStatus === 'classification_complete';
  const bothComplete = isCompetitorComplete && isEmailComplete;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Extract counts from details
  const competitorDetails = progress.competitor.details;
  const emailDetails = progress.email.details;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl">Setting Up Your AI Agent</CardTitle>
          <CardDescription className="mt-2">
            Loading progress...
          </CardDescription>
        </div>
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <CardTitle className="text-xl">Setting Up Your AI Agent</CardTitle>
        <CardDescription className="mt-2">
          We're training your AI on competitor research and your email patterns.
        </CardDescription>
      </div>

      {/* Elapsed time */}
      <div className="text-center text-sm text-muted-foreground">
        Elapsed: {formatTime(elapsedTime)}
      </div>

      {/* Track 1: Competitor Research */}
      <TrackProgress
        title="Competitor Research"
        phases={COMPETITOR_PHASES}
        currentStatus={competitorStatus}
        counts={[
          { label: 'competitors found', value: (competitorDetails.competitors_found as number) || 0 },
          { label: 'scraped', value: (competitorDetails.competitors_scraped as number) || 0 },
          { label: 'FAQs generated', value: (competitorDetails.faqs_generated as number) || 0 },
        ]}
        error={competitorDetails.error as string | undefined}
      />

      {/* Track 2: Email Import */}
      <TrackProgress
        title="Email Analysis"
        phases={EMAIL_PHASES}
        currentStatus={emailStatus}
        counts={[
          { label: 'emails imported', value: (emailDetails.emails_imported as number) || 0 },
          { label: 'classified', value: (emailDetails.emails_classified as number) || 0 },
        ]}
        error={emailDetails.error as string | undefined}
      />

      {/* Info message */}
      {!bothComplete && (
        <div className="text-center text-sm text-muted-foreground p-4 bg-muted/30 rounded-lg">
          <p>This typically takes 5-20 minutes depending on the research scope.</p>
          <p className="mt-1">You can leave this page and come back — progress will continue.</p>
        </div>
      )}

      {/* Continue button */}
      <div className="flex justify-center pt-4">
        <Button 
          onClick={onNext} 
          disabled={!bothComplete}
          size="lg"
          className="gap-2"
        >
          {bothComplete ? (
            <>
              Continue
              <ChevronRight className="h-4 w-4" />
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing...
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
