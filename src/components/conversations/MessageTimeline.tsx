import { Message } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Bot, StickyNote, Paperclip, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useState } from 'react';
import DOMPurify from 'dompurify';
import { Button } from '@/components/ui/button';
import { cleanEmailContent, hasSignificantCleaning } from '@/utils/emailParser';
import { EmailThread } from './EmailThread';
import { HtmlEmailViewer } from './HtmlEmailViewer';
import { ImageAnalysis } from './ImageAnalysis';
import { VoicemailPlayer } from './VoicemailPlayer';

const stripHtmlTags = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent || '';
};

const getInitials = (name: string | null) => {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

interface MessageTimelineProps {
  messages: Message[];
  defaultCollapsed?: boolean;
  workspaceId?: string;
  onDraftTextChange?: (text: string) => void;
  conversationCustomerName?: string | null;
}

const COLLAPSED_MESSAGE_COUNT = 3;

export const MessageTimeline = ({ 
  messages, 
  defaultCollapsed = true,
  workspaceId,
  onDraftTextChange,
  conversationCustomerName
}: MessageTimelineProps) => {
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);
  const [showOriginalIds, setShowOriginalIds] = useState<Set<string>>(new Set());
  const [htmlViewerMessage, setHtmlViewerMessage] = useState<Message | null>(null);

  const toggleShowOriginal = (messageId: string) => {
    setShowOriginalIds(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const handleDownloadAttachment = async (path: string, name: string) => {
    try {
      setDownloadingFile(path);
      const { data, error } = await supabase.storage
        .from('message-attachments')
        .download(path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading file:', error);
    } finally {
      setDownloadingFile(null);
    }
  };

  if (!messages || messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground p-4">
        No messages yet
      </div>
    );
  }

  const hasMoreMessages = messages.length > COLLAPSED_MESSAGE_COUNT;
  const displayedMessages = isExpanded ? messages : messages.slice(-COLLAPSED_MESSAGE_COUNT);
  const hiddenCount = messages.length - COLLAPSED_MESSAGE_COUNT;

  const renderMessage = (message: Message, isNewest = false) => {
    const isCustomer = message.actor_type === 'customer';
    const isAI = message.actor_type === 'ai_agent';
    const isInternal = message.is_internal;
    const isHuman = message.actor_type === 'human_agent';
    const isEmail = message.channel === 'email';
    
    // Graceful sender name fallback
    const rawFrom = message.raw_payload?.from;
    const rawFromName = rawFrom?.name && rawFrom.name !== 'Unknown' ? rawFrom.name : null;
    const rawFromAddress = rawFrom?.address && !rawFrom.address.includes('unknown.invalid') ? rawFrom.address : null;
    const actorName = message.actor_name && !message.actor_name.includes('unknown.invalid') && !message.actor_name.startsWith('unknown@') && message.actor_name !== 'Unknown Sender'
      ? message.actor_name
      : (rawFromName || (isCustomer ? (conversationCustomerName || rawFromAddress || 'Unknown Sender') : 'Agent'));
    
    // Derive display body — fallback to raw_payload when body is empty
    const rawBody = message.body;
    let effectiveBody = rawBody;
    if (!rawBody && message.raw_payload) {
      effectiveBody = message.raw_payload.bodySnippet 
        || (typeof message.raw_payload.body === 'string' ? stripHtmlTags(message.raw_payload.body) : '') 
        || '';
    }
    
    // Clean email content if it's an email message
    const cleanedBody = isEmail ? cleanEmailContent(effectiveBody) : effectiveBody;
    const showOriginal = showOriginalIds.has(message.id);
    const displayBody = showOriginal ? effectiveBody : cleanedBody;
    const canShowOriginal = isEmail && hasSignificantCleaning(effectiveBody, cleanedBody);

    if (isInternal) {
      return (
        <div key={message.id} className="w-full animate-fade-in">
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <StickyNote className="h-4 w-4 text-warning" />
              <Badge variant="outline" className="text-xs bg-warning/20 border-warning">Internal Note</Badge>
              <ChannelIcon channel={message.channel} className="h-3 w-3" />
              <span className="text-xs text-muted-foreground">
                {message.actor_name} • {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.body}</p>
            
            {message.attachments && Array.isArray(message.attachments) && message.attachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {message.attachments.map((attachment: any, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => handleDownloadAttachment(attachment.path, attachment.name)}
                    disabled={downloadingFile === attachment.path}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    {downloadingFile === attachment.path ? (
                      <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                    ) : (
                      <Paperclip className="h-4 w-4" />
                    )}
                    <span className="truncate">{attachment.name}</span>
                    <span className="text-xs">({Math.round((attachment.size || 0) / 1024)}KB)</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    // For outbound (agent/AI) messages, keep the bubble style
    if (isHuman || isAI) {
      return (
        <div
          key={message.id}
          className={cn(
            'flex gap-3 animate-fade-in',
            'justify-end'
          )}
        >
          <div
            className={cn(
              'max-w-[85%] rounded-xl p-4 transition-all',
              isAI && 'bg-primary/5',
              isHuman && 'bg-accent/50'
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <ChannelIcon channel={message.channel} />
              <span className="text-xs font-medium">{actorName}</span>
              {isAI && <Badge variant="secondary" className="text-xs bg-primary/20">AI</Badge>}
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{displayBody}</p>
          </div>
          <div className="flex-shrink-0">
            <Avatar className="h-8 w-8">
              <AvatarFallback className={cn(
                "text-xs font-medium",
                isAI ? "bg-primary/10" : "bg-accent text-accent-foreground"
              )}>
                {isAI ? <Bot className="h-4 w-4 text-primary" /> : getInitials(message.actor_name)}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
      );
    }

    // Check for raw HTML body
    const rawHtmlBody = message.raw_payload?.body;
    const hasHtmlBody = isEmail && typeof rawHtmlBody === 'string' && rawHtmlBody.includes('<');

    // Customer / inbound messages — naked email canvas style
    return (
      <div key={message.id} className="animate-fade-in">
        {/* Naked email content — render HTML faithfully */}
        {hasHtmlBody && !showOriginal ? (
          <div
            className="prose prose-sm md:prose-base max-w-none text-foreground leading-relaxed [&_a]:text-blue-600 hover:[&_a]:text-blue-800 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-2 [&_img]:max-w-full [&_img]:h-auto break-words"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(rawHtmlBody, {
              ALLOWED_TAGS: ['table', 'tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'caption', 'colgroup', 'col', 'div', 'span', 'img', 'a', 'b', 'i', 'strong', 'em', 'br', 'p', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'font', 'center', 'u', 's', 'strike', 'sub', 'sup', 'small', 'big', 'style'],
              ALLOWED_ATTR: ['style', 'class', 'href', 'src', 'alt', 'title', 'width', 'height', 'cellpadding', 'cellspacing', 'border', 'align', 'valign', 'bgcolor', 'color', 'face', 'size', 'target', 'rel', 'colspan', 'rowspan'],
              ALLOW_DATA_ATTR: false,
              FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea'],
              FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
            }) }}
          />
        ) : (
          <div className="prose prose-sm max-w-none text-foreground leading-relaxed">
            {isEmail && !showOriginal ? (
              <EmailThread body={displayBody || ''} />
            ) : (
              <p className="text-sm whitespace-pre-wrap leading-relaxed m-0">{displayBody}</p>
            )}
          </div>
        )}
        
        {/* Show original toggle */}
        {canShowOriginal && (
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => toggleShowOriginal(message.id)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showOriginal ? (
                <>
                  <EyeOff className="h-3 w-3" />
                  Show threaded
                </>
              ) : (
                <>
                  <Eye className="h-3 w-3" />
                  Show original
                </>
              )}
            </button>
          </div>
        )}
        
        {message.attachments && Array.isArray(message.attachments) && message.attachments.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.attachments.map((attachment: any, idx: number) => {
              const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(attachment.name || '');
              const isAudio = /\.(mp3|wav|m4a|ogg|webm)$/i.test(attachment.name || '');
              
              const { data: urlData } = supabase.storage
                .from('message-attachments')
                .getPublicUrl(attachment.path);
              const attachmentUrl = urlData?.publicUrl || '';

              if (isImage && workspaceId && attachmentUrl) {
                return (
                  <ImageAnalysis
                    key={idx}
                    workspaceId={workspaceId}
                    messageId={message.id}
                    imageUrl={attachmentUrl}
                    customerMessage={message.body}
                    onSuggestedResponse={onDraftTextChange}
                  />
                );
              }

              if (isAudio && workspaceId && attachmentUrl) {
                return (
                  <VoicemailPlayer
                    key={idx}
                    workspaceId={workspaceId}
                    messageId={message.id}
                    audioUrl={attachmentUrl}
                    customerName={message.actor_name || undefined}
                    onSuggestedResponse={onDraftTextChange}
                  />
                );
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleDownloadAttachment(attachment.path, attachment.name)}
                  disabled={downloadingFile === attachment.path}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {downloadingFile === attachment.path ? (
                    <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                  <span className="truncate">{attachment.name}</span>
                  <span className="text-xs">({Math.round((attachment.size || 0) / 1024)}KB)</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* HTML Email Viewer Modal */}
      {htmlViewerMessage && (
        <HtmlEmailViewer
          htmlContent={htmlViewerMessage.raw_payload?.body || ''}
          open={!!htmlViewerMessage}
          onOpenChange={(open) => !open && setHtmlViewerMessage(null)}
        />
      )}
      
      {/* Collapsed messages indicator */}
      {hasMoreMessages && (
        <div className="px-4 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                {hiddenCount} earlier message{hiddenCount !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </div>
      )}

      {/* Messages — clean layout */}
      <div className="py-2 px-4">
        <div className="space-y-6">
          {displayedMessages.map((message, index) => {
            const isNewest = index === displayedMessages.length - 1;
            return (
              <div key={message.id}>
                {renderMessage(message, isNewest)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
