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
            className="gap-1 text-foreground hover:bg-accent -ml-2"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="text-sm font-medium">{backToText}</span>
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <img src={beeLogo} alt="BizzyBee" className="h-7 w-7" />
            <span className="text-base font-semibold text-foreground">BizzyBee</span>
          </div>
        )}

        {/* Right: Hamburger menu */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onMenuClick}
          className="h-9 w-9"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
};
