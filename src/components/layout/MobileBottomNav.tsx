import { Inbox, UserCircle, AlertTriangle, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useScrollDirection } from '@/hooks/useScrollDirection';
import { useIsMobile } from '@/hooks/use-mobile';

interface MobileBottomNavProps {
  activeFilter: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'completed' | 'high-priority' | 'vip-customers';
  onNavigate: (filter: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open' | 'completed' | 'high-priority' | 'vip-customers') => void;
}

const navItems = [
  { id: 'my-tickets' as const, icon: Inbox, label: 'My Tickets' },
  { id: 'unassigned' as const, icon: UserCircle, label: 'Unassigned' },
  { id: 'sla-risk' as const, icon: AlertTriangle, label: 'SLA Risk' },
  { id: 'all-open' as const, icon: FolderOpen, label: 'All Open' },
];

export const MobileBottomNav = ({ activeFilter, onNavigate }: MobileBottomNavProps) => {
  const { isHidden } = useScrollDirection(120);
  const isMobile = useIsMobile();

  if (!isMobile) return null;

  const handleNavClick = (filterId: typeof activeFilter) => {
    if (filterId === activeFilter) {
      // Scroll to top if already on this tab
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      onNavigate(filterId);
    }
  };

  return (
    <nav
      className={cn(
        'fixed bottom-0 inset-x-0 z-40',
        'transition-all duration-200 ease-out will-change-transform',
        isHidden ? 'translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="max-w-xl mx-auto bg-background/95 backdrop-blur-lg border-t border-border/60 rounded-t-2xl shadow-[0_-8px_20px_rgba(15,23,42,0.08)] py-2">
        <div className="flex items-center justify-around px-2">
          {navItems.map((item) => {
            const isActive = item.id === activeFilter;
            const Icon = item.icon;
            
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-1 py-2 px-3',
                  'min-h-[44px] rounded-lg transition-all duration-200',
                  'active:scale-95',
                  isActive && 'bg-primary/10'
                )}
              >
                <Icon
                  className={cn(
                    'h-5 w-5 transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <span
                  className={cn(
                    'text-xs font-medium transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground/80'
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
