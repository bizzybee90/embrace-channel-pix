import { Menu, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import beeLogo from '@/assets/bee-logo.png';

interface MobileHeaderProps {
  onMenuClick: () => void;
  showBackButton?: boolean;
  onBackClick?: () => void;
}

export const MobileHeader = ({ onMenuClick, showBackButton, onBackClick }: MobileHeaderProps) => {
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
            <span className="text-sm font-medium">Back</span>
          </Button>
        ) : (
          <div className="flex items-center gap-2 bg-background/95 backdrop-blur-sm px-3 py-1.5 rounded-full border border-border/50 shadow-sm">
            <img src={beeLogo} alt="BizzyBee" className="h-6 w-6" />
            <span className="text-sm font-semibold text-foreground">BizzyBee</span>
          </div>
        )}

        {/* Right: Hamburger Menu */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onMenuClick}
          className="h-9 w-9 hover:bg-accent"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5 text-foreground" />
        </Button>
      </div>
    </header>
  );
};
