import { Conversation } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, Clock, UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import { SnoozeDialog } from './SnoozeDialog';

interface QuickActionsProps {
  conversation: Conversation;
  onUpdate: () => void;
  onBack?: () => void;
}

export const QuickActions = ({ conversation, onUpdate, onBack }: QuickActionsProps) => {
  const { toast } = useToast();
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const handleAssignToMe = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('conversations')
      .update({ assigned_to: user.id })
      .eq('id', conversation.id);
    
    toast({
      title: "Assigned to you",
      description: "This conversation is now yours.",
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
      title: "Resolved",
      description: "Conversation marked as resolved.",
    });
    
    onUpdate();
    onBack?.();
  };

  const handlePriorityChange = async (value: string) => {
    await supabase
      .from('conversations')
      .update({ priority: value })
      .eq('id', conversation.id);
    onUpdate();
  };

  const handleStatusChange = async (value: string) => {
    await supabase
      .from('conversations')
      .update({ status: value })
      .eq('id', conversation.id);
    onUpdate();
  };

  return (
    <>
      <div className="space-y-3 mobile-section-spacing">
        {conversation.status !== 'resolved' && (
          <Button 
            onClick={handleResolve}
            className="w-full justify-center bg-success hover:bg-success/90 smooth-transition mobile-spring-bounce h-12 md:h-10 rounded-xl md:rounded-md font-semibold text-base md:text-sm shadow-sm"
            size="lg"
          >
            <CheckCircle2 className="h-5 w-5 mr-2" />
            Resolve & Close
          </Button>
        )}

        <div className="mobile-native-card md:p-4 md:border md:shadow-sm space-y-2">
          <Button 
            onClick={() => setSnoozeOpen(true)}
            variant="outline"
            className="w-full justify-start smooth-transition mobile-spring-bounce h-11 md:h-9 rounded-xl md:rounded-md"
            size="default"
          >
            <Clock className="h-4 w-4 mr-2" />
            Snooze
          </Button>

          {!conversation.assigned_to && (
            <Button 
              onClick={handleAssignToMe}
              variant="outline"
              className="w-full justify-start smooth-transition mobile-spring-bounce h-11 md:h-9 rounded-xl md:rounded-md"
              size="default"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Assign to Me
            </Button>
          )}

          <Select value={conversation.priority} onValueChange={handlePriorityChange}>
            <SelectTrigger className="w-full h-11 md:h-10 rounded-xl md:rounded-md">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent className="rounded-xl md:rounded-md">
              <SelectItem value="high">🔴 High</SelectItem>
              <SelectItem value="medium">🟡 Medium</SelectItem>
              <SelectItem value="low">🟢 Low</SelectItem>
            </SelectContent>
          </Select>

          <Select value={conversation.status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-full h-11 md:h-10 rounded-xl md:rounded-md">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="rounded-xl md:rounded-md">
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <SnoozeDialog
        conversationId={conversation.id}
        open={snoozeOpen}
        onOpenChange={setSnoozeOpen}
        onSuccess={onUpdate}
      />
    </>
  );
};