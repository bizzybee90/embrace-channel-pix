import { ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';

interface ThreeColumnLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
}

export const ThreeColumnLayout = ({ sidebar, main }: ThreeColumnLayoutProps) => {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (isMobile) {
    return (
      <>
        <div className="flex h-screen w-full bg-slate-50/50 overflow-hidden flex-col">
          {/* Mobile Header */}
          <header className="flex-shrink-0 h-14 border-b border-border bg-card px-4 flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className="h-9 w-9"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold truncate">BizzyBee</h1>
            <div className="w-9" /> {/* Spacer for center alignment */}
          </header>

          {/* Main Content - Full Width on Mobile */}
          <main className="flex-1 overflow-y-auto">
            {main}
          </main>
        </div>

        {/* Mobile Sidebar Overlay */}
        <MobileSidebarSheet
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          onNavigate={() => setSidebarOpen(false)}
        />
      </>
    );
  }

  return (
    <div className="flex h-screen w-full bg-slate-50/50 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="border-r border-border bg-card flex-shrink-0 overflow-y-auto relative z-50">
        {sidebar}
      </aside>

      {/* Desktop Main Content */}
      <main className="flex-1 flex flex-col overflow-y-auto min-w-0">
        {main}
      </main>
    </div>
  );
};
