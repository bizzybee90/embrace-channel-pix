import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Sidebar } from './Sidebar';
import beeLogo from '@/assets/bee-logo.png';

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
          className="fixed top-4 left-4 z-[9999] flex flex-col items-center gap-1 group"
          aria-label="Open menu"
        >
          <div className="relative">
            {/* Subtle background circle */}
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm rounded-full scale-125 border border-border/50 group-hover:border-primary/50 transition-all duration-300" />
            
            {/* Logo */}
            <img 
              src={beeLogo} 
              alt="Menu" 
              className="h-10 w-10 relative z-10 transition-all duration-300 group-hover:scale-110 group-active:scale-95" 
            />
            
            {/* Pulse effect on hover */}
            <div className="absolute inset-0 rounded-full bg-primary/10 opacity-0 group-hover:opacity-100 animate-pulse transition-opacity duration-300 blur-sm" />
          </div>
          
          {/* Menu label */}
          <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground transition-colors duration-200">
            Menu
          </span>
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] p-0">
        <Sidebar onNavigate={handleNavigate} />
      </SheetContent>
    </Sheet>
  );
};
