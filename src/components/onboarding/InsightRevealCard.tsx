import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface InsightRevealCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  suffix?: string;
  color?: 'primary' | 'green' | 'blue' | 'amber' | 'purple';
  delay?: number;
  animate?: boolean;
}

export function InsightRevealCard({ 
  icon, 
  label, 
  value, 
  suffix = '',
  color = 'primary',
  delay = 0,
  animate = true 
}: InsightRevealCardProps) {
  const [displayValue, setDisplayValue] = useState(animate ? 0 : value);
  const [isRevealed, setIsRevealed] = useState(!animate);

  useEffect(() => {
    if (!animate) return;

    // Reveal animation with delay
    const revealTimer = setTimeout(() => {
      setIsRevealed(true);
      
      // Number counting animation
      if (typeof value === 'number' && value > 0) {
        const duration = 1500;
        const steps = 30;
        const increment = value / steps;
        let current = 0;
        
        const countTimer = setInterval(() => {
          current += increment;
          if (current >= value) {
            setDisplayValue(value);
            clearInterval(countTimer);
          } else {
            setDisplayValue(Math.floor(current));
          }
        }, duration / steps);
        
        return () => clearInterval(countTimer);
      } else {
        setDisplayValue(value);
      }
    }, delay);

    return () => clearTimeout(revealTimer);
  }, [value, animate, delay]);

  const colorClasses = {
    primary: 'text-primary',
    green: 'text-green-600',
    blue: 'text-blue-600',
    amber: 'text-amber-600',
    purple: 'text-amber-600',
  };

  const bgClasses = {
    primary: 'bg-primary/10',
    green: 'bg-green-100 dark:bg-green-900/30',
    blue: 'bg-blue-100 dark:bg-blue-900/30',
    amber: 'bg-amber-100 dark:bg-amber-900/30',
    purple: 'bg-amber-100 dark:bg-amber-900/30',
  };

  return (
    <div 
      className={cn(
        'rounded-xl p-4 text-center transition-all duration-500 transform',
        bgClasses[color],
        isRevealed ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95'
      )}
    >
      <div className={cn('flex justify-center mb-2', colorClasses[color])}>
        {icon}
      </div>
      <div className={cn('text-2xl md:text-3xl font-bold', colorClasses[color])}>
        {typeof displayValue === 'number' ? displayValue.toLocaleString() : displayValue}
        {suffix}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

interface SpotifyWrappedRevealProps {
  title: string;
  subtitle?: string;
  stats: Array<{
    icon: React.ReactNode;
    label: string;
    value: number | string;
    suffix?: string;
    color?: 'primary' | 'green' | 'blue' | 'amber' | 'purple';
  }>;
  children?: React.ReactNode;
}

export function SpotifyWrappedReveal({ title, subtitle, stats, children }: SpotifyWrappedRevealProps) {
  const [showTitle, setShowTitle] = useState(false);
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    setShowTitle(true);
    const timer = setTimeout(() => setShowStats(true), 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-6">
      {/* Title reveal */}
      <div 
        className={cn(
          'text-center transition-all duration-700 transform',
          showTitle ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        )}
      >
        <h2 className="text-xl md:text-2xl font-semibold text-foreground">{title}</h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-2">{subtitle}</p>
        )}
      </div>

      {/* Stats grid with staggered reveal */}
      {showStats && (
        <div className={cn(
          'grid gap-3',
          stats.length === 2 ? 'grid-cols-2' :
          stats.length === 3 ? 'grid-cols-3' :
          stats.length === 4 ? 'grid-cols-2 sm:grid-cols-4' :
          'grid-cols-2 sm:grid-cols-3'
        )}>
          {stats.map((stat, index) => (
            <InsightRevealCard
              key={stat.label}
              icon={stat.icon}
              label={stat.label}
              value={stat.value}
              suffix={stat.suffix}
              color={stat.color}
              delay={index * 200}
            />
          ))}
        </div>
      )}

      {children}
    </div>
  );
}
