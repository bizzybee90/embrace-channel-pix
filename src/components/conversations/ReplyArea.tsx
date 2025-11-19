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
    <div className="border-t border-border p-4 bg-card max-h-[350px] overflow-y-auto">
      <Tabs defaultValue="reply">
        <TabsList className="mb-3 w-full justify-center">
          <TabsTrigger value="reply">Reply to Customer</TabsTrigger>
          <TabsTrigger value="note">Internal Note</TabsTrigger>
        </TabsList>

        <TabsContent value="reply" className="space-y-3 mt-0">
          <Textarea
            placeholder="Type your reply to the customer... (Cmd/Ctrl+Enter to send)"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={4}
            className="resize-none"
          />
          <Button onClick={handleSendReply} disabled={sending || !replyBody.trim()} className="w-full">
            <Send className="h-4 w-4 mr-2" />
            {sending ? 'Sending...' : 'Send Reply'}
          </Button>
        </TabsContent>

        <TabsContent value="note" className="space-y-3 mt-0">
          <Textarea
            placeholder="Add an internal note for your team..."
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            rows={4}
            className="resize-none"
          />
          <Button onClick={handleSendNote} disabled={sending || !noteBody.trim()} variant="outline" className="w-full">
            {sending ? 'Adding...' : 'Add Note'}
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
};
