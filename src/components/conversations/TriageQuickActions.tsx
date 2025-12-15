import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ArrowUp, RotateCcw } from 'lucide-react';
import { Conversation } from '@/lib/types';

interface TriageQuickActionsProps {
  conversation: Conversation;
  onUpdate?: () => void;
}

const CLASSIFICATIONS = [
  { value: 'customer_inquiry', label: 'Customer Inquiry', requiresReply: true },
  { value: 'automated_notification', label: 'Auto Notification', requiresReply: false },
  { value: 'spam_phishing', label: 'Spam/Phishing', requiresReply: false },
  { value: 'marketing_newsletter', label: 'Marketing', requiresReply: false },
  { value: 'recruitment_hr', label: 'Recruitment', requiresReply: false },
  { value: 'receipt_confirmation', label: 'Receipt', requiresReply: false },
  { value: 'internal_system', label: 'System', requiresReply: false },
];

export function TriageQuickActions({ conversation, onUpdate }: TriageQuickActionsProps) {
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);
  const currentClassification = (conversation as any).email_classification || '';

  const handleMoveToActionRequired = async () => {
    setIsUpdating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user?.id)
        .single();

      // Log the correction for learning
      const { error: correctionError } = await supabase
        .from('triage_corrections')
        .insert({
          workspace_id: userData?.workspace_id,
          conversation_id: conversation.id,
          original_classification: currentClassification,
          new_classification: 'customer_inquiry',
          original_requires_reply: false,
          new_requires_reply: true,
          sender_email: conversation.customer?.email || null,
          sender_domain: conversation.customer?.email?.split('@')[1] || null,
          corrected_by: user?.id,
        });

      if (correctionError) {
        console.error('Failed to log correction:', correctionError);
      }

      // Update the conversation
      const { error } = await supabase
        .from('conversations')
        .update({
          requires_reply: true,
          email_classification: 'customer_inquiry',
          status: 'open',
          resolved_at: null,
        })
        .eq('id', conversation.id);

      if (error) throw error;

      toast({ title: 'Moved to Action Required' });
      onUpdate?.();
    } catch (error) {
      console.error('Error moving conversation:', error);
      toast({ 
        title: 'Failed to move', 
        description: 'Please try again',
        variant: 'destructive' 
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleClassificationChange = async (newClassification: string) => {
    setIsUpdating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user?.id)
        .single();

      const classificationConfig = CLASSIFICATIONS.find(c => c.value === newClassification);
      const newRequiresReply = classificationConfig?.requiresReply ?? false;

      // Log the correction for learning
      const { error: correctionError } = await supabase
        .from('triage_corrections')
        .insert({
          workspace_id: userData?.workspace_id,
          conversation_id: conversation.id,
          original_classification: currentClassification,
          new_classification: newClassification,
          original_requires_reply: !(conversation as any).requires_reply,
          new_requires_reply: newRequiresReply,
          sender_email: conversation.customer?.email || null,
          sender_domain: conversation.customer?.email?.split('@')[1] || null,
          corrected_by: user?.id,
        });

      if (correctionError) {
        console.error('Failed to log correction:', correctionError);
      }

      // Update the conversation
      const updateData: any = {
        email_classification: newClassification,
        requires_reply: newRequiresReply,
      };

      // If now requires reply, reopen it
      if (newRequiresReply) {
        updateData.status = 'open';
        updateData.resolved_at = null;
      } else {
        updateData.status = 'resolved';
        updateData.resolved_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', conversation.id);

      if (error) throw error;

      toast({ 
        title: `Reclassified as ${classificationConfig?.label}`,
        description: newRequiresReply ? 'Moved to Action Required' : 'Kept in Triaged'
      });
      onUpdate?.();
    } catch (error) {
      console.error('Error updating classification:', error);
      toast({ 
        title: 'Failed to update', 
        description: 'Please try again',
        variant: 'destructive' 
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30">
      <Button
        variant="outline"
        size="sm"
        onClick={handleMoveToActionRequired}
        disabled={isUpdating}
        className="flex items-center gap-1.5 text-xs"
      >
        <ArrowUp className="h-3 w-3" />
        Action Required
      </Button>
      
      <Select
        value={currentClassification}
        onValueChange={handleClassificationChange}
        disabled={isUpdating}
      >
        <SelectTrigger className="h-8 text-xs w-[140px]">
          <RotateCcw className="h-3 w-3 mr-1.5" />
          <SelectValue placeholder="Reclassify..." />
        </SelectTrigger>
        <SelectContent>
          {CLASSIFICATIONS.map((classification) => (
            <SelectItem 
              key={classification.value} 
              value={classification.value}
              className="text-xs"
            >
              {classification.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
