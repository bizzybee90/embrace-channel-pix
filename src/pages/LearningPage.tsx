import { useNavigate } from 'react-router-dom';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { BackButton } from '@/components/shared/BackButton';
import { LearningSystemPanel } from '@/components/settings/LearningSystemPanel';
import { LearningAnalyticsDashboard } from '@/components/settings/LearningAnalyticsDashboard';
import { TriageLearningPanel } from '@/components/settings/TriageLearningPanel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import { Brain } from 'lucide-react';

export default function LearningPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const mainContent = (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="p-6 space-y-6">
        {/* Header */}
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
      <div className="min-h-screen bg-background">
        {mainContent}
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
