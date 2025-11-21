import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading skeleton for conversation cards
 * 
 * Matches the exact dimensions and layout of ConversationCard
 * to prevent layout shift when data loads.
 */
export const ConversationCardSkeleton = () => {
  return (
    <div className="relative p-4 border-b border-border/40 hover:bg-muted/30 transition-colors">
      {/* Priority bar (left edge) */}
      <div className="absolute left-0 top-0 bottom-0 w-1">
        <Skeleton className="h-full w-full rounded-none" />
      </div>

      <div className="space-y-3">
        {/* Header row: title + timestamp */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-[90%]" />
            <Skeleton className="h-4 w-[70%]" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>

        {/* Badges row */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>
    </div>
  );
};
