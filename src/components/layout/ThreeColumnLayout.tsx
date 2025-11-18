import { ReactNode } from 'react';

interface ThreeColumnLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
  contextPanel: ReactNode;
}

export const ThreeColumnLayout = ({ sidebar, main, contextPanel }: ThreeColumnLayoutProps) => {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 border-r border-border bg-card flex-shrink-0 overflow-y-auto">
        {sidebar}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {main}
      </main>

      {/* Context Panel */}
      <aside className="w-80 border-l border-border bg-card flex-shrink-0 overflow-y-auto">
        {contextPanel}
      </aside>
    </div>
  );
};
