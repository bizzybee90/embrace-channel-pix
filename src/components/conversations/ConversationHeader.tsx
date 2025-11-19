import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { SLABadge } from '../sla/SLABadge';
import { SLACountdown } from '../sla/SLACountdown';
import { Crown, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ChannelIcon } from '../shared/ChannelIcon';

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

  const handleResolve = async () => {
    await supabase
      .from('conversations')
      .update({ 
        status: 'resolved',
        resolved_at: new Date().toISOString()
      })
      .eq('id', conversation.id);
    
    toast({
      title: "Conversation resolved",
      description: "This conversation has been marked as resolved.",
    });
    
    onUpdate();
    onBack?.();
  };


  return (
    <div className="border-b border-border p-4 bg-card">
      {/* Top row: Customer name, VIP badge, and SLA */}
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
            <Badge variant="secondary" className="bg-warning/20 text-warning-foreground">
              <Crown className="h-3 w-3 mr-1" />
              VIP
            </Badge>
          )}
        </div>
        <SLABadge conversation={conversation} />
      </div>

      {/* Controls row: Channel, Priority, Status, Actions */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50">
          <ChannelIcon channel={conversation.channel} className="h-3.5 w-3.5" />
          <span className="text-xs font-medium capitalize">{conversation.channel}</span>
        </div>

        <Select
          value={conversation.priority}
          onValueChange={(value) => updateField('priority', value)}
        >
          <SelectTrigger className="w-[120px] h-8">
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
          <SelectTrigger className="w-[150px] h-8">
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

        {!conversation.assigned_to && (
          <Button variant="outline" size="sm" onClick={handleAssignToMe} className="h-8">
            Assign to Me
          </Button>
        )}

        {conversation.status !== 'resolved' && (
          <Button variant="default" size="sm" onClick={handleResolve} className="h-8 bg-success hover:bg-success/90">
            <CheckCircle2 className="h-4 w-4 mr-1" />
            Resolve & Close
          </Button>
        )}
      </div>
    </div>
  );
};
