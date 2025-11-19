import { Message } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Bot, User, StickyNote } from 'lucide-react';
import { ChannelIcon } from '@/components/shared/ChannelIcon';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

const getInitials = (name: string | null) => {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

interface MessageTimelineProps {
  messages: Message[];
}

export const MessageTimeline = ({ messages }: MessageTimelineProps) => {
  return (
    <div className="message-spacing py-2">
      {messages.map((message) => {
        const isCustomer = message.actor_type === 'customer';
        const isAI = message.actor_type === 'ai_agent';
        const isInternal = message.is_internal;
        const isHuman = message.actor_type === 'human_agent';

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
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.body}</p>
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
      })}
    </div>
  );
};
