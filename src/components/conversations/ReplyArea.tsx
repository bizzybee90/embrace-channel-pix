import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useIsTablet } from '@/hooks/use-tablet';
import { useIsMobile } from '@/hooks/use-mobile';

interface ReplyAreaProps {
  conversationId: string;
  channel: string;
  aiDraftResponse?: string;
  onSend: (body: string, isInternal: boolean) => Promise<void>;
  externalDraftText?: string;
  onDraftTextCleared?: () => void;
  onDraftChange?: (text: string) => void;
}

export const ReplyArea = ({ conversationId, channel, aiDraftResponse, onSend, externalDraftText, onDraftTextCleared, onDraftChange }: ReplyAreaProps) => {
  const [replyBody, setReplyBody] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [selectedChannel, setSelectedChannel] = useState(channel);
  const [sending, setSending] = useState(false);
  const [draftUsed, setDraftUsed] = useState(false);
  const { toast } = useToast();
  const isTablet = useIsTablet();
  const isMobile = useIsMobile();

  // Handle external draft text from AIContextPanel or saved drafts
  // Reset when conversation changes (conversationId changes)
  useEffect(() => {
    console.log('🔄 ReplyArea conversation changed:', { conversationId, externalDraftText });
    setReplyBody(externalDraftText || '');
    setDraftUsed(false);
  }, [conversationId]);  // ONLY conversationId, not externalDraftText

  // Update when external draft changes within same conversation (from AI draft button)
  useEffect(() => {
    console.log('📝 ReplyArea external draft updated:', { externalDraftText, currentReplyBody: replyBody });
    // Only update if it's different and not just from user typing
    if (externalDraftText && externalDraftText !== replyBody && !draftUsed) {
      setReplyBody(externalDraftText);
      setDraftUsed(true);
    }
  }, [externalDraftText]);

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
      setDraftUsed(false);
      onDraftTextCleared?.();
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

  // Use mobile styling for both mobile and tablet
  const useMobileStyle = isMobile || isTablet;

  return (
    <div className={
      useMobileStyle 
        ? "p-4 m-3 bg-card rounded-[22px] border border-border/30 shadow-lg backdrop-blur-sm"
        : "p-4 m-4 bg-card rounded-[22px] border border-border/30 shadow-lg backdrop-blur-sm"
    }>
      <Tabs defaultValue="reply">
        <TabsContent value="reply" className="mt-0">
          <div className="flex items-center gap-2">
            <TabsList className="h-10 bg-muted/50 flex-shrink-0 self-center">
              <TabsTrigger value="reply" className="text-sm rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm transition-all duration-150">Reply</TabsTrigger>
              <TabsTrigger value="note" className="text-sm rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm transition-all duration-150">Note</TabsTrigger>
            </TabsList>
            <Textarea
              placeholder="Type your reply..."
              value={replyBody}
              onChange={(e) => {
                console.log('⌨️ Textarea onChange:', { value: e.target.value, length: e.target.value.length });
                setReplyBody(e.target.value);
                onDraftChange?.(e.target.value);
              }}
              rows={2}
              className={
                useMobileStyle
                  ? "resize-none border-border/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all text-sm min-h-[56px] rounded-2xl bg-background shadow-sm flex-1"
                  : "resize-none border-border/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all text-base min-h-[56px] rounded-xl bg-background shadow-sm flex-1"
              }
            />
            <Button 
              onClick={handleSendReply} 
              disabled={sending || !replyBody.trim()} 
              className={
                useMobileStyle
                  ? "mobile-spring-bounce h-10 w-10 rounded-xl font-medium shadow-sm flex-shrink-0 self-center"
                  : "h-10 w-10 rounded-xl font-medium shadow-sm flex-shrink-0 self-center"
              }
              size="icon"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </TabsContent>


        <TabsContent value="note" className="mt-0">
          <div className="flex items-center gap-2">
            <TabsList className="h-10 bg-muted/50 flex-shrink-0 self-center">
              <TabsTrigger value="reply" className="text-sm rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm transition-all duration-150">Reply</TabsTrigger>
              <TabsTrigger value="note" className="text-sm rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm transition-all duration-150">Note</TabsTrigger>
            </TabsList>
            <Textarea
              placeholder="Add an internal note..."
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              rows={2}
              className={
                useMobileStyle
                  ? "resize-none border-border/60 focus:border-warning/50 focus:ring-2 focus:ring-warning/20 transition-all text-sm min-h-[56px] rounded-2xl bg-background shadow-sm flex-1"
                  : "resize-none border-border/60 focus:border-warning/50 focus:ring-2 focus:ring-warning/20 transition-all text-base min-h-[56px] rounded-xl bg-background shadow-sm flex-1"
              }
            />
            <Button 
              onClick={handleSendNote} 
              disabled={sending || !noteBody.trim()} 
              variant="outline" 
              className={
                useMobileStyle
                  ? "hover:bg-warning/10 hover:border-warning/50 transition-all h-10 w-10 rounded-xl mobile-spring-bounce font-medium flex-shrink-0 self-center"
                  : "hover:bg-warning/10 hover:border-warning/50 transition-all h-10 w-10 rounded-xl font-medium flex-shrink-0 self-center"
              }
              size="icon"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
