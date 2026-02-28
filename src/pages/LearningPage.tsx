import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import { HowBizzyBeeIsDoing } from '@/components/learning/HowBizzyBeeIsDoing';
import { YourRules } from '@/components/learning/YourRules';
import { RecentLearning } from '@/components/learning/RecentLearning';
import { useRef, useCallback } from 'react';

export default function LearningPage() {
  const isMobile = useIsMobile();
  const rulesRef = useRef<{ highlightRule: (id: string) => void } | null>(null);

  const handleHighlightRule = useCallback((ruleId: string) => {
    rulesRef.current?.highlightRule(ruleId);
  }, []);

  const mainContent = (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="p-4 md:p-6 space-y-6 bg-background-alt min-h-full">
        <h1 className="text-xl font-semibold text-foreground tracking-tight">Learning & Training</h1>

        <HowBizzyBeeIsDoing />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <YourRules ref={rulesRef} />
          <RecentLearning onHighlightRule={handleHighlightRule} />
        </div>
      </div>
    </ScrollArea>
  );

  if (isMobile) {
    return (
      <MobilePageLayout>
        {mainContent}
      </MobilePageLayout>
    );
  }

  return (
    <ThreeColumnLayout
      sidebar={<Sidebar />}
      main={mainContent}
    />
  );
}
