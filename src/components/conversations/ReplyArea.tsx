import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Send } from 'lucide-react';

interface ReplyAreaProps {
  conversationId: string;
  channel: string;
  onSend: (body: string, isInternal: boolean) => Promise<void>;
}

export const ReplyArea = ({ conversationId, channel, onSend }: ReplyAreaProps) => {
  const [replyBody, setReplyBody] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [selectedChannel, setSelectedChannel] = useState(channel);
  const [sending, setSending] = useState(false);

  const handleSendReply = async () => {
    if (!replyBody.trim()) return;
    setSending(true);
    await onSend(replyBody, false);
    setReplyBody('');
    setSending(false);
  };

  const handleSendNote = async () => {
    if (!noteBody.trim()) return;
    setSending(true);
    await onSend(noteBody, true);
    setNoteBody('');
    setSending(false);
  };

  return (
    <div className="border-t border-border p-4 bg-card">
      <Tabs defaultValue="reply">
        <TabsList className="mb-3">
          <TabsTrigger value="reply">Reply to Customer</TabsTrigger>
          <TabsTrigger value="note">Add Internal Note</TabsTrigger>
        </TabsList>

        <TabsContent value="reply" className="space-y-2 mt-0">
          <div className="flex items-center gap-2">
            <Select value={selectedChannel} onValueChange={setSelectedChannel}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sms">📱 SMS</SelectItem>
                <SelectItem value="whatsapp">🟢 WhatsApp</SelectItem>
                <SelectItem value="email">📧 Email</SelectItem>
                <SelectItem value="web_chat">💬 Web Chat</SelectItem>
              </SelectContent>
            </Select>
            {selectedChannel === 'sms' && (
              <span className="text-xs text-muted-foreground">
                {replyBody.length}/160
              </span>
            )}
          </div>
          <Textarea
            placeholder="Type your reply to the customer..."
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={4}
            className="resize-none"
          />
          <Button onClick={handleSendReply} disabled={sending || !replyBody.trim()} className="w-full">
            <Send className="h-4 w-4 mr-2" />
            Send Reply
          </Button>
        </TabsContent>

        <TabsContent value="note" className="space-y-2 mt-0">
          <Textarea
            placeholder="Add an internal note for your team..."
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            rows={4}
            className="resize-none"
          />
          <Button onClick={handleSendNote} disabled={sending || !noteBody.trim()} variant="outline" className="w-full">
            Add Note
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
};
