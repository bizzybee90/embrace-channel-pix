import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { PowerModeLayout } from '@/components/layout/PowerModeLayout';
import { InboxContent } from '@/components/conversations/InboxContent';
import { SearchInput } from '@/components/conversations/SearchInput';
import { BackButton } from '@/components/shared/BackButton';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';

export default function ChannelConversations() {
  const { channel } = useParams<{ channel: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['jace-inbox'] });
  };

  const headerContent = (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-3">
        <BackButton to="/channels" label="Channels" />
        <h1 className="text-base font-semibold capitalize">{channel || 'Channel'}</h1>
      </div>
      <div className="flex items-center gap-4">
        <div className="w-64">
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search conversations..." />
        </div>
        <Button variant="ghost" size="sm" onClick={handleRefresh} className="h-8 w-8 p-0">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <PowerModeLayout header={headerContent}>
      <InboxContent filter="all-open" channelFilter={channel} />
    </PowerModeLayout>
  );
}
