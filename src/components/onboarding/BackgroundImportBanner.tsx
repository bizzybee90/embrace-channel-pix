import { useEffect, useState } from 'react';
import { Mail, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
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
  conversations_found: number | null;
  conversations_with_replies: number | null;
  pairs_analyzed: number | null;
  voice_profile_complete: boolean | null;
  playbook_complete: boolean | null;
  last_error: string | null;
}

function getPhaseLabel(p: ImportProgress): string {
  switch (p.current_phase) {
    case 'importing':
      return `Importing emails… ${(p.emails_received || 0).toLocaleString()} received`;
    case 'classifying':
      return `Classifying… ${(p.emails_classified || 0).toLocaleString()} / ${(p.emails_received || 0).toLocaleString()}`;
    case 'analyzing':
      return `Analyzing… ${(p.conversations_with_replies || 0).toLocaleString()} conversations with replies`;
    case 'learning':
      return `Learning your style… ${(p.pairs_analyzed || 0).toLocaleString()} pairs analyzed`;
    case 'complete':
      return 'Import complete!';
    case 'error':
      return p.last_error || 'Import failed';
    default:
      return 'Preparing…';
  }
}

function getPercent(p: ImportProgress): number {
  const phase = p.current_phase;
  if (!phase || phase === 'connecting') return 0;
  if (phase === 'complete') return 100;
  if (phase === 'error') return 0;

  if (phase === 'importing') {
    const received = p.emails_received || 0;
    // Lightweight estimate: 0-40% while importing.
    return Math.min(40, Math.round((received / 500) * 40));
  }

  if (phase === 'classifying') {
    const received = Math.max(p.emails_received || 0, 1);
    const classified = p.emails_classified || 0;
    return 40 + Math.round((classified / received) * 20);
  }

  if (phase === 'analyzing') return 65;
  if (phase === 'learning') return 85;
  return 0;
}

export function BackgroundImportBanner({ workspaceId, className }: BackgroundImportBannerProps) {
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  useEffect(() => {
    if (!workspaceId) return;

    const fetchInitial = async () => {
      const { data } = await supabase
        .from('email_import_progress')
        .select(
          'current_phase, emails_received, emails_classified, conversations_found, conversations_with_replies, pairs_analyzed, voice_profile_complete, playbook_complete, last_error'
        )
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

  // Don’t show banner unless the new pipeline is running (or has a meaningful status).
  if (!progress) return null;
  const phase = progress.current_phase;
  if (!phase || phase === 'idle') return null;

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

  const percent = getPercent(progress);

  return (
    <div className={cn('flex flex-col gap-2 px-4 py-3 rounded-lg bg-primary/5 border border-primary/20 text-sm', className)}>
      <div className="flex items-center gap-2">
        <div className="relative flex-shrink-0">
          <Mail className="h-4 w-4 text-primary" />
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

