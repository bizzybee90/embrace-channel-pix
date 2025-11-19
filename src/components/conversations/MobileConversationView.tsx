import { Conversation, Message } from '@/lib/types';
import { MessageTimeline } from './MessageTimeline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SLABadge } from '@/components/sla/SLABadge';
import { Sparkles, User, Clock, AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface MobileConversationViewProps {
  conversation: Conversation;
  messages: Message[];
  onUpdate: () => void;
  onBack: () => void;
}

const getSentimentEmoji = (sentiment: string | null) => {
  if (!sentiment) return '😐';
  switch (sentiment.toLowerCase()) {
    case 'positive': return '😊';
    case 'negative': return '😟';
    case 'neutral': return '😐';
    default: return '😐';
  }
};

export const MobileConversationView = ({ 
  conversation, 
  messages, 
  onUpdate, 
  onBack 
}: MobileConversationViewProps) => {
  const handleStatusChange = async (newStatus: string) => {
    const { error } = await supabase
      .from('conversations')
      .update({ status: newStatus })
      .eq('id', conversation.id);

    if (error) {
      toast.error('Failed to update status');
    } else {
      toast.success('Status updated');
      onUpdate();
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    const { error } = await supabase
      .from('conversations')
      .update({ priority: newPriority })
      .eq('id', conversation.id);

    if (error) {
      toast.error('Failed to update priority');
    } else {
      toast.success('Priority updated');
      onUpdate();
    }
  };

  const handleResolve = async () => {
    const { error } = await supabase
      .from('conversations')
      .update({ 
        status: 'resolved',
        resolved_at: new Date().toISOString()
      })
      .eq('id', conversation.id);

    if (error) {
      toast.error('Failed to resolve conversation');
    } else {
      toast.success('Conversation resolved');
      onUpdate();
    }
  };

  const handleAssignToMe = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('conversations')
      .update({ assigned_to: user.id })
      .eq('id', conversation.id);

    if (error) {
      toast.error('Failed to assign');
    } else {
      toast.success('Assigned to you');
      onUpdate();
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Compact Header */}
      <div className="sticky top-0 z-10 bg-card border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onBack}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm truncate">{conversation.title}</h1>
          </div>
          <SLABadge
            conversation={conversation}
          />
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* AI Insights Card - Compact */}
        {conversation.ai_reason_for_escalation && (
          <Card className="m-4 mb-3">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">AI Insights</CardTitle>
                <Badge variant="outline" className="ml-auto text-xs">
                  {Math.round((conversation.ai_confidence || 0) * 100)}% confident
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Escalation Reason:</span>
                <p className="mt-1">{conversation.ai_reason_for_escalation}</p>
              </div>
              
              {conversation.summary_for_human && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">Summary:</span>
                  <p className="mt-1">{conversation.summary_for_human}</p>
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                <Badge variant="secondary" className="text-xs">
                  {getSentimentEmoji(conversation.ai_sentiment)} {conversation.ai_sentiment}
                </Badge>
                {conversation.category && (
                  <Badge variant="outline" className="text-xs">{conversation.category}</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions Grid */}
        <div className="px-4 pb-3">
          <div className="grid grid-cols-2 gap-2">
            <Select value={conversation.status || 'open'} onValueChange={handleStatusChange}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>

            <Select value={conversation.priority || 'medium'} onValueChange={handlePriorityChange}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>

            {!conversation.assigned_to && (
              <Button 
                size="sm" 
                variant="outline"
                onClick={handleAssignToMe}
                className="h-9 text-xs"
              >
                <User className="h-3 w-3 mr-1" />
                Assign to Me
              </Button>
            )}

            {conversation.status !== 'resolved' && (
              <Button 
                size="sm"
                onClick={handleResolve}
                className="h-9 text-xs"
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Resolve
              </Button>
            )}
          </div>
        </div>

        {/* Customer Info Card - Compact */}
        {conversation.customer_id && (
          <Card className="mx-4 mb-3">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">Customer</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {conversation.channel}
                  </Badge>
                  <span className="text-muted-foreground">
                    {conversation.created_at && formatDistanceToNow(new Date(conversation.created_at), { addSuffix: true })}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Messages */}
        <div className="px-4 pb-24">
          <MessageTimeline messages={messages} />
        </div>
      </div>
    </div>
  );
};
