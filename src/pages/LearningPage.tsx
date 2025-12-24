import { useNavigate } from 'react-router-dom';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { MobileHeader } from '@/components/sidebar/MobileHeader';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';
import { BackButton } from '@/components/shared/BackButton';
import { LearningSystemPanel } from '@/components/settings/LearningSystemPanel';
import { LearningAnalyticsDashboard } from '@/components/settings/LearningAnalyticsDashboard';
import { TriageLearningPanel } from '@/components/settings/TriageLearningPanel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import { Brain } from 'lucide-react';
import { useState } from 'react';

export default function LearningPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const mainContent = (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header - only show on desktop, mobile uses MobileHeader */}
        {!isMobile && (
          <div className="flex items-center gap-4">
            <BackButton to="/" />
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-purple-500/10">
                <Brain className="h-6 w-6 text-purple-500" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-foreground">Learning & Training</h1>
                <p className="text-sm text-muted-foreground">Help BizzyBee learn your patterns</p>
              </div>
            </div>
          </div>
        )}

        {/* Mobile page title */}
        {isMobile && (
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/10">
              <Brain className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Learning & Training</h1>
              <p className="text-xs text-muted-foreground">Help BizzyBee learn</p>
            </div>
          </div>
        )}

        {/* Learning Analytics */}
        <LearningAnalyticsDashboard />

        {/* Triage Learning */}
        <TriageLearningPanel />

        {/* Learning System */}
        <LearningSystemPanel />
      </div>
    </ScrollArea>
  );

  if (isMobile) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <MobileHeader 
          onMenuClick={() => setSidebarOpen(true)}
          showBackButton
          onBackClick={() => navigate('/')}
          backToText="Home"
        />
        <MobileSidebarSheet
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          onNavigate={() => setSidebarOpen(false)}
        />
        <main className="flex-1 overflow-y-auto">
          {mainContent}
        </main>
      </div>
    );
  }

  return (
    <ThreeColumnLayout
      sidebar={<Sidebar />}
      main={mainContent}
    />
  );
}
