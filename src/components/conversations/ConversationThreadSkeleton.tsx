import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading skeleton for conversation thread view
 * 
 * Shows placeholders for:
 * - AI Context (Why Escalated)
 * - Summary
 * - Message bubbles
 */
export const ConversationThreadSkeleton = () => {
  return (
    <div className="space-y-6 p-6">
      {/* AI Context Card Skeleton */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[90%]" />
        <Skeleton className="h-4 w-[80%]" />
      </div>

      {/* Summary Card Skeleton */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[85%]" />
      </div>

      {/* Message Bubbles Skeleton */}
      <div className="space-y-4">
        {/* Incoming message (left) */}
        <div className="flex justify-start">
          <div className="max-w-[70%] space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        </div>

        {/* Outgoing message (right) */}
        <div className="flex justify-end">
          <div className="max-w-[70%] space-y-2">
            <Skeleton className="h-4 w-24 ml-auto" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>

        {/* Incoming message (left) */}
        <div className="flex justify-start">
          <div className="max-w-[70%] space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
};
