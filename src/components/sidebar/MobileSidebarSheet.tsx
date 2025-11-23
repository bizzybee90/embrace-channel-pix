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
        <Button 
          variant="ghost" 
          size="icon"
          className="fixed top-4 left-4 z-[9999] h-12 w-12 rounded-full p-0"
        >
          <img src={beeLogo} alt="Menu" className="h-8 w-8" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] p-0">
        <Sidebar onNavigate={handleNavigate} />
      </SheetContent>
    </Sheet>
  );
};
