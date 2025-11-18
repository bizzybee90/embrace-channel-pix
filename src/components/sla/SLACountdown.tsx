import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SLACountdownProps {
  slaDueAt: string | null;
  className?: string;
}

export const SLACountdown = ({ slaDueAt, className }: SLACountdownProps) => {
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const [isOverdue, setIsOverdue] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);

  useEffect(() => {
    if (!slaDueAt) return;

    const updateCountdown = () => {
      const now = new Date();
      const dueDate = new Date(slaDueAt);
      const minutesRemaining = (dueDate.getTime() - now.getTime()) / 1000 / 60;

      setIsOverdue(minutesRemaining <= 0);
      setIsUrgent(minutesRemaining > 0 && minutesRemaining <= 15);
      
      if (minutesRemaining <= 0) {
        setTimeRemaining('OVERDUE');
      } else if (minutesRemaining <= 60) {
        setTimeRemaining(`${Math.floor(minutesRemaining)}m left`);
      } else {
        setTimeRemaining(formatDistanceToNow(dueDate, { addSuffix: true }));
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 10000); // Update every 10 seconds

    return () => clearInterval(interval);
  }, [slaDueAt]);

  if (!slaDueAt) return null;

  const Icon = isOverdue ? AlertTriangle : Clock;

  return (
    <div className={cn(
      'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md',
      isOverdue && 'bg-urgent/10 text-urgent animate-pulse',
      isUrgent && !isOverdue && 'bg-warning/10 text-warning',
      !isOverdue && !isUrgent && 'bg-safe/10 text-safe',
      className
    )}>
      <Icon className="h-3 w-3" />
      {timeRemaining}
    </div>
  );
};
