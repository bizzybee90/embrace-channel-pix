import { Mail, Menu, ClipboardCheck, Clock, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useState, useEffect } from 'react';

interface MobileBottomNavProps {
  activeFilter: string;
  onNavigate: (filter: string) => void;
  onMenuClick: () => void;
}

const navItems = [
  { 
    id: 'needs-action' as const, 
    icon: Mail, 
    label: 'Needs Action',
    badgeBg: 'bg-destructive/10',
    iconColor: 'text-destructive'
  },
  { 
    id: 'review' as const, 
    icon: ClipboardCheck, 
    label: 'Review',
    badgeBg: 'bg-amber-500/10',
    iconColor: 'text-amber-500'
  },
  { 
    id: 'snoozed' as const, 
    icon: Clock, 
    label: 'Snoozed',
    badgeBg: 'bg-amber-500/10',
    iconColor: 'text-amber-500'
  },
];

export const MobileBottomNav = ({ activeFilter, onNavigate, onMenuClick }: MobileBottomNavProps) => {
  const isMobile = useIsMobile();
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    const handleVisibilityChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ hidden: boolean }>;
      setIsHidden(customEvent.detail.hidden);
    };

    window.addEventListener('mobile-nav-visibility', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('mobile-nav-visibility', handleVisibilityChange);
    };
  }, []);

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
        "fixed bottom-0 inset-x-0 z-40 px-4 transition-all duration-300",
        isHidden ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'
      )}
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
    >
      <div className="max-w-xl mx-auto bg-sidebar/80 backdrop-blur-xl border border-sidebar-border rounded-2xl shadow-[0_-8px_32px_rgba(0,0,0,0.4)]">
        <div className="flex items-center justify-around px-1 py-1.5">
          {navItems.map((item) => {
            const isActive = item.id === activeFilter;
            const Icon = item.icon;
            
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-1 py-1.5 px-2',
                  'min-h-[52px] rounded-xl transition-all duration-200',
                  'active:scale-95',
                  isActive && 'bg-sidebar-accent'
                )}
              >
                <div className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-md transition-all',
                  item.badgeBg
                )}>
                  <Icon
                    className={cn(
                      'h-4 w-4 transition-colors',
                      item.iconColor
                    )}
                    strokeWidth={2}
                  />
                </div>
                <span
                  className={cn(
                    'text-[10px] font-medium transition-colors leading-tight',
                    isActive ? 'text-sidebar-accent-foreground' : 'text-sidebar-foreground/60'
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
          
          {/* Menu button */}
          <button
            onClick={onMenuClick}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-1 py-1.5 px-2',
              'min-h-[52px] rounded-xl transition-all duration-200',
              'active:scale-95'
            )}
          >
            <div className="flex items-center justify-center w-7 h-7 rounded-md">
              <Menu
                className="h-[18px] w-[18px] text-sidebar-foreground/60 transition-colors"
                strokeWidth={2}
              />
            </div>
            <span className="text-[10px] font-medium text-sidebar-foreground/60 transition-colors leading-tight">
              Menu
            </span>
          </button>
        </div>
      </div>
    </nav>
  );
};
