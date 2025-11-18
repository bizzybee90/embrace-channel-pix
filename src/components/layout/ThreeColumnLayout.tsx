import { ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelRightClose } from 'lucide-react';

interface ThreeColumnLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
  contextPanel: ReactNode;
}

export const ThreeColumnLayout = ({ sidebar, main, contextPanel }: ThreeColumnLayoutProps) => {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className={`border-r border-border bg-card flex-shrink-0 overflow-y-auto transition-all ${leftCollapsed ? 'w-0' : 'w-60'}`}>
        {!leftCollapsed && sidebar}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div className="absolute top-4 left-4 z-10 flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setLeftCollapsed(!leftCollapsed)}
            className="h-8 w-8 bg-background/95 backdrop-blur"
          >
            {leftCollapsed ? <ChevronRight className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
        
        <div className="absolute top-4 right-4 z-10">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setRightCollapsed(!rightCollapsed)}
            className="h-8 w-8 bg-background/95 backdrop-blur"
          >
            {rightCollapsed ? <ChevronLeft className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </Button>
        </div>
        
        {main}
      </main>

      {/* Context Panel */}
      <aside className={`border-l border-border bg-card flex-shrink-0 overflow-y-auto transition-all ${rightCollapsed ? 'w-0' : 'w-80'}`}>
        {!rightCollapsed && contextPanel}
      </aside>
    </div>
  );
};
