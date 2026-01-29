import { useEffect, useState } from 'react';
import { Mail, CheckCircle2, AlertCircle, Loader2, Sparkles, Brain } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface BackgroundImportBannerProps {
  workspaceId: string;
  className?: string;
}

interface ImportProgress {
  current_phase: string | null;
  emails_received: number | null;
  emails_classified: number | null;
  last_error: string | null;
}

// Clear 3-stage progress mapping
const PHASES = {
  connecting: { label: 'Connecting to email...', stage: 1, icon: Mail },
  importing: { label: 'Importing emails', stage: 1, icon: Mail },
  classifying: { label: 'Classifying emails', stage: 2, icon: Sparkles },
  learning: { label: 'Learning your voice', stage: 3, icon: Brain },
  complete: { label: 'Import complete!', stage: 4, icon: CheckCircle2 },
  error: { label: 'Import failed', stage: 0, icon: AlertCircle },
} as const;

function getPhaseConfig(phase: string | null) {
  if (!phase) return PHASES.connecting;
  return PHASES[phase as keyof typeof PHASES] || PHASES.connecting;
}

function getPhaseLabel(p: ImportProgress): string {
  const phase = p.current_phase;
  const config = getPhaseConfig(phase);
  
  if (phase === 'importing') {
    const count = p.emails_received || 0;
    return `${config.label}... ${count.toLocaleString()} received`;
  }
  
  if (phase === 'classifying') {
    return `${config.label}... (one-time, ~30s)`;
  }
  
  if (phase === 'learning') {
    return `${config.label}...`;
  }
  
  if (phase === 'error') {
    return p.last_error || config.label;
  }
  
  return config.label;
}

function getPercent(p: ImportProgress): number {
  const phase = p.current_phase;
  if (!phase || phase === 'connecting') return 5;
  if (phase === 'complete') return 100;
  if (phase === 'error') return 0;

  // Stage 1: Importing (0-60%)
  if (phase === 'importing') {
    const received = p.emails_received || 0;
    // Estimate based on typical import size (30k target)
    return Math.min(60, 5 + Math.round((received / 30000) * 55));
  }

  // Stage 2: Classifying (60-85%)
  if (phase === 'classifying') return 70;

  // Stage 3: Learning (85-100%)
  if (phase === 'learning') return 90;

  return 0;
}

export function BackgroundImportBanner({ workspaceId, className }: BackgroundImportBannerProps) {
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  useEffect(() => {
    if (!workspaceId) return;

    const fetchInitial = async () => {
      const { data } = await supabase
        .from('email_import_progress')
        .select('current_phase, emails_received, emails_classified, last_error')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (data) setProgress(data as ImportProgress);
    };

    fetchInitial();

    const channel = supabase
      .channel('onboarding-import-banner')
      .on(
        'postgres_changes',
        { schema: 'public', table: 'email_import_progress', event: '*', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          if (payload.new) setProgress(payload.new as ImportProgress);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  // Don't show banner if no progress or idle
  if (!progress) return null;
  const phase = progress.current_phase;
  if (!phase || phase === 'idle') return null;

  const config = getPhaseConfig(phase);
  const Icon = config.icon;

  // Complete state
  if (phase === 'complete') {
    return (
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50 text-green-700 dark:text-green-300 text-sm',
          className
        )}
      >
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1">{getPhaseLabel(progress)}</span>
      </div>
    );
  }

  // Error state
  if (phase === 'error') {
    return (
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm',
          className
        )}
      >
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1 truncate">{getPhaseLabel(progress)}</span>
      </div>
    );
  }

  // Active progress state
  const percent = getPercent(progress);

  return (
    <div className={cn('flex flex-col gap-2 px-4 py-3 rounded-lg bg-primary/5 border border-primary/20 text-sm', className)}>
      {/* Stage indicators */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span className={cn(config.stage >= 1 ? 'text-primary font-medium' : '')}>Import</span>
        <span>→</span>
        <span className={cn(config.stage >= 2 ? 'text-primary font-medium' : '')}>Classify</span>
        <span>→</span>
        <span className={cn(config.stage >= 3 ? 'text-primary font-medium' : '')}>Learn</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-shrink-0">
          <Icon className="h-4 w-4 text-primary" />
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-primary rounded-full animate-pulse" />
        </div>
        <span className="font-medium text-foreground truncate">{getPhaseLabel(progress)}</span>
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
      </div>

      <div className="flex items-center gap-2">
        <Progress value={percent} className="h-1.5 flex-1" />
        <span className="text-xs text-muted-foreground w-10 text-right">{percent}%</span>
      </div>
    </div>
  );
}
