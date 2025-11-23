import { ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronRight, PanelLeftClose } from 'lucide-react';

interface ThreeColumnLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
}

export const ThreeColumnLayout = ({ sidebar, main }: ThreeColumnLayoutProps) => {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar - width controlled by sidebar component itself */}
      <aside className="border-r border-border bg-card flex-shrink-0 overflow-y-auto relative z-50">
        {sidebar}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {main}
      </main>
    </div>
  );
};
