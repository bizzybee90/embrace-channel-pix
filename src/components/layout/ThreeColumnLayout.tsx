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
      <aside className={`border-r border-border bg-card flex-shrink-0 overflow-hidden transition-all duration-300 relative ${leftCollapsed ? 'w-12' : 'w-60'}`}>
        {!leftCollapsed && sidebar}
        <div className={`absolute top-4 z-10 transition-all duration-300 ${leftCollapsed ? 'left-2' : 'right-2'}`}>
          <Button
            variant={leftCollapsed ? "outline" : "ghost"}
            size="icon"
            onClick={() => setLeftCollapsed(!leftCollapsed)}
            className="h-8 w-8 bg-background/95 backdrop-blur"
          >
            {leftCollapsed ? <ChevronRight className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {main}
      </main>

      {/* Context Panel */}
      <aside className={`border-l border-border bg-card flex-shrink-0 overflow-hidden transition-all duration-300 relative ${rightCollapsed ? 'w-12' : 'w-80'}`}>
        {!rightCollapsed && contextPanel}
        <div className={`absolute top-4 z-10 transition-all duration-300 ${rightCollapsed ? 'right-2' : 'left-2'}`}>
          <Button
            variant={rightCollapsed ? "outline" : "ghost"}
            size="icon"
            onClick={() => setRightCollapsed(!rightCollapsed)}
            className="h-8 w-8 bg-background/95 backdrop-blur"
          >
            {rightCollapsed ? <ChevronLeft className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </Button>
        </div>
      </aside>
    </div>
  );
};
