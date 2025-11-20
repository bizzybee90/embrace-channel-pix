import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ReplyAreaProps {
  conversationId: string;
  channel: string;
  aiDraftResponse?: string;
  onSend: (body: string, isInternal: boolean) => Promise<void>;
}

export const ReplyArea = ({ conversationId, channel, aiDraftResponse, onSend }: ReplyAreaProps) => {
  const [replyBody, setReplyBody] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [selectedChannel, setSelectedChannel] = useState(channel);
  const [sending, setSending] = useState(false);
  const [draftUsed, setDraftUsed] = useState(false);
  const { toast } = useToast();

  // Keyboard shortcuts for sending
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (replyBody.trim()) {
          handleSendReply();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [replyBody]);

  const handleUseDraft = () => {
    if (aiDraftResponse) {
      setReplyBody(aiDraftResponse);
      setDraftUsed(true);
    }
  };

  const handleSendReply = async () => {
    if (!replyBody.trim()) return;
    setSending(true);
    try {
      await onSend(replyBody, false);
      setReplyBody('');
      toast({ title: "Reply sent" });
    } catch (error) {
      toast({ title: "Failed to send", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleSendNote = async () => {
    if (!noteBody.trim()) return;
    setSending(true);
    await onSend(noteBody, true);
    setNoteBody('');
    setSending(false);
  };

  return (
    <div className="border-t border-border/30 p-3 md:p-4 bg-card/95 backdrop-blur-lg max-h-[350px] overflow-y-auto sticky bottom-0 z-10 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] md:rounded-none mobile-frosted">
      <Tabs defaultValue="reply">
        <div className="flex items-center gap-3 mb-3">
          <TabsList className="h-10 md:h-10 bg-muted/50 flex-shrink-0">
            <TabsTrigger value="reply" className="text-sm md:text-sm rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm transition-all duration-150">Reply to Customer</TabsTrigger>
            <TabsTrigger value="note" className="text-sm md:text-sm rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm transition-all duration-150">Internal Note</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="reply" className="space-y-2 md:space-y-3 mt-0">
          <div className="flex items-center gap-2">
            <Textarea
              placeholder="Type your reply to the customer..."
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              rows={3}
              className="resize-none border-border/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all text-sm md:text-base min-h-[80px] rounded-2xl md:rounded-md bg-background shadow-sm flex-1"
            />
            <Button 
              onClick={handleSendReply} 
              disabled={sending || !replyBody.trim()} 
              className="mobile-spring-bounce h-11 md:h-10 rounded-xl md:rounded-md font-medium shadow-sm flex-shrink-0"
              size="default"
            >
              <Send className="h-4 w-4 md:mr-2" />
              <span className="hidden md:inline">{sending ? 'Sending...' : 'Send Reply'}</span>
            </Button>
          </div>
          <span className="text-xs text-muted-foreground hidden md:block">Cmd/Ctrl + Enter to send</span>
        </TabsContent>


        <TabsContent value="note" className="space-y-2 md:space-y-3 mt-0">
          <div className="flex items-center gap-2">
            <Textarea
              placeholder="Add an internal note for your team..."
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              rows={3}
              className="resize-none border-border/60 focus:border-warning/50 focus:ring-2 focus:ring-warning/20 transition-all text-sm md:text-base min-h-[80px] rounded-2xl md:rounded-md bg-background shadow-sm flex-1"
            />
            <Button 
              onClick={handleSendNote} 
              disabled={sending || !noteBody.trim()} 
              variant="outline" 
              className="hover:bg-warning/10 hover:border-warning/50 transition-all h-11 md:h-10 rounded-xl md:rounded-md mobile-spring-bounce font-medium flex-shrink-0"
            >
              <span className="hidden md:inline">{sending ? 'Adding...' : 'Add Note'}</span>
              <span className="md:hidden">Note</span>
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
