import { useNavigate } from 'react-router-dom';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { MobileHeader } from '@/components/sidebar/MobileHeader';
import { MobileSidebarSheet } from '@/components/sidebar/MobileSidebarSheet';
import { BackButton } from '@/components/shared/BackButton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import { Brain } from 'lucide-react';
import { useState } from 'react';
import { HowBizzyBeeIsDoing } from '@/components/learning/HowBizzyBeeIsDoing';
import { YourRules } from '@/components/learning/YourRules';
import { RecentLearning } from '@/components/learning/RecentLearning';

export default function LearningPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const mainContent = (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
        {!isMobile && (
          <div className="flex items-center gap-4">
            <BackButton to="/" />
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-purple-500/10">
                <Brain className="h-6 w-6 text-purple-500" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-foreground">Learning & Training</h1>
                <p className="text-sm text-muted-foreground">How BizzyBee is learning your patterns</p>
              </div>
            </div>
          </div>
        )}

        {isMobile && (
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/10">
              <Brain className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Learning & Training</h1>
              <p className="text-xs text-muted-foreground">How BizzyBee is learning</p>
            </div>
          </div>
        )}

        <HowBizzyBeeIsDoing />
        <YourRules />
        <RecentLearning />
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
