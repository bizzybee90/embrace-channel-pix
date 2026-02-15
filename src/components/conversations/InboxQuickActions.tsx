import { Archive, Clock, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { Conversation } from '@/lib/types';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface InboxQuickActionsProps {
  conversation: Conversation;
}

export const InboxQuickActions = ({ conversation }: InboxQuickActionsProps) => {
  const queryClient = useQueryClient();

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase
      .from('conversations')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', conversation.id);
    toast.success('Archived');
    queryClient.invalidateQueries({ queryKey: ['jace-inbox'] });
  };

  const handleSnooze = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const snoozeUntil = new Date();
    snoozeUntil.setHours(snoozeUntil.getHours() + 4);
    await supabase
      .from('conversations')
      .update({ snoozed_until: snoozeUntil.toISOString() })
      .eq('id', conversation.id);
    toast.success('Snoozed for 4 hours');
    queryClient.invalidateQueries({ queryKey: ['jace-inbox'] });
  };

  const handleMarkRead = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase
      .from('conversations')
      .update({ status: 'open' })
      .eq('id', conversation.id);
    toast.success('Marked as read');
    queryClient.invalidateQueries({ queryKey: ['jace-inbox'] });
  };

  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleArchive}>
            <Archive className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top"><p>Archive (e)</p></TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSnooze}>
            <Clock className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top"><p>Snooze</p></TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleMarkRead}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top"><p>Mark read</p></TooltipContent>
      </Tooltip>
    </div>
  );
};
