import { Conversation } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, FileText, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface AIContextPanelProps {
  conversation: Conversation;
  onUpdate?: () => void;
}

export const AIContextPanel = ({ conversation, onUpdate }: AIContextPanelProps) => {
  const [draftUsed, setDraftUsed] = useState(false);

  const aiDraftResponse = conversation.metadata?.ai_draft_response as string | undefined;

  const handleUseDraft = async () => {
    if (!aiDraftResponse) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userData } = await supabase
        .from('users')
        .select('name')
        .eq('id', user.id)
        .single();

      await supabase.from('messages').insert({
        conversation_id: conversation.id,
        actor_type: 'human_agent',
        actor_id: user.id,
        actor_name: userData?.name || 'Agent',
        direction: 'outbound',
        channel: conversation.channel,
        body: aiDraftResponse,
        is_internal: false
      });

      setDraftUsed(true);
      toast.success('AI draft used successfully');
      onUpdate?.();
    } catch (error) {
      console.error('Error using AI draft:', error);
      toast.error('Failed to use AI draft');
    }
  };

  const getSentimentEmoji = (sentiment: string | null) => {
    switch (sentiment) {
      case 'positive': return '😊';
      case 'negative': return '😟';
      case 'neutral': return '😐';
      default: return '❓';
    }
  };

  return (
    <div className="space-y-4 md:space-y-4 mobile-section-spacing">
      {/* Why AI Escalated */}
      <Card className="card-elevation bg-destructive/5 border-destructive/20 mobile-native-card">
        <div className="p-3 md:p-4">
          <div className="flex items-start gap-2 mb-1">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-sm md:text-sm">Why AI Escalated</h3>
              <p className="text-sm mt-1 text-muted-foreground leading-relaxed">
                {conversation.ai_reason_for_escalation || 'No escalation reason provided'}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* AI Summary */}
      <Card className="card-elevation mobile-native-card bg-primary/5 border-primary/20">
        <div className="p-3 md:p-4">
          <div className="flex items-start gap-2 mb-1">
            <FileText className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-sm md:text-sm">Summary</h3>
              <p className="text-sm mt-2 text-foreground/80 leading-relaxed">
                {conversation.summary_for_human || 'No summary available'}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* AI Draft Response */}
      {aiDraftResponse && (
        <Card className="card-elevation mobile-native-card bg-gradient-to-br from-primary/5 to-primary/10 border-primary/30">
          <div className="p-3 md:p-4">
            <div className="flex items-start gap-2 mb-3">
              <Sparkles className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold text-sm md:text-sm">AI Suggested Reply</h3>
              </div>
            </div>
            
            <div className="bg-card rounded-xl md:rounded-lg p-3 md:p-3 mb-3 border border-border/50 shadow-sm">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{aiDraftResponse}</p>
            </div>

            <Button
              onClick={handleUseDraft}
              disabled={draftUsed}
              variant="outline"
              size="sm"
              className="w-full smooth-transition mobile-spring-bounce rounded-xl md:rounded-md h-10 font-medium"
            >
              {draftUsed ? 'Draft Used' : 'Use This Draft'}
            </Button>
          </div>
        </Card>
      )}

      {/* Metadata */}
      <div className="grid grid-cols-3 gap-2 md:gap-2">
        <Card className="p-3 md:p-3 text-center card-elevation mobile-native-card mobile-spring-bounce">
          <div className="text-2xl md:text-2xl font-bold text-primary">{Math.round((conversation.ai_confidence || 0) * 100)}%</div>
          <div className="text-xs text-muted-foreground mt-1">Confidence</div>
        </Card>
        
        <Card className="p-3 md:p-3 text-center card-elevation mobile-native-card mobile-spring-bounce">
          <div className="text-2xl md:text-2xl">{getSentimentEmoji(conversation.ai_sentiment)}</div>
          <div className="text-xs text-muted-foreground mt-1 capitalize">{conversation.ai_sentiment || 'Unknown'}</div>
        </Card>
        
        <Card className="p-3 md:p-3 text-center card-elevation mobile-native-card mobile-spring-bounce">
          <div className="text-2xl md:text-2xl">📂</div>
          <div className="text-xs text-muted-foreground mt-1 capitalize">{conversation.category || 'General'}</div>
        </Card>
      </div>
    </div>
  );
};