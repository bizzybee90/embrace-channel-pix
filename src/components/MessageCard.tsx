import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, Phone, Mail, MessageCircle, Globe, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface MessageCardProps {
  message: {
    id: string;
    channel: string;
    customer_name: string | null;
    customer_identifier: string;
    message_content: string;
    conversation_context: any;
    priority: string;
    status: string;
    escalated_at: string;
    n8n_workflow_id: string | null;
  };
  onRespond: (messageId: string) => void;
}

const channelIcons = {
  sms: MessageSquare,
  phone: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  webchat: Globe,
};

const channelColors = {
  sms: "bg-channel-sms",
  phone: "bg-channel-phone",
  email: "bg-channel-email",
  whatsapp: "bg-channel-whatsapp",
  webchat: "bg-channel-webchat",
};

const priorityColors = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-warning text-warning-foreground",
  high: "bg-urgent text-urgent-foreground",
};

const statusColors = {
  pending: "bg-warning text-warning-foreground",
  in_progress: "bg-primary text-primary-foreground",
  responded: "bg-success text-success-foreground",
  escalated: "bg-urgent text-urgent-foreground",
};

export const MessageCard = ({ message, onRespond }: MessageCardProps) => {
  const ChannelIcon = channelIcons[message.channel as keyof typeof channelIcons] || MessageSquare;
  const channelColor = channelColors[message.channel as keyof typeof channelColors] || "bg-primary";

  return (
    <Card className="transition-all hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`rounded-lg p-2 ${channelColor} text-white`}>
              <ChannelIcon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">
                {message.customer_name || "Unknown Customer"}
              </h3>
              <p className="text-sm text-muted-foreground">{message.customer_identifier}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant="outline" className={priorityColors[message.priority as keyof typeof priorityColors]}>
              {message.priority} priority
            </Badge>
            <Badge variant="outline" className={statusColors[message.status as keyof typeof statusColors]}>
              {message.status.replace('_', ' ')}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm text-foreground whitespace-pre-wrap">{message.message_content}</p>
        </div>
        
        {message.conversation_context && (
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
              View conversation history
            </summary>
            <div className="mt-2 space-y-2 rounded-lg bg-muted/50 p-3">
              {Array.isArray(message.conversation_context) ? (
                message.conversation_context.map((msg: any, idx: number) => (
                  <div key={idx} className="text-sm">
                    <span className="font-medium">{msg.role || 'User'}:</span> {msg.content || msg.message}
                  </div>
                ))
              ) : (
                <pre className="text-xs overflow-auto">{JSON.stringify(message.conversation_context, null, 2)}</pre>
              )}
            </div>
          </details>
        )}

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>{formatDistanceToNow(new Date(message.escalated_at), { addSuffix: true })}</span>
          </div>
          {message.status === 'pending' && (
            <Button onClick={() => onRespond(message.id)} size="sm">
              Respond
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};