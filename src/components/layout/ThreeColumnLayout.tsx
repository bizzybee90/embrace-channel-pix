import React, { ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronRight, PanelLeftClose } from 'lucide-react';

interface ThreeColumnLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
}

export const ThreeColumnLayout = ({ sidebar, main }: ThreeColumnLayoutProps) => {
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className={`border-r border-border bg-card flex-shrink-0 overflow-y-auto transition-all duration-300 relative ${leftCollapsed ? 'w-16' : 'w-60'}`}>
        {React.cloneElement(sidebar as React.ReactElement, { collapsed: leftCollapsed })}
        <div className={`absolute top-4 z-10 transition-all duration-300 ${leftCollapsed ? 'right-2' : 'right-2'}`}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLeftCollapsed(!leftCollapsed)}
            className="h-8 w-8 bg-background/95 backdrop-blur hover:bg-accent"
          >
            {leftCollapsed ? <ChevronRight className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {main}
      </main>
    </div>
  );
};
