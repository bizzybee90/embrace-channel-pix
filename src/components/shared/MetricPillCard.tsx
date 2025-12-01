import { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface MetricPillCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  iconColor?: string;
  bgColor?: string;
  className?: string;
}

export const MetricPillCard = ({
  title,
  value,
  subtitle,
  icon,
  iconColor = 'text-primary',
  bgColor = 'bg-card',
  className
}: MetricPillCardProps) => {
  return (
    <Card className={cn(
      'p-5 rounded-2xl border-border/50',
      bgColor,
      className
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-muted-foreground mb-3">
            {title}
          </p>
          <h3 className="text-4xl font-bold mb-1">
            {value}
          </h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-2">
              {subtitle}
            </p>
          )}
        </div>
        <div className={cn('flex-shrink-0 mt-1', iconColor)}>
          {icon}
        </div>
      </div>
    </Card>
  );
};
