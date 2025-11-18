import { Message } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Bot, User, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessageTimelineProps {
  messages: Message[];
}

export const MessageTimeline = ({ messages }: MessageTimelineProps) => {
  return (
    <div className="space-y-4">
      {messages.map((message) => {
        const isCustomer = message.actor_type === 'customer';
        const isAI = message.actor_type === 'ai_agent';
        const isInternal = message.is_internal;
        const isHuman = message.actor_type === 'human_agent';

        if (isInternal) {
          return (
            <div key={message.id} className="w-full">
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <StickyNote className="h-4 w-4 text-yellow-600" />
                  <Badge variant="outline" className="text-xs">Internal Note</Badge>
                  <span className="text-xs text-muted-foreground">
                    {message.actor_name} • {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{message.body}</p>
              </div>
            </div>
          );
        }

        return (
          <div
            key={message.id}
            className={cn(
              'flex gap-2',
              (isCustomer || isAI) ? 'justify-start' : 'justify-end'
            )}
          >
            {(isCustomer || isAI) && (
              <div className="flex-shrink-0">
                {isAI ? (
                  <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-blue-600" />
                  </div>
                ) : (
                  <div className="h-8 w-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <User className="h-4 w-4 text-gray-600" />
                  </div>
                )}
              </div>
            )}

            <div
              className={cn(
                'max-w-[70%] rounded-lg p-3',
                isCustomer && 'bg-gray-100 dark:bg-gray-800',
                isAI && 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800',
                isHuman && 'bg-green-100 dark:bg-green-900/20'
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium">
                  {message.actor_name || (isCustomer ? 'Customer' : 'Agent')}
                </span>
                {isAI && <Badge variant="secondary" className="text-xs">AI</Badge>}
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{message.body}</p>
            </div>

            {isHuman && (
              <div className="flex-shrink-0">
                <div className="h-8 w-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <User className="h-4 w-4 text-green-600" />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
