import { useState } from 'react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Sidebar } from './Sidebar';
import beeLogo from '@/assets/bee-logo.png';
import { Menu } from 'lucide-react';

interface MobileSidebarSheetProps {
  onNavigate?: () => void;
}

export const MobileSidebarSheet = ({ onNavigate }: MobileSidebarSheetProps) => {
  const [open, setOpen] = useState(false);

  const handleNavigate = () => {
    setOpen(false);
    onNavigate?.();
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button 
          className="fixed top-4 left-4 z-[9999] group"
          aria-label="Open menu"
        >
          <div className="relative flex items-center justify-center">
            {/* Animated background gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-500 scale-150" />
            
            {/* Main button container */}
            <div className="relative flex items-center gap-2 px-3 py-2 bg-background/95 backdrop-blur-md border border-border/50 rounded-xl shadow-lg group-hover:shadow-xl group-hover:border-primary/30 transition-all duration-300">
              {/* Logo */}
              <div className="relative">
                <img 
                  src={beeLogo} 
                  alt="Menu" 
                  className="h-8 w-8 transition-transform duration-300 group-hover:scale-110 group-active:scale-95" 
                />
                {/* Subtle glow */}
                <div className="absolute inset-0 rounded-full bg-primary/20 blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              </div>
              
              {/* Menu icon */}
              <Menu className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors duration-300" />
            </div>
          </div>
        </button>
      </SheetTrigger>
      <SheetContent 
        side="left" 
        className="w-[280px] p-0 border-r border-border/50 bg-background/98 backdrop-blur-xl"
      >
        <div className="h-full relative">
          {/* Subtle gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
          
          {/* Content */}
          <div className="relative h-full">
            <Sidebar onNavigate={handleNavigate} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
