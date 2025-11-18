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
      <aside className={`border-r border-border bg-card flex-shrink-0 overflow-y-auto transition-all relative ${leftCollapsed ? 'w-0' : 'w-60'}`}>
        {!leftCollapsed && (
          <>
            <div className="absolute top-4 right-2 z-10">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLeftCollapsed(true)}
                className="h-8 w-8"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
            {sidebar}
          </>
        )}
        {leftCollapsed && (
          <div className="absolute top-4 left-2 z-10">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setLeftCollapsed(false)}
              className="h-8 w-8 bg-background/95 backdrop-blur"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {main}
      </main>

      {/* Context Panel */}
      <aside className={`border-l border-border bg-card flex-shrink-0 overflow-y-auto transition-all relative ${rightCollapsed ? 'w-0' : 'w-80'}`}>
        {!rightCollapsed && (
          <>
            <div className="absolute top-4 left-2 z-10">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setRightCollapsed(true)}
                className="h-8 w-8"
              >
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>
            {contextPanel}
          </>
        )}
        {rightCollapsed && (
          <div className="absolute top-4 right-2 z-10">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setRightCollapsed(false)}
              className="h-8 w-8 bg-background/95 backdrop-blur"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
};
