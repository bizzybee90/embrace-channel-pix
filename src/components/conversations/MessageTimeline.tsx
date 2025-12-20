import { Message } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Bot, StickyNote, Paperclip, ChevronDown, ChevronUp, MessageCircle, Eye, EyeOff } from 'lucide-react';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cleanEmailContent, hasSignificantCleaning } from '@/utils/emailParser';

const getInitials = (name: string | null) => {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

interface MessageTimelineProps {
  messages: Message[];
  defaultCollapsed?: boolean;
}

const COLLAPSED_MESSAGE_COUNT = 3;

export const MessageTimeline = ({ messages, defaultCollapsed = true }: MessageTimelineProps) => {
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);
  const [showOriginalIds, setShowOriginalIds] = useState<Set<string>>(new Set());

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

  const renderMessage = (message: Message) => {
    const isCustomer = message.actor_type === 'customer';
    const isAI = message.actor_type === 'ai_agent';
    const isInternal = message.is_internal;
    const isHuman = message.actor_type === 'human_agent';
    const isEmail = message.channel === 'email';
    
    // Clean email content if it's an email message
    const cleanedBody = isEmail ? cleanEmailContent(message.body) : message.body;
    const showOriginal = showOriginalIds.has(message.id);
    const displayBody = showOriginal ? message.body : cleanedBody;
    const canShowOriginal = isEmail && hasSignificantCleaning(message.body, cleanedBody);

    if (isInternal) {
      return (
        <div key={message.id} className="w-full animate-fade-in">
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3.5 card-elevation">
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

    return (
      <div
        key={message.id}
        className={cn(
          'flex gap-3 animate-fade-in',
          (isCustomer || isAI) ? 'justify-start' : 'justify-end'
        )}
      >
        {(isCustomer || isAI) && (
          <div className="flex-shrink-0">
            {isAI ? (
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </AvatarFallback>
              </Avatar>
            ) : (
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-muted text-xs font-medium">
                  {getInitials(message.actor_name)}
                </AvatarFallback>
              </Avatar>
            )}
          </div>
        )}

        <div
          className={cn(
            'max-w-[70%] rounded-lg p-3.5 card-elevation transition-all hover:shadow-md',
            isCustomer && 'bg-muted',
            isAI && 'bg-primary/10 border border-primary/20',
            isHuman && 'bg-success/10 border border-success/20'
          )}
        >
          <div className="flex items-center gap-2 mb-2">
            <ChannelIcon channel={message.channel} />
            <span className="text-xs font-medium">
              {message.actor_name || (isCustomer ? 'Customer' : 'Agent')}
            </span>
            {isAI && <Badge variant="secondary" className="text-xs bg-primary/20">AI</Badge>}
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
            </span>
          </div>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{displayBody}</p>
          
          {/* Show original toggle for email messages with significant cleaning */}
          {canShowOriginal && (
            <button
              onClick={() => toggleShowOriginal(message.id)}
              className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showOriginal ? (
                <>
                  <EyeOff className="h-3 w-3" />
                  Show cleaned
                </>
              ) : (
                <>
                  <Eye className="h-3 w-3" />
                  Show original
                </>
              )}
            </button>
          )}
          
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

        {isHuman && (
          <div className="flex-shrink-0">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-success/10 text-xs font-medium text-success">
                {getInitials(message.actor_name)}
              </AvatarFallback>
            </Avatar>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header with expand/collapse toggle */}
      <div className="flex items-center justify-between px-4 pt-2">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">
            Conversation ({messages.length} message{messages.length !== 1 ? 's' : ''})
          </span>
        </div>
        {hasMoreMessages && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 text-xs gap-1.5"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                Show all ({hiddenCount} more)
              </>
            )}
          </Button>
        )}
      </div>

      {/* Collapsed indicator */}
      {!isExpanded && hasMoreMessages && (
        <div className="px-4">
          <div className="text-center py-2 text-xs text-muted-foreground bg-muted/30 rounded-lg border border-dashed border-border">
            {hiddenCount} earlier message{hiddenCount !== 1 ? 's' : ''} hidden
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="message-spacing py-2 px-4 space-y-4">
        {displayedMessages.map(renderMessage)}
      </div>
    </div>
  );
};