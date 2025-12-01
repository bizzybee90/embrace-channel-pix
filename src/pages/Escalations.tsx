import { PowerModeLayout } from '@/components/layout/PowerModeLayout';
import { TabletLayout } from '@/components/layout/TabletLayout';
import { useIsTablet } from '@/hooks/use-tablet';

export default function Escalations() {
  const isTablet = useIsTablet();
  
  // Use tablet-optimized layout on tablet devices
  if (isTablet) {
    return <TabletLayout filter="all-open" />;
  }
  
  return <PowerModeLayout filter="escalations" />;
}
