import { useParams } from 'react-router-dom';
import { PowerModeLayout } from '@/components/layout/PowerModeLayout';

export default function ChannelConversations() {
  const { channel } = useParams<{ channel: string }>();
  
  return <PowerModeLayout filter="all-open" channelFilter={channel} />;
}
