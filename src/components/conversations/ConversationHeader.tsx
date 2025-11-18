import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { SLABadge } from '../sla/SLABadge';
import { SLACountdown } from '../sla/SLACountdown';
import { Crown, ArrowLeft, CheckCircle2, TestTube } from 'lucide-react';
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

  const handleAddTestDraft = async () => {
    const testDraft = `Dear ${conversation.customer?.name || 'Customer'},

Thank you for reaching out to us. I understand your concern and I'd be happy to help you with this matter.

Based on our review, here's what I can do for you:

1. I'll process your request immediately
2. You should see the changes within 24-48 hours
3. I'll send you a confirmation email once it's complete

If you have any other questions or concerns, please don't hesitate to reach out. We're here to help!

Best regards,
Customer Support Team`;

    await supabase
      .from('conversations')
      .update({ 
        metadata: { 
          ...conversation.metadata,
          ai_draft_response: testDraft 
        }
      })
      .eq('id', conversation.id);
    
    toast({
      title: "Test AI draft added",
      description: "A sample AI draft response has been added to this conversation.",
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
            <Badge variant="secondary" className="bg-warning/20 text-warning-foreground">
              <Crown className="h-3 w-3 mr-1" />
              VIP
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <SLACountdown slaDueAt={conversation.sla_due_at} />
          <SLABadge
            slaStatus={conversation.sla_status}
            slaDueAt={conversation.sla_due_at}
            size="default"
          />
        </div>
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

        {!conversation.assigned_to && (
          <Button variant="outline" size="sm" onClick={handleAssignToMe}>
            Assign to Me
          </Button>
        )}

        {conversation.status !== 'resolved' && (
          <Button variant="default" size="sm" onClick={handleResolve} className="bg-success hover:bg-success/90">
            <CheckCircle2 className="h-4 w-4 mr-1" />
            Resolve & Close
          </Button>
        )}

        {!conversation.metadata?.ai_draft_response && (
          <Button variant="outline" size="sm" onClick={handleAddTestDraft}>
            <TestTube className="h-4 w-4 mr-1" />
            Add Test AI Draft
          </Button>
        )}
      </div>
    </div>
  );
};
