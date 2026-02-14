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
  AlertCircle,
  ChevronRight,
  FileSearch,
  Download
} from 'lucide-react';
import { generateCompetitorResearchPDF } from '@/components/settings/knowledge-base/generateCompetitorResearchPDF';
import { toast } from 'sonner';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ProgressScreenProps {
  workspaceId: string;
  onNext: () => void;
  onBack: () => void;
}

interface TrackState {
  status: string;
  counts: { label: string; value: number }[];
  error?: string | null;
  currentCompetitor?: string | null;
  current?: number;
  total?: number;
}

// Discovery phases (Workflow 1)
const DISCOVERY_PHASES = [
  { key: 'pending', label: 'Waiting to start', icon: Loader2 },
  { key: 'starting', label: 'Starting discovery...', icon: Search },
  { key: 'discovering', label: 'Searching for competitors...', icon: Search },
  { key: 'search_complete', label: 'Verifying results...', icon: FileCheck },
  { key: 'verification_complete', label: 'Checking domains...', icon: FileCheck },
  { key: 'health_check_complete', label: 'Finalising competitors...', icon: FileCheck },
  { key: 'complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'failed', label: 'Failed', icon: AlertCircle },
];

// FAQ scrape phases (Workflow 2)
const SCRAPE_PHASES = [
  { key: 'waiting', label: 'Waiting for discovery...', icon: Loader2 },
  { key: 'pending', label: 'Queued for scraping', icon: Loader2 },
  { key: 'scraping', label: 'Scraping competitor websites...', icon: Search },
  { key: 'extracting', label: 'Extracting FAQs...', icon: Sparkles },
  { key: 'scrape_processing', label: 'Processing FAQs...', icon: Sparkles },
  { key: 'complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'failed', label: 'Failed', icon: AlertCircle },
];

// Bug 6 Fix: Added 'dispatched' status
const EMAIL_PHASES = [
  { key: 'pending', label: 'Waiting for import...', icon: Loader2 },
  { key: 'dispatched', label: 'Starting classification...', icon: FileCheck },
  { key: 'classifying', label: 'Classifying emails...', icon: FileCheck },
  { key: 'classification_complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'failed', label: 'Failed', icon: AlertCircle },
];

function getPhaseIndex(phases: typeof DISCOVERY_PHASES, currentStatus: string): number {
  const index = phases.findIndex(p => p.key === currentStatus);
  return index >= 0 ? index : 0;
}

function TrackProgress({ 
  title, 
  phases, 
  currentStatus, 
  counts,
  error,
  currentCompetitor,
  current,
  total,
}: { 
  title: string;
  phases: typeof DISCOVERY_PHASES;
  currentStatus: string;
  counts?: { label: string; value: number }[];
  error?: string | null;
  currentCompetitor?: string | null;
  current?: number;
  total?: number;
}) {
  const currentIndex = getPhaseIndex(phases, currentStatus);
  const isComplete = currentStatus === 'complete' || currentStatus === 'classification_complete';
  const isFailed = currentStatus === 'failed';
  const isWaiting = currentStatus === 'waiting';
  const totalPhases = phases.length - 1; // exclude 'failed'
  
  let progressPercent: number;
  if (currentStatus === 'scraping' && current && total && total > 0) {
    const processingProgress = (current / total) * 60;
    progressPercent = 20 + processingProgress;
  } else {
    progressPercent = isComplete ? 100 : isWaiting ? 0 : (currentIndex / (totalPhases - 1)) * 100;
  }

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
          isWaiting && "bg-muted text-muted-foreground",
          !isComplete && !isFailed && !isWaiting && "bg-primary/10 text-primary"
        )}>
          {isComplete ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : isFailed ? (
            <AlertCircle className="h-5 w-5" />
          ) : (
            <CurrentIcon className={cn(
              "h-5 w-5",
              !isWaiting && currentStatus !== 'pending' && "animate-spin"
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
          {(currentStatus === 'scraping' || currentStatus === 'extracting') && currentCompetitor && current && total && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Competitor {current} of {total}: <span className="font-medium">{currentCompetitor}</span>
            </p>
          )}
        </div>
      </div>

      <Progress 
        value={progressPercent} 
        className={cn(
          "h-2 mb-2",
          isComplete && "[&>div]:bg-success",
          isFailed && "[&>div]:bg-destructive"
        )} 
      />

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
  const [discoveryTrack, setDiscoveryTrack] = useState<TrackState>({ status: 'pending', counts: [] });
  const [scrapeTrack, setScrapeTrack] = useState<TrackState>({ status: 'waiting', counts: [] });
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [emailTrack, setEmailTrack] = useState<TrackState>({ status: 'pending', counts: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [liveFaqCount, setLiveFaqCount] = useState(0);
  const startTimeRef = useRef<number>(Date.now());

  // Realtime subscription for live FAQ count
  useEffect(() => {
    // Initial count
    const fetchCount = async () => {
      const { count } = await supabase
        .from('faq_database')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('is_own_content', false);
      setLiveFaqCount(count || 0);
    };
    fetchCount();

    const channel = supabase
      .channel('faq-progress')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'faq_database',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          setLiveFaqCount(prev => prev + 1);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [workspaceId]);

  useEffect(() => {
    const pollProgress = async () => {
      try {
        // Bug 5 Fix: Poll n8n_workflow_progress for ALL tracks + email_import_progress for email counts
        const [workflowRes, emailProgressRes] = await Promise.all([
          supabase
            .from('n8n_workflow_progress' as 'allowed_webhook_ips')
            .select('*')
            .eq('workspace_id', workspaceId),
          supabase
            .from('email_import_progress' as 'allowed_webhook_ips')
            .select('*')
            .eq('workspace_id', workspaceId)
            .maybeSingle(),
        ]);

        const records = ((workflowRes.data || []) as unknown as Array<{
          workflow_type: string;
          status: string;
          details: Record<string, unknown>;
          updated_at: string;
        }>);

        // Stale detection: if a non-terminal track hasn't updated in 10 min, mark as failed
        const STALE_THRESHOLD_MS = 10 * 60 * 1000;
        const now = Date.now();
        const isStale = (record: typeof records[0] | undefined) => {
          if (!record?.updated_at) return false;
          const terminal = ['complete', 'failed', 'classification_complete'];
          if (terminal.includes(record.status)) return false;
          return now - new Date(record.updated_at).getTime() > STALE_THRESHOLD_MS;
        };

        // Bug 4 Fix: Track all three workflow types
        const discoveryRecord = records.find(r => r.workflow_type === 'competitor_discovery');
        const scrapeRecord = records.find(r => r.workflow_type === 'competitor_scrape');
        const emailRecord = records.find(r => r.workflow_type === 'email_import');

        // Discovery track (Workflow 1)
        const discoveryDetails = (discoveryRecord?.details || {}) as Record<string, unknown>;
        const discoveryStatus = isStale(discoveryRecord) ? 'failed' : (discoveryRecord?.status || 'pending');

        setDiscoveryTrack({
          status: discoveryStatus,
          counts: discoveryRecord ? [
            { label: 'competitors found', value: (discoveryDetails.competitors_found as number) || 0 },
          ] : [],
          error: isStale(discoveryRecord) ? 'Timed out — the workflow may have failed. Please retry.' : (discoveryDetails.error as string | undefined),
        });

        // Scrape track (Workflow 2) — stays 'waiting' until discovery completes
        const scrapeDetails = (scrapeRecord?.details || {}) as Record<string, unknown>;
        const scrapeStatus = scrapeRecord?.status || (discoveryStatus === 'complete' ? 'pending' : 'waiting');

        setScrapeTrack({
          status: scrapeStatus,
          counts: scrapeRecord ? [
            { label: 'scraped', value: (scrapeDetails.competitors_scraped as number) || 0 },
            { label: 'FAQs generated', value: liveFaqCount },
          ] : [],
          error: scrapeDetails.error as string | undefined,
          currentCompetitor: scrapeDetails.current_competitor as string | undefined,
          current: scrapeDetails.current as number | undefined,
          total: scrapeDetails.total as number | undefined,
        });

        // Email track — use email_import_progress table for accurate counts
        const emailStatus = emailRecord?.status || 'pending';
        const emailDetails = (emailRecord?.details || {}) as Record<string, unknown>;
        const emailProgress = emailProgressRes.data as unknown as Record<string, unknown> | null;

        if (emailProgress || emailRecord) {
          const totalEmails = (emailDetails.total_emails as number) || 
                             (emailProgress?.estimated_total_emails as number) || 0;
          const classifiedEmails = (emailDetails.emails_classified as number) || 
                                   (emailProgress?.emails_classified as number) || 0;

          let effectiveEmailStatus = emailStatus;
          // Auto-advance from pending if we can see classification is happening
          if (totalEmails > 0 && classifiedEmails < totalEmails && emailStatus === 'pending') {
            effectiveEmailStatus = 'classifying';
          }
          // 99% threshold to handle stragglers
          if (totalEmails > 0 && classifiedEmails >= totalEmails * 0.99) {
            effectiveEmailStatus = 'complete';
          }

          const percentage = totalEmails > 0 ? Math.round((classifiedEmails / totalEmails) * 100) : 0;

          setEmailTrack({
            status: effectiveEmailStatus,
            counts: totalEmails > 0 ? [
              { label: 'total emails', value: totalEmails },
              { label: `classified (${percentage}%)`, value: classifiedEmails },
            ] : [],
            error: emailDetails.error as string | undefined,
          });
        } else {
          setEmailTrack({ status: 'pending', counts: [] });
        }
      } catch (error) {
        console.error('Error polling progress:', error);
      } finally {
        setIsLoading(false);
      }
    };

    pollProgress();
    const interval = window.setInterval(pollProgress, 3000);
    return () => window.clearInterval(interval);
  }, [workspaceId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Bug 4 Fix: Require ALL three tracks to be complete
  const isDiscoveryComplete = discoveryTrack.status === 'complete';
  const isScrapeComplete = scrapeTrack.status === 'complete';
  const isEmailComplete = emailTrack.status === 'complete' || emailTrack.status === 'classification_complete';
  const allComplete = isDiscoveryComplete && isScrapeComplete && isEmailComplete;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl">Setting Up Your AI Agent</CardTitle>
          <CardDescription className="mt-2">Loading progress...</CardDescription>
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

      <div className="text-center text-sm text-muted-foreground">
        Elapsed: {formatTime(elapsedTime)}
      </div>

      {/* Competitor Research: 2-stage composite */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide px-1">
          Competitor Research
        </h2>
        <TrackProgress
          title="Finding Competitors"
          phases={DISCOVERY_PHASES}
          currentStatus={discoveryTrack.status}
          counts={discoveryTrack.counts}
          error={discoveryTrack.error}
        />
        <TrackProgress
          title="Analysing Competitors"
          phases={SCRAPE_PHASES}
          currentStatus={scrapeTrack.status}
          counts={scrapeTrack.counts}
          error={scrapeTrack.error}
          currentCompetitor={scrapeTrack.currentCompetitor}
          current={scrapeTrack.current}
          total={scrapeTrack.total}
        />
        {scrapeTrack.status === 'complete' && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setDownloadingPDF(true);
                try {
                  await generateCompetitorResearchPDF(workspaceId);
                  toast.success('Competitor Research PDF downloaded!');
                } catch (err) {
                  console.error('PDF error:', err);
                  toast.error('Failed to generate PDF');
                } finally {
                  setDownloadingPDF(false);
                }
              }}
              disabled={downloadingPDF}
              className="gap-2"
            >
              {downloadingPDF ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download Competitor Report
            </Button>
          </div>
        )}
      </div>

      {/* Email Classification */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide px-1">
          Email Classification
        </h2>
        <TrackProgress
          title="Email Classification"
          phases={EMAIL_PHASES}
          currentStatus={emailTrack.status}
          counts={emailTrack.counts}
          error={emailTrack.error}
        />
      </div>

      {!allComplete && (
        <div className="text-center text-sm text-muted-foreground p-4 bg-muted/30 rounded-lg">
          <p>This typically takes 5-20 minutes depending on the research scope.</p>
          <p className="mt-1">You can leave this page and come back — progress will continue.</p>
        </div>
      )}

      <div className="flex flex-col items-center gap-3 pt-4">
        <Button 
          onClick={onNext} 
          disabled={!allComplete}
          size="lg"
          className="gap-2"
        >
          {allComplete ? (
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
        {!allComplete && (
          <div className="flex gap-3">
            <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
              ← Back
            </Button>
            <Button variant="ghost" size="sm" onClick={onNext} className="text-muted-foreground">
              Skip for now →
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
