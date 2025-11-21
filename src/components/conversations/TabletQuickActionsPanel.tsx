import { Conversation } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, Clock, UserPlus, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import { SnoozeDialog } from './SnoozeDialog';

interface TabletQuickActionsPanelProps {
  conversation: Conversation;
  onUpdate: () => void;
  isOpen: boolean;
}

export const TabletQuickActionsPanel = ({ conversation, onUpdate, isOpen }: TabletQuickActionsPanelProps) => {
  const { toast } = useToast();
  const [snoozeDialogOpen, setSnoozeDialogOpen] = useState(false);

  if (!isOpen) return null;

  const handleResolve = async () => {
    await supabase
      .from('conversations')
      .update({ 
        status: 'resolved',
        resolved_at: new Date().toISOString()
      })
      .eq('id', conversation.id);
    
    toast({ title: "Conversation resolved" });
    onUpdate();
  };

  const handleAssignToMe = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('conversations')
      .update({ assigned_to: user.id })
      .eq('id', conversation.id);
    
    toast({ title: "Assigned to you" });
    onUpdate();
  };

  const handlePriorityChange = async (priority: string) => {
    await supabase
      .from('conversations')
      .update({ priority })
      .eq('id', conversation.id);
    
    toast({ title: `Priority changed to ${priority}` });
    onUpdate();
  };

  return (
    <div className="animate-in slide-in-from-top-2 duration-200">
      <div className="mx-6 mb-4 rounded-2xl bg-gradient-to-br from-card to-card/50 border border-border/50 shadow-lg p-6 space-y-4">
        {/* Resolve Button */}
        <Button
          onClick={handleResolve}
          className="w-full h-12 bg-success hover:bg-success/90 text-success-foreground font-semibold rounded-xl shadow-sm"
          disabled={conversation.status === 'resolved'}
        >
          <CheckCircle2 className="h-5 w-5 mr-2" />
          {conversation.status === 'resolved' ? 'Resolved' : 'Resolve & Close'}
        </Button>

        {/* Priority Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">Priority</label>
          <Select value={conversation.priority || 'medium'} onValueChange={handlePriorityChange}>
            <SelectTrigger className="h-11 rounded-xl bg-muted/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  High Priority
                </span>
              </SelectItem>
              <SelectItem value="medium">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-warning" />
                  Medium Priority
                </span>
              </SelectItem>
              <SelectItem value="low">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                  Low Priority
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Snooze Button */}
        <Button
          onClick={() => setSnoozeDialogOpen(true)}
          variant="outline"
          className="w-full h-11 rounded-xl"
        >
          <Clock className="h-4 w-4 mr-2" />
          Snooze
        </Button>

        {/* Assign to Me */}
        <Button
          onClick={handleAssignToMe}
          variant="outline"
          className="w-full h-11 rounded-xl"
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Assign to Me
        </Button>
      </div>

      <SnoozeDialog
        conversationId={conversation.id}
        open={snoozeDialogOpen}
        onOpenChange={setSnoozeDialogOpen}
        onSuccess={onUpdate}
      />
    </div>
  );
};
