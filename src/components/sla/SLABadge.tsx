import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SLABadgeProps {
  slaStatus: string;
  slaDueAt: string | null;
  size?: 'sm' | 'default';
}

export const SLABadge = ({ slaStatus, slaDueAt, size = 'sm' }: SLABadgeProps) => {
  if (!slaDueAt) return null;

  const dueDate = new Date(slaDueAt);
  const now = new Date();
  const isBreached = dueDate < now;
  
  const timeText = isBreached
    ? `Breached ${formatDistanceToNow(dueDate, { addSuffix: true })}`
    : formatDistanceToNow(dueDate, { addSuffix: true });

  const getStatusColor = () => {
    if (isBreached || slaStatus === 'breached') {
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    }
    if (slaStatus === 'warning') {
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
    }
    return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  };

  return (
    <Badge variant="outline" className={cn('flex items-center gap-1', getStatusColor(), size === 'sm' && 'text-xs')}>
      <Clock className="h-3 w-3" />
      {timeText}
    </Badge>
  );
};
