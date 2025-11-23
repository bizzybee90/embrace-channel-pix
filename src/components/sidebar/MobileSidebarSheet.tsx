import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Sidebar } from './Sidebar';

interface MobileSidebarSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate?: () => void;
  onFiltersClick?: () => void;
}

export const MobileSidebarSheet = ({ open, onOpenChange, onNavigate, onFiltersClick }: MobileSidebarSheetProps) => {
  const handleNavigate = () => {
    onOpenChange(false);
    onNavigate?.();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="left" 
        className="w-[80vw] max-w-sm p-0 border-r border-border shadow-2xl rounded-r-3xl bg-sidebar"
      >
        <div className="h-full flex flex-col overflow-y-auto">
          <Sidebar onNavigate={handleNavigate} forceCollapsed={false} onFiltersClick={onFiltersClick} />
        </div>
      </SheetContent>
    </Sheet>
  );
};
