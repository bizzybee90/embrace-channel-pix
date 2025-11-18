import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Clock, AlertTriangle, CheckCircle } from 'lucide-react';
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
  const isOverdue = dueDate < now;
  
  const timeText = isOverdue
    ? `Overdue ${formatDistanceToNow(dueDate, { addSuffix: true })}`
    : formatDistanceToNow(dueDate, { addSuffix: true });

  const getStatusConfig = () => {
    if (isOverdue || slaStatus === 'breached') {
      return {
        color: 'bg-urgent/10 text-urgent border-urgent/30',
        icon: AlertTriangle,
        label: 'Overdue'
      };
    }
    if (slaStatus === 'warning') {
      return {
        color: 'bg-warning/10 text-warning border-warning/30',
        icon: Clock,
        label: 'Due Soon'
      };
    }
    return {
      color: 'bg-safe/10 text-safe border-safe/30',
      icon: CheckCircle,
      label: 'On Track'
    };
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn('flex items-center gap-1', config.color, size === 'sm' && 'text-xs')}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
};
