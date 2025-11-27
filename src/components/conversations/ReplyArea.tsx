import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Send, Paperclip, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useIsTablet } from '@/hooks/use-tablet';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';

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
  const [attachments, setAttachments] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();
  const isTablet = useIsTablet();
  const isMobile = useIsMobile();
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  const adjustTextareaHeight = (textarea: HTMLTextAreaElement | null) => {
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`;
    }
  };

  // Load saved draft when conversation changes
  useEffect(() => {
    const savedDraft = localStorage.getItem(`draft-${conversationId}`);
    console.log('📖 Loading draft for conversation:', { conversationId, savedDraft });
    setReplyBody(savedDraft || '');
    setDraftUsed(false);
  }, [conversationId]);

  // Handle AI-generated draft from "Use Draft" button
  useEffect(() => {
    console.log('📝 ReplyArea external draft updated:', { externalDraftText, currentReplyBody: replyBody });
    // Only update if it's different and not just from user typing
    if (externalDraftText && externalDraftText !== replyBody && !draftUsed) {
      setReplyBody(externalDraftText);
      setDraftUsed(true);
      setTimeout(() => adjustTextareaHeight(replyTextareaRef.current), 0);
    }
  }, [externalDraftText]);

  // Adjust textarea height when content changes
  useEffect(() => {
    adjustTextareaHeight(replyTextareaRef.current);
  }, [replyBody]);

  useEffect(() => {
    adjustTextareaHeight(noteTextareaRef.current);
  }, [noteBody]);

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter(file => {
      if (file.size > 20 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: `${file.name} exceeds 20MB limit`,
          variant: "destructive",
        });
        return false;
      }
      return true;
    });
    
    setAttachments(prev => [...prev, ...validFiles].slice(0, 10));
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const uploadAttachments = async () => {
    if (attachments.length === 0) return [];

    setUploading(true);
    const uploadedFiles = [];

    try {
      for (const file of attachments) {
        const fileName = `${conversationId}/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage
          .from('message-attachments')
          .upload(fileName, file);

        if (error) throw error;

        uploadedFiles.push({
          name: file.name,
          path: fileName,
          type: file.type,
          size: file.size
        });
      }
    } catch (error) {
      console.error('Error uploading attachments:', error);
      toast({
        title: "Upload failed",
        description: "Some attachments could not be uploaded",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }

    return uploadedFiles;
  };

  const handleSendReply = async () => {
    if (!replyBody.trim() && attachments.length === 0) {
      toast({
        title: "Error",
        description: "Please enter a message or attach a file",
        variant: "destructive",
      });
      return;
    }
    setSending(true);
    try {
      await uploadAttachments();
      await onSend(replyBody, false);
      setReplyBody('');
      setAttachments([]);
      setDraftUsed(false);
      localStorage.removeItem(`draft-${conversationId}`);
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
      <Tabs defaultValue="reply" orientation={isMobile ? "vertical" : "horizontal"}>
        <div className={isMobile ? "flex flex-col gap-2" : ""}>
          <TabsList className={isMobile ? "w-full h-auto grid grid-cols-2 bg-muted/50" : "h-10 bg-muted/50"}>
            <TabsTrigger value="reply" className="text-sm rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm transition-all duration-150">Reply</TabsTrigger>
            <TabsTrigger value="note" className="text-sm rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm transition-all duration-150">Note</TabsTrigger>
          </TabsList>

          <TabsContent value="reply" className="mt-0">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Textarea
                  ref={replyTextareaRef}
                  placeholder="Type your reply..."
                  value={replyBody}
                  onChange={(e) => {
                    console.log('⌨️ Textarea onChange:', { value: e.target.value, length: e.target.value.length });
                    const newValue = e.target.value;
                    setReplyBody(newValue);
                    
                    // Auto-save to localStorage
                    if (newValue.trim()) {
                      localStorage.setItem(`draft-${conversationId}`, newValue);
                      console.log('✅ Draft saved to localStorage');
                    } else {
                      localStorage.removeItem(`draft-${conversationId}`);
                      console.log('🗑️ Draft removed from localStorage');
                    }
                    
                    onDraftChange?.(newValue);
                  }}
                  className={
                    useMobileStyle
                      ? "resize-none border-border/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all text-sm min-h-[80px] max-h-[300px] rounded-2xl bg-background shadow-sm flex-1 overflow-y-auto"
                      : "resize-none border-border/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all text-base min-h-[56px] max-h-[300px] rounded-xl bg-background shadow-sm flex-1 overflow-y-auto"
                  }
                />
                <Button 
                  onClick={handleSendReply} 
                  disabled={sending || uploading || (!replyBody.trim() && attachments.length === 0)}
                  className={
                    useMobileStyle
                      ? "mobile-spring-bounce h-10 w-10 rounded-xl font-medium shadow-sm flex-shrink-0 self-end"
                      : "h-10 w-10 rounded-xl font-medium shadow-sm flex-shrink-0 self-center"
                  }
                  size="icon"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              
              {attachments.length > 0 && (
                <div className="space-y-1 px-1">
                  {attachments.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg px-3 py-2">
                      <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="flex-1 truncate">{file.name}</span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        ({Math.round(file.size / 1024)}KB)
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeAttachment(idx)}
                        className="h-6 w-6 p-0 flex-shrink-0"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || attachments.length >= 10}
                  className="text-xs text-muted-foreground"
                >
                  <Paperclip className="h-4 w-4 mr-1" />
                  Attach files
                </Button>
                <span className="text-xs text-muted-foreground">
                  {attachments.length > 0 && `${attachments.length}/10 files • `}
                  Press Ctrl+Enter to send
                </span>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="note" className="mt-0">
            <div className="flex items-center gap-2">
              <Textarea
                ref={noteTextareaRef}
                placeholder="Add an internal note..."
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                className={
                  useMobileStyle
                    ? "resize-none border-border/60 focus:border-warning/50 focus:ring-2 focus:ring-warning/20 transition-all text-sm min-h-[80px] max-h-[300px] rounded-2xl bg-background shadow-sm flex-1 overflow-y-auto"
                    : "resize-none border-border/60 focus:border-warning/50 focus:ring-2 focus:ring-warning/20 transition-all text-base min-h-[56px] max-h-[300px] rounded-xl bg-background shadow-sm flex-1 overflow-y-auto"
                }
              />
              <Button 
                onClick={handleSendNote} 
                disabled={sending || !noteBody.trim()} 
                variant="outline" 
                className={
                  useMobileStyle
                    ? "hover:bg-warning/10 hover:border-warning/50 transition-all h-10 w-10 rounded-xl mobile-spring-bounce font-medium flex-shrink-0 self-end"
                    : "hover:bg-warning/10 hover:border-warning/50 transition-all h-10 w-10 rounded-xl font-medium flex-shrink-0 self-center"
                }
                size="icon"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};
