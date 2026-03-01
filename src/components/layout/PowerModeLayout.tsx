import React, { useState } from 'react';
import { Sidebar } from '../sidebar/Sidebar';
import { MobileSidebarSheet } from '../sidebar/MobileSidebarSheet';
import { MobileHeader } from '../sidebar/MobileHeader';
import { useIsMobile } from '@/hooks/use-mobile';

interface PowerModeLayoutProps {
  children: React.ReactNode;
  header?: React.ReactNode;
}

export const PowerModeLayout = ({ children, header }: PowerModeLayoutProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <div className="flex h-screen w-full bg-slate-50/50 overflow-hidden font-sans">
      {/* Desktop Sidebar - Floats independently */}
      <aside className="hidden md:flex h-full flex-col z-20">
        <Sidebar />
      </aside>

      {/* Main Content Area - The White Rounded Pill */}
      <main className="flex-1 flex flex-col h-full w-full relative z-10 md:p-4">
        <div className="flex-1 flex flex-col bg-white md:rounded-[24px] md:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.05)] md:border md:border-slate-200/80 overflow-hidden h-full">
          
          {/* Header - Inside the white pill */}
          {header && (
            <header className="flex-shrink-0 border-b border-slate-100 bg-white z-10">
              <div className="flex items-center h-14 md:h-16 px-4 md:px-6">
                {isMobile && (
                  <div className="mr-2">
                    <MobileHeader onMenuClick={() => setSidebarOpen(true)} />
                  </div>
                )}
                <div className="flex-1 flex items-center">
                  {header}
                </div>
              </div>
            </header>
          )}

          {/* Mobile header fallback when no header prop */}
          {!header && isMobile && (
            <header className="flex-shrink-0 border-b border-slate-100 bg-white z-10">
              <div className="flex items-center h-14 px-4">
                <MobileHeader onMenuClick={() => setSidebarOpen(true)} />
              </div>
            </header>
          )}
          
          {/* Scrollable Content */}
          <div className="flex-1 overflow-hidden relative">
            {children}
          </div>
        </div>
      </main>

      {/* Mobile Sidebar Sheet */}
      <MobileSidebarSheet open={sidebarOpen} onOpenChange={setSidebarOpen} />
    </div>
  );
};
