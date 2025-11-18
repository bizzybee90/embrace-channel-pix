import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { SLABadge } from '../sla/SLABadge';
import { Crown, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ConversationHeaderProps {
  conversation: Conversation;
  onUpdate: () => void;
  onBack?: () => void;
}

export const ConversationHeader = ({ conversation, onUpdate, onBack }: ConversationHeaderProps) => {
  const { toast } = useToast();
  
  const updateField = async (field: string, value: any) => {
    await supabase
      .from('conversations')
      .update({ [field]: value })
      .eq('id', conversation.id);
    onUpdate();
  };

  const handleAssignToMe = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('conversations')
      .update({ assigned_to: user.id })
      .eq('id', conversation.id);
    
    toast({
      title: "Conversation assigned",
      description: "This conversation has been assigned to you.",
    });
    
    onUpdate();
  };

  return (
    <div className="border-b border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {onBack && (
            <Button 
              variant="ghost" 
              size="icon"
              onClick={onBack}
              className="h-8 w-8"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
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

        <Button variant="outline" size="sm" onClick={handleAssignToMe}>
          Assign to Me
        </Button>
      </div>
    </div>
  );
};
