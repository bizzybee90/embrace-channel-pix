import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface ResponseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: {
    id: string;
    channel: string;
    customer_name: string | null;
    customer_identifier: string;
    message_content: string;
    metadata?: any;
  } | null;
  onSend: (messageId: string, response: string) => Promise<void>;
}

export const ResponseDialog = ({ open, onOpenChange, message, onSend }: ResponseDialogProps) => {
  const [response, setResponse] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!message || !response.trim()) return;

    setSending(true);
    try {
      await onSend(message.id, response);
      setResponse("");
      onOpenChange(false);
    } finally {
      setSending(false);
    }
  };

  if (!message) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Respond to {message.customer_name || "Customer"}</DialogTitle>
          <DialogDescription>
            Via {message.channel} - {message.customer_identifier}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Original Message</Label>
            <div className="mt-2 rounded-lg bg-muted p-3">
              <p className="text-sm whitespace-pre-wrap">{message.message_content}</p>
            </div>
          </div>

          {message.metadata?.ai_draft_response && (
            <div>
              <Label className="text-sm font-medium">AI Draft Response</Label>
              <div className="mt-2 rounded-lg bg-primary/5 border-l-4 border-primary p-3">
                <p className="text-sm whitespace-pre-wrap text-foreground/90">
                  {message.metadata.ai_draft_response}
                </p>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="response">Your Response</Label>
            <Textarea
              id="response"
              placeholder="Type your response here..."
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              className="mt-2 min-h-[150px]"
              disabled={sending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending || !response.trim()}>
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              "Send Response"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};