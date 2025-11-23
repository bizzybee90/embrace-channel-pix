import { Menu, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import beeLogo from '@/assets/bee-logo.png';

interface MobileHeaderProps {
  onMenuClick: () => void;
  showBackButton?: boolean;
  onBackClick?: () => void;
  backToText?: string;
}

export const MobileHeader = ({ onMenuClick, showBackButton, onBackClick, backToText = 'Back' }: MobileHeaderProps) => {
  return (
    <header className="sticky top-0 z-50 bg-background border-b border-border/50 shadow-sm">
      <div className="flex items-center justify-between px-4 h-14">
        {/* Left: Back button OR Logo */}
        {showBackButton && onBackClick ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBackClick}
            className="gap-1 text-foreground hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="text-sm font-medium">{backToText}</span>
          </Button>
        ) : (
          <div className="flex items-center gap-2 bg-background/95 backdrop-blur-sm px-3 py-1.5 rounded-full border border-border/50 shadow-sm">
            <img src={beeLogo} alt="BizzyBee" className="h-6 w-6" />
            <span className="text-sm font-semibold text-foreground">BizzyBee</span>
          </div>
        )}

        {/* Right side is now empty - menu is in bottom nav */}
        <div className="w-9" />
      </div>
    </header>
  );
};
