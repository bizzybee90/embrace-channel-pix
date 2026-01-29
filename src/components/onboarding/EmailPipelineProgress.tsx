import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { 
  CheckCircle2, 
  Loader2, 
  Circle, 
  AlertCircle, 
  ArrowRight,
  RotateCcw,
  Mail,
  Brain,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LearningProgressDisplay } from '@/components/email/LearningProgressDisplay';

interface EmailPipelineProgressProps {
  workspaceId: string;
  connectedEmail: string;
  onNext: () => void;
  onBack: () => void;
  onRetry: () => void;
}

type PipelinePhase = 'idle' | 'connecting' | 'importing' | 'classifying' | 'learning' | 'complete' | 'error';

interface PipelineStats {
  phase: PipelinePhase;
  emailsReceived: number;
  emailsClassified: number;
  estimatedTotal: number;
  inboxCount: number;
  sentCount: number;
  voiceProfileComplete: boolean;
  errorMessage: string | null;
}

type StageStatus = 'pending' | 'in_progress' | 'done' | 'error';

function StageCard({
  stage,
  title,
  description,
  status,
  icon: Icon,
  children,
}: {
  stage: number;
  title: string;
  description: string;
  status: StageStatus;
  icon: React.ElementType;
  children?: React.ReactNode;
}) {
  const statusConfig = {
    pending: {
      badge: 'Pending',
      badgeClass: 'bg-muted text-muted-foreground',
      iconClass: 'text-muted-foreground',
      StatusIcon: Circle,
    },
    in_progress: {
      badge: 'In Progress',
      badgeClass: 'bg-primary/10 text-primary',
      iconClass: 'text-primary',
      StatusIcon: Loader2,
    },
    done: {
      badge: 'Done',
      badgeClass: 'bg-success/10 text-success',
      iconClass: 'text-success',
      StatusIcon: CheckCircle2,
    },
    error: {
      badge: 'Error',
      badgeClass: 'bg-destructive/10 text-destructive',
      iconClass: 'text-destructive',
      StatusIcon: AlertCircle,
    },
  };

  const config = statusConfig[status];

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-all duration-300',
        status === 'in_progress' && 'border-primary/50 bg-primary/5 shadow-sm',
        status === 'done' && 'border-success/30 bg-success/5',
        status === 'error' && 'border-destructive/30 bg-destructive/5',
        status === 'pending' && 'border-border bg-muted/30 opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={cn('mt-0.5 shrink-0', config.iconClass)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground">STAGE {stage}</span>
              <h3 className="font-semibold text-foreground">{title}</h3>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', config.badgeClass)}>
            {config.badge}
          </span>
          <config.StatusIcon
            className={cn(
              'h-4 w-4',
              config.iconClass,
              status === 'in_progress' && 'animate-spin'
            )}
          />
        </div>
      </div>

      {children && <div className="mt-4 pl-8">{children}</div>}
    </div>
  );
}

function ProgressLine({ currentStage }: { currentStage: number }) {
  const stages = ['Import', 'Classify', 'Learn', 'Ready!'];

  return (
    <div className="flex items-center justify-center gap-1 py-4">
      {stages.map((label, index) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                'w-3 h-3 rounded-full transition-all duration-300',
                index < currentStage
                  ? 'bg-success'
                  : index === currentStage
                  ? 'bg-primary ring-2 ring-primary/30'
                  : 'bg-muted'
              )}
            />
            <span
              className={cn(
                'text-xs mt-1 font-medium',
                index <= currentStage ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
          </div>
          {index < stages.length - 1 && (
            <div
              className={cn(
                'w-12 h-0.5 mx-1 mt-[-12px] transition-all duration-300',
                index < currentStage ? 'bg-success' : 'bg-muted'
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function EmailPipelineProgress({
  workspaceId,
  connectedEmail,
  onNext,
  onBack,
  onRetry,
}: EmailPipelineProgressProps) {
  const [stats, setStats] = useState<PipelineStats>({
    phase: 'importing',
    emailsReceived: 0,
    emailsClassified: 0,
    estimatedTotal: 0,
    inboxCount: 0,
    sentCount: 0,
    voiceProfileComplete: false,
    errorMessage: null,
  });

  // Fetch initial stats and subscribe to updates
  useEffect(() => {
    if (!workspaceId) return;

    const fetchStats = async () => {
      // Fetch progress record and use COUNT queries to avoid 1000-row limit
      const [progressResult, inboxResult, sentResult, classifiedResult] = await Promise.all([
        supabase
          .from('email_import_progress')
          .select('*')
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
        supabase
          .from('email_import_queue')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('direction', 'inbound'),
        supabase
          .from('email_import_queue')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('direction', 'outbound'),
        supabase
          .from('email_import_queue')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .not('category', 'is', null),
      ]);

      const progress = progressResult.data;
      const inboxCount = inboxResult.count || 0;
      const sentCount = sentResult.count || 0;
      const classifiedCount = classifiedResult.count || 0;
      const totalCount = inboxCount + sentCount;

      setStats({
        phase: (progress?.current_phase as PipelinePhase) || 'importing',
        emailsReceived: progress?.emails_received || totalCount,
        emailsClassified: progress?.emails_classified || classifiedCount,
        estimatedTotal: progress?.estimated_total_emails || totalCount,
        inboxCount,
        sentCount,
        voiceProfileComplete: progress?.voice_profile_complete || false,
        errorMessage: progress?.last_error || null,
      });
    };

    fetchStats();

    // Poll every 3 seconds for updates
    const interval = setInterval(fetchStats, 3000);

    // Also subscribe to realtime updates on email_import_progress
    const channel = supabase
      .channel(`pipeline-progress-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'email_import_progress',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          fetchStats();
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  // Derive stage statuses from ACTUAL DATA, not just the phase field
  // (The phase field can get stuck due to edge function issues)
  const getStageStatuses = (): { import: StageStatus; classify: StageStatus; learn: StageStatus } => {
    const { phase, emailsReceived, emailsClassified, voiceProfileComplete } = stats;
    const totalEmails = stats.inboxCount + stats.sentCount;

    // If error phase, determine which stage errored
    if (phase === 'error') {
      if (emailsClassified === 0 && emailsReceived === 0) {
        return { import: 'error', classify: 'pending', learn: 'pending' };
      }
      if (emailsClassified < emailsReceived) {
        return { import: 'done', classify: 'error', learn: 'pending' };
      }
      return { import: 'done', classify: 'done', learn: 'error' };
    }

    // SMART DETECTION: Derive actual state from data, not just phase
    const importComplete = totalEmails > 0 && emailsReceived > 0;
    const classifyComplete = emailsClassified >= emailsReceived && emailsReceived > 0;

    // All stages complete
    if (classifyComplete && voiceProfileComplete) {
      return { import: 'done', classify: 'done', learn: 'done' };
    }

    // Classification complete, learning in progress or complete
    if (classifyComplete && !voiceProfileComplete) {
      return { import: 'done', classify: 'done', learn: 'in_progress' };
    }

    // Import complete, classification in progress
    if (importComplete && emailsClassified > 0 && !classifyComplete) {
      return { import: 'done', classify: 'in_progress', learn: 'pending' };
    }

    // Import complete, classification hasn't started
    if (importComplete && emailsClassified === 0) {
      // Check phase to see if classification should start
      if (phase === 'classifying') {
        return { import: 'done', classify: 'in_progress', learn: 'pending' };
      }
      return { import: 'done', classify: 'pending', learn: 'pending' };
    }

    // Still importing
    return { import: 'in_progress', classify: 'pending', learn: 'pending' };
  };

  const stageStatuses = getStageStatuses();

  // Calculate current stage for progress line (0-3)
  const getCurrentStage = (): number => {
    if (stageStatuses.learn === 'done') return 3;
    if (stageStatuses.learn === 'in_progress') return 2;
    if (stageStatuses.classify === 'in_progress') return 1;
    return 0;
  };

  // Calculate classification progress
  const classifyPercent =
    stats.emailsReceived > 0
      ? Math.round((stats.emailsClassified / stats.emailsReceived) * 100)
      : 0;

  // Estimate time remaining for classification
  const estimateClassifyTime = (): string => {
    const remaining = stats.emailsReceived - stats.emailsClassified;
    if (remaining <= 0) return 'Almost done...';
    // Roughly 200 emails per minute with batch processing
    const minutes = Math.ceil(remaining / 200);
    if (minutes <= 1) return 'Less than a minute';
    if (minutes < 60) return `~${minutes} min remaining`;
    return `~${Math.ceil(minutes / 60)} hour${Math.ceil(minutes / 60) > 1 ? 's' : ''} remaining`;
  };

  const totalEmails = stats.inboxCount + stats.sentCount;
  const isError = stats.phase === 'error';
  const isComplete = stats.phase === 'complete';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">🐝 Setting Up Your AI Assistant</h2>
        <p className="text-sm text-muted-foreground">
          We're teaching BizzyBee how you communicate so it can respond just like you would.
          <br />
          <span className="font-medium text-foreground">{connectedEmail}</span>
        </p>
      </div>

      {/* Stage Cards */}
      <div className="space-y-3">
        {/* Stage 1: Import */}
        <StageCard
          stage={1}
          title="Import Emails"
          description={
            stageStatuses.import === 'done'
              ? 'Downloaded your email history'
              : 'Downloading your email history'
          }
          status={stageStatuses.import}
          icon={Mail}
        >
          {stageStatuses.import === 'done' && totalEmails > 0 && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-2">
                  <span className="text-xs">├─</span> Inbox
                </span>
                <span className="font-medium flex items-center gap-1">
                  {stats.inboxCount.toLocaleString()} emails
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-2">
                  <span className="text-xs">└─</span> Sent
                </span>
                <span className="font-medium flex items-center gap-1">
                  {stats.sentCount.toLocaleString()} emails
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                </span>
              </div>
              <div className="pt-1 border-t mt-2">
                <span className="font-semibold">Total: {totalEmails.toLocaleString()} emails imported</span>
              </div>
            </div>
          )}
          {stageStatuses.import === 'in_progress' && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span>Scanning mailbox... {stats.emailsReceived > 0 && `${stats.emailsReceived.toLocaleString()} found`}</span>
              </div>
            </div>
          )}
        </StageCard>

        {/* Stage 2: Classify */}
        <StageCard
          stage={2}
          title="Classify Emails"
          description={
            stageStatuses.classify === 'done'
              ? 'AI sorted emails into categories'
              : stageStatuses.classify === 'in_progress'
              ? 'AI is sorting emails into categories'
              : 'AI will sort emails into categories'
          }
          status={stageStatuses.classify}
          icon={Sparkles}
        >
          {stageStatuses.classify === 'pending' && (
            <p className="text-sm text-muted-foreground">
              (quotes, bookings, complaints, etc.)
              <br />
              Waiting for import to complete...
            </p>
          )}
          {stageStatuses.classify === 'in_progress' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Progress value={classifyPercent} className="h-2" />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    {stats.emailsClassified.toLocaleString()} / {stats.emailsReceived.toLocaleString()}
                  </span>
                  <span className="font-medium">{classifyPercent}%</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span>Processing in batches... {estimateClassifyTime()}</span>
              </div>
            </div>
          )}
          {stageStatuses.classify === 'done' && (
            <p className="text-sm text-success">
              ✓ {stats.emailsClassified.toLocaleString()} emails categorised
            </p>
          )}
        </StageCard>

        {/* Stage 3: Learn Voice */}
        <StageCard
          stage={3}
          title="Learn Your Voice"
          description={
            stageStatuses.learn === 'done'
              ? 'Analysed your sent emails'
              : stageStatuses.learn === 'in_progress'
              ? 'Analysing your sent emails'
              : 'Analyse your sent emails to learn how you respond'
          }
          status={stageStatuses.learn}
          icon={Brain}
        >
          {stageStatuses.learn === 'pending' && (
            <p className="text-sm text-muted-foreground">Coming next... (takes ~2-3 minutes)</p>
          )}
          {stageStatuses.learn === 'in_progress' && (
            <LearningProgressDisplay
              workspaceId={workspaceId}
              emailsImported={stats.sentCount}
            />
          )}
          {stageStatuses.learn === 'done' && (
            <p className="text-sm text-success">✓ Voice profile created</p>
          )}
        </StageCard>
      </div>

      {/* Progress Line */}
      <ProgressLine currentStage={getCurrentStage()} />

      {/* Error State */}
      {isError && stats.errorMessage && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Something went wrong</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.errorMessage}</p>
            </div>
          </div>
          <Button onClick={onRetry} size="sm" variant="outline" className="mt-3 w-full gap-2">
            <RotateCcw className="h-4 w-4" />
            Retry
          </Button>
        </div>
      )}

      {/* Completion Message */}
      {isComplete && (
        <div className="p-3 bg-success/10 border border-success/30 rounded-lg text-center">
          <CheckCircle2 className="h-6 w-6 text-success mx-auto mb-2" />
          <p className="text-sm font-medium text-success">Setup Complete!</p>
          <p className="text-xs text-muted-foreground mt-1">
            BizzyBee is ready to help you with emails.
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-3">
        <Button onClick={onNext} className="w-full gap-2">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
        {!isComplete && (
          <p className="text-xs text-center text-muted-foreground">
            You can continue while this runs in the background
          </p>
        )}
        <Button variant="ghost" size="sm" onClick={onBack} className="w-full text-muted-foreground">
          Back
        </Button>
      </div>
    </div>
  );
}
