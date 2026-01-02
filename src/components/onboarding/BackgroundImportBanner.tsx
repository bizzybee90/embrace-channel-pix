import { Mail, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useEmailImportStatus } from '@/hooks/useEmailImportStatus';
import { cn } from '@/lib/utils';

interface BackgroundImportBannerProps {
  workspaceId: string;
  className?: string;
}

export function BackgroundImportBanner({ workspaceId, className }: BackgroundImportBannerProps) {
  const { isImporting, progress, statusMessage, phase } = useEmailImportStatus(workspaceId);

  // Don't show if idle or no import has been started
  if (phase === 'idle') return null;

  // Show success briefly then hide (we'll let toast handle long-term notification)
  if (phase === 'complete') {
    return (
      <div className={cn(
        "flex items-center gap-3 px-4 py-2.5 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50 text-green-700 dark:text-green-300 text-sm",
        className
      )}>
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1">{statusMessage}</span>
      </div>
    );
  }

  // Show error state
  if (phase === 'error') {
    return (
      <div className={cn(
        "flex items-center gap-3 px-4 py-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm",
        className
      )}>
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1 truncate">{statusMessage}</span>
      </div>
    );
  }

  // Active import state
  return (
    <div className={cn(
      "flex items-center gap-3 px-4 py-2.5 rounded-lg bg-primary/5 border border-primary/20 text-sm",
      className
    )}>
      <div className="relative flex-shrink-0">
        <Mail className="h-4 w-4 text-primary" />
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-primary rounded-full animate-pulse" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-foreground truncate">{statusMessage}</span>
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" />
        </div>
        <Progress value={progress} className="h-1" />
      </div>
      <span className="text-xs text-muted-foreground flex-shrink-0">{progress}%</span>
    </div>
  );
}
