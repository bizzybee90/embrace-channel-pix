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
  Globe,
  FileText,
  Sparkles,
  Search,
  Filter,
  Wand2
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CompetitorPipelineProgressProps {
  workspaceId: string;
  jobId: string;
  nicheQuery: string;
  serviceArea: string;
  targetCount: number;
  onComplete: (results: { sitesScraped: number; faqsGenerated: number }) => void;
  onBack: () => void;
  onRetry: () => void;
}

type PipelinePhase = 'queued' | 'discovering' | 'validating' | 'scraping' | 'extracting' | 'deduplicating' | 'refining' | 'embedding' | 'completed' | 'error';

interface PipelineStats {
  phase: PipelinePhase;
  sitesDiscovered: number;
  sitesValidated: number;
  sitesScraped: number;
  pagesScraped: number;
  faqsExtracted: number;
  faqsAfterDedup: number;
  faqsRefined: number;
  faqsAdded: number;
  currentSite: string | null;
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
  const stages = ['Discover', 'Validate', 'Scrape', 'Extract', 'Refine', 'Done!'];

  return (
    <div className="flex items-center justify-center gap-0.5 py-4 overflow-x-auto">
      {stages.map((label, index) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                'w-2.5 h-2.5 rounded-full transition-all duration-300',
                index < currentStage
                  ? 'bg-success'
                  : index === currentStage
                  ? 'bg-primary ring-2 ring-primary/30'
                  : 'bg-muted'
              )}
            />
            <span
              className={cn(
                'text-[10px] mt-1 font-medium whitespace-nowrap',
                index <= currentStage ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
          </div>
          {index < stages.length - 1 && (
            <div
              className={cn(
                'w-6 h-0.5 mx-0.5 mt-[-12px] transition-all duration-300',
                index < currentStage ? 'bg-success' : 'bg-muted'
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function CompetitorPipelineProgress({
  workspaceId,
  jobId,
  nicheQuery,
  serviceArea,
  targetCount,
  onComplete,
  onBack,
  onRetry,
}: CompetitorPipelineProgressProps) {
  const [stats, setStats] = useState<PipelineStats>({
    phase: 'queued',
    sitesDiscovered: 0,
    sitesValidated: 0,
    sitesScraped: 0,
    pagesScraped: 0,
    faqsExtracted: 0,
    faqsAfterDedup: 0,
    faqsRefined: 0,
    faqsAdded: 0,
    currentSite: null,
    errorMessage: null,
  });

  // Poll for job progress
  useEffect(() => {
    if (!jobId) return;

    const fetchStats = async () => {
      const { data } = await supabase
        .from('competitor_research_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (data) {
        setStats({
          phase: data.status as PipelinePhase,
          sitesDiscovered: data.sites_discovered || 0,
          sitesValidated: data.sites_validated || data.sites_approved || 0,
          sitesScraped: data.sites_scraped || 0,
          pagesScraped: data.pages_scraped || 0,
          faqsExtracted: data.faqs_extracted || data.faqs_generated || 0,
          faqsAfterDedup: data.faqs_after_dedup || 0,
          faqsRefined: data.faqs_refined || 0,
          faqsAdded: data.faqs_added || data.faqs_refined || 0,
          currentSite: data.current_scraping_domain || null,
          errorMessage: data.error_message || null,
        });
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 3000);

    return () => clearInterval(interval);
  }, [jobId]);

  // Derive stage statuses from phase
  const getStageStatuses = (): { 
    discover: StageStatus; 
    validate: StageStatus; 
    scrape: StageStatus; 
    extract: StageStatus;
    refine: StageStatus;
  } => {
    const { phase } = stats;

    if (phase === 'error') {
      // Determine which stage errored
      if (stats.sitesDiscovered === 0) {
        return { discover: 'error', validate: 'pending', scrape: 'pending', extract: 'pending', refine: 'pending' };
      }
      if (stats.sitesValidated === 0) {
        return { discover: 'done', validate: 'error', scrape: 'pending', extract: 'pending', refine: 'pending' };
      }
      if (stats.sitesScraped === 0) {
        return { discover: 'done', validate: 'done', scrape: 'error', extract: 'pending', refine: 'pending' };
      }
      if (stats.faqsExtracted === 0) {
        return { discover: 'done', validate: 'done', scrape: 'done', extract: 'error', refine: 'pending' };
      }
      return { discover: 'done', validate: 'done', scrape: 'done', extract: 'done', refine: 'error' };
    }

    switch (phase) {
      case 'queued':
      case 'discovering':
        return { discover: 'in_progress', validate: 'pending', scrape: 'pending', extract: 'pending', refine: 'pending' };
      case 'validating':
        return { discover: 'done', validate: 'in_progress', scrape: 'pending', extract: 'pending', refine: 'pending' };
      case 'scraping':
        return { discover: 'done', validate: 'done', scrape: 'in_progress', extract: 'pending', refine: 'pending' };
      case 'extracting':
      case 'deduplicating':
        return { discover: 'done', validate: 'done', scrape: 'done', extract: 'in_progress', refine: 'pending' };
      case 'refining':
      case 'embedding':
        return { discover: 'done', validate: 'done', scrape: 'done', extract: 'done', refine: 'in_progress' };
      case 'completed':
        return { discover: 'done', validate: 'done', scrape: 'done', extract: 'done', refine: 'done' };
      default:
        return { discover: 'pending', validate: 'pending', scrape: 'pending', extract: 'pending', refine: 'pending' };
    }
  };

  const stageStatuses = getStageStatuses();

  // Calculate current stage for progress line (0-5)
  const getCurrentStage = (): number => {
    if (stageStatuses.refine === 'done') return 5;
    if (stageStatuses.refine === 'in_progress') return 4;
    if (stageStatuses.extract === 'in_progress') return 3;
    if (stageStatuses.scrape === 'in_progress') return 2;
    if (stageStatuses.validate === 'in_progress') return 1;
    return 0;
  };

  // Calculate scrape progress
  const scrapePercent =
    stats.sitesValidated > 0
      ? Math.round((stats.sitesScraped / stats.sitesValidated) * 100)
      : 0;

  // Estimate time remaining
  const estimateTime = (): string => {
    if (targetCount <= 50) return '5-10 min';
    if (targetCount <= 100) return '10-20 min';
    return '30-45 min';
  };

  const isError = stats.phase === 'error';
  const isComplete = stats.phase === 'completed';

  const handleContinue = () => {
    onComplete({
      sitesScraped: stats.sitesScraped,
      faqsGenerated: stats.faqsAdded,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">Competitor Research</h2>
        <p className="text-sm text-muted-foreground">
          Learning from your competitors to build a comprehensive knowledge base.
          <br />
          <span className="font-medium text-foreground">{nicheQuery}</span>
          {serviceArea && <span className="text-muted-foreground"> in {serviceArea}</span>}
        </p>
      </div>

      {/* Stage Cards */}
      <div className="space-y-3">
        {/* Stage 1: Discover */}
        <StageCard
          stage={1}
          title="Discover Competitors"
          description={
            stageStatuses.discover === 'done'
              ? 'Found businesses in your area'
              : 'Finding businesses in your area'
          }
          status={stageStatuses.discover}
          icon={Search}
        >
          {stageStatuses.discover === 'done' && stats.sitesDiscovered > 0 && (
            <p className="text-sm text-success">
              ✓ {stats.sitesDiscovered} competitors found
            </p>
          )}
          {stageStatuses.discover === 'in_progress' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              <span>
                Searching for {nicheQuery} businesses...
                {stats.sitesDiscovered > 0 && ` ${stats.sitesDiscovered} found`}
              </span>
            </div>
          )}
        </StageCard>

        {/* Stage 2: Validate */}
        <StageCard
          stage={2}
          title="Validate Websites"
          description={
            stageStatuses.validate === 'done'
              ? 'Checked which businesses have useful websites'
              : stageStatuses.validate === 'in_progress'
              ? 'Checking which businesses have useful websites'
              : 'Check which businesses have useful websites'
          }
          status={stageStatuses.validate}
          icon={Filter}
        >
          {stageStatuses.validate === 'pending' && (
            <p className="text-sm text-muted-foreground">
              Waiting for discovery...
            </p>
          )}
          {stageStatuses.validate === 'in_progress' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              <span>
                Validating websites... {stats.sitesValidated} valid
              </span>
            </div>
          )}
          {stageStatuses.validate === 'done' && (
            <p className="text-sm text-success">
              ✓ {stats.sitesValidated} valid websites confirmed
            </p>
          )}
        </StageCard>

        {/* Stage 3: Scrape */}
        <StageCard
          stage={3}
          title="Scrape Websites"
          description={
            stageStatuses.scrape === 'done'
              ? 'Downloaded FAQ and service pages'
              : stageStatuses.scrape === 'in_progress'
              ? 'Reading FAQ and service pages'
              : 'Read FAQ and service pages'
          }
          status={stageStatuses.scrape}
          icon={Globe}
        >
          {stageStatuses.scrape === 'pending' && (
            <p className="text-sm text-muted-foreground">
              Waiting for validation...
            </p>
          )}
          {stageStatuses.scrape === 'in_progress' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Progress value={scrapePercent} className="h-2" />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    {stats.sitesScraped} / {stats.sitesValidated} sites
                  </span>
                  <span className="font-medium">{scrapePercent}%</span>
                </div>
              </div>
              {stats.currentSite && (
                <p className="text-xs text-muted-foreground truncate">
                  Currently: {stats.currentSite}
                </p>
              )}
            </div>
          )}
          {stageStatuses.scrape === 'done' && (
            <p className="text-sm text-success">
              ✓ {stats.sitesScraped} sites • {stats.pagesScraped} pages scraped
            </p>
          )}
        </StageCard>

        {/* Stage 4: Extract & Dedupe */}
        <StageCard
          stage={4}
          title="Extract & Dedupe FAQs"
          description={
            stageStatuses.extract === 'done'
              ? 'AI extracted and removed duplicates'
              : stageStatuses.extract === 'in_progress'
              ? 'AI is extracting and removing duplicate FAQs'
              : 'AI will extract and remove duplicate FAQs'
          }
          status={stageStatuses.extract}
          icon={FileText}
        >
          {stageStatuses.extract === 'pending' && (
            <p className="text-sm text-muted-foreground">
              Waiting for scraping...
            </p>
          )}
          {stageStatuses.extract === 'in_progress' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              <span>
                {stats.faqsExtracted > 0 ? `${stats.faqsExtracted} FAQs extracted` : 'Processing content...'}
                {stats.faqsAfterDedup > 0 && ` → ${stats.faqsAfterDedup} after dedup`}
              </span>
            </div>
          )}
          {stageStatuses.extract === 'done' && (
            <p className="text-sm text-success">
              ✓ {stats.faqsExtracted} FAQs → {stats.faqsAfterDedup} unique
            </p>
          )}
        </StageCard>

        {/* Stage 5: Refine */}
        <StageCard
          stage={5}
          title="Refine for Your Business"
          description={
            stageStatuses.refine === 'done'
              ? 'Adapted competitor FAQs for your business'
              : stageStatuses.refine === 'in_progress'
              ? 'Adapting competitor FAQs to match your services'
              : 'Adapt competitor FAQs to match your services'
          }
          status={stageStatuses.refine}
          icon={Wand2}
        >
          {stageStatuses.refine === 'pending' && (
            <p className="text-sm text-muted-foreground">
              Coming next...
            </p>
          )}
          {stageStatuses.refine === 'in_progress' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              <span>
                Personalising FAQs... {stats.faqsRefined > 0 && `${stats.faqsRefined} refined`}
              </span>
            </div>
          )}
          {stageStatuses.refine === 'done' && (
            <p className="text-sm text-success">
              ✓ {stats.faqsAdded} FAQs added to knowledge base
            </p>
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
          <p className="text-sm font-medium text-success">Competitor Research Complete!</p>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.faqsAdded} FAQs from {stats.sitesScraped} competitor websites added to your knowledge base.
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-3">
        <Button onClick={handleContinue} className="w-full gap-2">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
        {!isComplete && (
          <p className="text-xs text-center text-muted-foreground">
            You can continue while this runs in the background (~{estimateTime()})
          </p>
        )}
      </div>
    </div>
  );
}
