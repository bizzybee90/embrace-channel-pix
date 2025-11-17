import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { MessageCard } from "@/components/MessageCard";
import { ResponseDialog } from "@/components/ResponseDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LogOut, Filter, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

type Message = {
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

const Dashboard = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");

  const fetchMessages = async () => {
    try {
      let query = supabase
        .from("escalated_messages")
        .select("*")
        .order("escalated_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as "pending" | "in_progress" | "responded" | "escalated");
      }
      if (channelFilter !== "all") {
        query = query.eq("channel", channelFilter as "sms" | "whatsapp" | "email" | "phone" | "webchat");
      }

      const { data, error } = await query;

      if (error) throw error;
      setMessages(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading messages",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();

    // Set up realtime subscription
    const channel = supabase
      .channel("escalated_messages_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "escalated_messages",
        },
        () => {
          fetchMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [statusFilter, channelFilter]);

  const handleRespond = (messageId: string) => {
    const message = messages.find((m) => m.id === messageId);
    if (message) {
      setSelectedMessage(message);
      setDialogOpen(true);
    }
  };

  const handleSendResponse = async (messageId: string, responseContent: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Create response record
      const { error: responseError } = await supabase
        .from("message_responses")
        .insert({
          message_id: messageId,
          agent_id: user?.id,
          response_content: responseContent,
          sent_to_n8n: false,
        });

      if (responseError) throw responseError;

      // Update message status
      const { error: updateError } = await supabase
        .from("escalated_messages")
        .update({
          status: "responded",
          responded_at: new Date().toISOString(),
        })
        .eq("id", messageId);

      if (updateError) throw updateError;

      // Call edge function to send to N8n
      const { error: functionError } = await supabase.functions.invoke("send-to-n8n", {
        body: {
          messageId,
          response: responseContent,
        },
      });

      if (functionError) {
        console.error("Error sending to N8n:", functionError);
        toast({
          title: "Response saved",
          description: "Response saved but there was an issue sending to N8n. Please check the webhook configuration.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Response sent!",
          description: "Your response has been sent successfully via N8n.",
        });
      }

      fetchMessages();
    } catch (error: any) {
      toast({
        title: "Error sending response",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const pendingCount = messages.filter((m) => m.status === "pending").length;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card shadow-sm">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Escalation Dashboard</h1>
            <p className="text-sm text-muted-foreground">Real-time customer service escalations</p>
          </div>
          <div className="flex items-center gap-4">
            {pendingCount > 0 && (
              <Badge variant="default" className="bg-urgent text-urgent-foreground">
                {pendingCount} pending
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={fetchMessages}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters:</span>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="responded">Responded</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Channels</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="phone">Phone</SelectItem>
              <SelectItem value="webchat">Web Chat</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-muted py-12 text-center">
            <p className="text-muted-foreground">No escalated messages at the moment</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {messages.map((message) => (
              <MessageCard key={message.id} message={message} onRespond={handleRespond} />
            ))}
          </div>
        )}
      </main>

      <ResponseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        message={selectedMessage}
        onSend={handleSendResponse}
      />
    </div>
  );
};

export default Dashboard;