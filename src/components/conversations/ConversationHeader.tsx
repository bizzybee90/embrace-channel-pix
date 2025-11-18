import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { SLABadge } from '../sla/SLABadge';
import { Crown } from 'lucide-react';

interface ConversationHeaderProps {
  conversation: Conversation;
  onUpdate: () => void;
}

export const ConversationHeader = ({ conversation, onUpdate }: ConversationHeaderProps) => {
  const updateField = async (field: string, value: any) => {
    await supabase
      .from('conversations')
      .update({ [field]: value })
      .eq('id', conversation.id);
    onUpdate();
  };

  return (
    <div className="border-b border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">
            {conversation.customer?.name || 'Unknown Customer'}
          </h2>
          {conversation.customer?.tier === 'vip' && (
            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30">
              <Crown className="h-3 w-3 mr-1" />
              VIP
            </Badge>
          )}
        </div>
        <SLABadge
          slaStatus={conversation.sla_status}
          slaDueAt={conversation.sla_due_at}
          size="default"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select
          value={conversation.priority}
          onValueChange={(value) => updateField('priority', value)}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="high">🔴 High</SelectItem>
            <SelectItem value="medium">🟡 Medium</SelectItem>
            <SelectItem value="low">🟢 Low</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={conversation.status}
          onValueChange={(value) => updateField('status', value)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="waiting_customer">Waiting Customer</SelectItem>
            <SelectItem value="waiting_internal">Waiting Internal</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm">
          Assign
        </Button>
      </div>
    </div>
  );
};
