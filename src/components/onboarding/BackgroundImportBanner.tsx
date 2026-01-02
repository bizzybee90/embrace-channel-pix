import { Mail, CheckCircle2, AlertCircle, Loader2, Inbox, Send } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useEmailImportStatus } from '@/hooks/useEmailImportStatus';
import { cn } from '@/lib/utils';

interface BackgroundImportBannerProps {
  workspaceId: string;
  className?: string;
}

export function BackgroundImportBanner({ workspaceId, className }: BackgroundImportBannerProps) {
  const { 
    isImporting, 
    progress, 
    statusMessage, 
    phase,
    inboxCount,
    inboxTotal,
    sentCount,
    sentTotal,
  } = useEmailImportStatus(workspaceId);

  // Don't show if idle or no import has been started
  if (phase === 'idle') return null;

  // Show success briefly
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

  // Active import state with inbox/sent breakdown
  return (
    <div className={cn(
      "flex flex-col gap-2 px-4 py-3 rounded-lg bg-primary/5 border border-primary/20 text-sm",
      className
    )}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="relative flex-shrink-0">
          <Mail className="h-4 w-4 text-primary" />
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-primary rounded-full animate-pulse" />
        </div>
        <span className="font-medium text-foreground">Importing emails...</span>
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
      </div>

      {/* Progress breakdown */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Inbox className={cn(
            "h-3.5 w-3.5",
            phase === 'fetching_inbox' ? "text-primary" : "text-muted-foreground"
          )} />
          <span className={cn(
            phase === 'fetching_inbox' ? "text-foreground font-medium" : "text-muted-foreground"
          )}>
            Inbox: {inboxCount.toLocaleString()}
            {inboxTotal > 0 && ` / ${inboxTotal.toLocaleString()}`}
          </span>
          {phase === 'fetching_inbox' && (
            <span className="text-primary text-[10px]">●</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Send className={cn(
            "h-3.5 w-3.5",
            phase === 'fetching_sent' ? "text-primary" : "text-muted-foreground"
          )} />
          <span className={cn(
            phase === 'fetching_sent' ? "text-foreground font-medium" : "text-muted-foreground"
          )}>
            {phase === 'fetching_inbox' ? (
              'Sent: Pending...'
            ) : (
              <>
                Sent: {sentCount.toLocaleString()}
                {sentTotal > 0 && ` / ${sentTotal.toLocaleString()}`}
              </>
            )}
          </span>
          {phase === 'fetching_sent' && (
            <span className="text-primary text-[10px]">●</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <Progress value={progress} className="h-1.5 flex-1" />
        <span className="text-xs text-muted-foreground w-8 text-right">{progress}%</span>
      </div>
    </div>
  );
}
