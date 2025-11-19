import { Conversation } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { SLABadge } from '../sla/SLABadge';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ConversationHeaderProps {
  conversation: Conversation;
  onUpdate: () => void;
  onBack?: () => void;
}

const PriorityBadge = ({ priority }: { priority: string | null }) => {
  const variants: Record<string, { emoji: string; className: string }> = {
    high: { emoji: '🔴', className: 'bg-destructive/10 text-destructive border-destructive/20' },
    medium: { emoji: '🟡', className: 'bg-warning/10 text-warning-foreground border-warning/20' },
    low: { emoji: '🟢', className: 'bg-success/10 text-success-foreground border-success/20' },
  };

  const variant = variants[priority || 'medium'];
  
  return (
    <Badge variant="outline" className={`${variant.className} text-xs font-medium`}>
      {variant.emoji} {priority || 'medium'}
    </Badge>
  );
};

export const ConversationHeader = ({ conversation, onUpdate, onBack }: ConversationHeaderProps) => {
  const { toast } = useToast();

  const handleStatusChange = async (value: string) => {
    await supabase
      .from('conversations')
      .update({ status: value })
      .eq('id', conversation.id);
    onUpdate();
  };

  const handleAssignChange = async (value: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const assignedTo = value === 'me' ? user.id : null;
    
    await supabase
      .from('conversations')
      .update({ assigned_to: assignedTo })
      .eq('id', conversation.id);
    
    if (value === 'me') {
      toast({
        title: "Assigned to you",
        description: "This conversation is now yours.",
      });
    }
    
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

  return (
    <div className="border-b border-border/30 p-3 md:p-4 bg-card/95 backdrop-blur-lg shadow-sm sticky top-0 z-20">
      <div className="flex items-center justify-between gap-2 mb-2 md:mb-3">
        <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="md:hidden flex-shrink-0 h-9 w-9 mobile-spring-bounce rounded-xl"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-lg md:text-lg truncate leading-tight">{conversation.title}</h2>
          </div>
          
          <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
            <SLABadge conversation={conversation} />
            <PriorityBadge priority={conversation.priority} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={conversation.status || ''} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-32 md:w-36 h-9 md:h-9 text-xs md:text-sm rounded-lg md:rounded-md">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="rounded-xl md:rounded-md">
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>

        <Select value={conversation.assigned_to || ''} onValueChange={handleAssignChange}>
          <SelectTrigger className="w-32 md:w-36 h-9 md:h-9 text-xs md:text-sm rounded-lg md:rounded-md">
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent className="rounded-xl md:rounded-md">
            <SelectItem value="unassigned">Unassigned</SelectItem>
            <SelectItem value="me">Assign to Me</SelectItem>
          </SelectContent>
        </Select>

        {conversation.status !== 'resolved' && (
          <Button
            onClick={handleResolve}
            size="sm"
            className="bg-success hover:bg-success/90 h-9 md:h-9 text-xs md:text-sm px-3 md:px-4 rounded-lg md:rounded-md mobile-spring-bounce font-medium"
          >
            <CheckCircle2 className="h-4 w-4 md:h-4 md:w-4 mr-1 md:mr-2" />
            <span className="hidden md:inline">Resolve</span>
            <span className="md:hidden">✓</span>
          </Button>
        )}
      </div>
    </div>
  );
};