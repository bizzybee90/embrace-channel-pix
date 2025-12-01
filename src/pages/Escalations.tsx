import { PowerModeLayout } from '@/components/layout/PowerModeLayout';
import { TabletLayout } from '@/components/layout/TabletLayout';
import { useIsTablet } from '@/hooks/use-tablet';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileEscalationHub } from '@/pages/mobile/MobileEscalationHub';

export default function Escalations() {
  const isTablet = useIsTablet();
  const isMobile = useIsMobile();
  
  // Use mobile layout on mobile devices
  if (isMobile) {
    return <MobileEscalationHub filter="all-open" />;
  }
  
  // Use tablet-optimized layout on tablet devices
  if (isTablet) {
    return <TabletLayout filter="all-open" />;
  }
  
  return <PowerModeLayout filter="escalations" />;
}
