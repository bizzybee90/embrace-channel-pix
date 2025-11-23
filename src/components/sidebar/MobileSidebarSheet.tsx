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
        className="w-[88vw] max-w-[420px] p-0 border-r border-border shadow-2xl rounded-r-3xl bg-background md:max-w-sm md:w-[80vw] [&>button]:hidden"
      >
        <div className="h-full flex flex-col overflow-y-auto pt-6 pb-8 px-5">
          <Sidebar onNavigate={handleNavigate} forceCollapsed={false} onFiltersClick={onFiltersClick} isMobileDrawer />
        </div>
      </SheetContent>
    </Sheet>
  );
};
