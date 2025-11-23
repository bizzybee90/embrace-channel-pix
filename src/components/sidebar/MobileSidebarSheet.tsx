import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Sidebar } from './Sidebar';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MobileSidebarSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate?: () => void;
}

export const MobileSidebarSheet = ({ open, onOpenChange, onNavigate }: MobileSidebarSheetProps) => {
  const handleNavigate = () => {
    onOpenChange(false);
    onNavigate?.();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="left" 
        className="w-[80vw] max-w-sm p-0 border-r border-border shadow-2xl rounded-r-3xl bg-background"
      >
        <div className="h-full flex flex-col">
          {/* Close button */}
          <div className="flex items-center justify-end p-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 rounded-full hover:bg-accent"
            >
              <X className="h-4 w-4 text-foreground/80" />
            </Button>
          </div>

          {/* Sidebar content */}
          <div className="flex-1 overflow-y-auto">
            <Sidebar onNavigate={handleNavigate} forceCollapsed={false} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
