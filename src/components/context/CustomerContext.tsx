import { Conversation, Customer } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Mail, Phone, MessageSquare, Crown, Clock, CheckCircle2, UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import { SnoozeDialog } from '@/components/conversations/SnoozeDialog';
import { CustomerTimeline } from '@/components/conversations/CustomerTimeline';

interface CustomerContextProps {
  conversation: Conversation;
  onUpdate: () => void;
}

export const CustomerContext = ({ conversation, onUpdate }: CustomerContextProps) => {
  const customer = conversation.customer;
  const { toast } = useToast();
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  // Fallback to metadata if customer record is incomplete
  const metadata = conversation.metadata as any || {};
  const customerName = customer?.name || metadata.customer_name || metadata.customer_identifier || 'Unknown';
  const customerEmail = customer?.email || metadata.customer_email;
  const customerPhone = customer?.phone || metadata.customer_phone;
  const customerTier = customer?.tier || 'regular';

  if (!customer && !metadata.customer_identifier) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground">No customer data available</p>
      </div>
    );
  }

  const getTierBadge = (tier: string) => {
    switch (tier) {
      case 'vip':
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30"><Crown className="h-3 w-3 mr-1" />VIP</Badge>;
      case 'at_risk':
        return <Badge variant="destructive">At Risk</Badge>;
      case 'trial':
        return <Badge variant="outline">Trial</Badge>;
      default:
        return <Badge variant="secondary">Regular</Badge>;
    }
  };

  return (
    <div className="space-y-4 md:p-4 md:space-y-4 mobile-section-spacing">
      <div className="mobile-native-card md:p-0 md:border-0 md:shadow-none md:rounded-none">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-2xl md:text-xl font-bold leading-tight truncate">{customerName}</h3>
          </div>
          <div className="flex-shrink-0">
            {getTierBadge(customerTier)}
          </div>
        </div>
      </div>

      <Separator className="md:block" />

      <div className="mobile-native-card md:p-0 md:border-0 md:shadow-none md:rounded-none space-y-3">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Contact Info</h4>
        
        {customerEmail && (
          <div className="flex items-center gap-3 text-sm mobile-touch-target min-w-0">
            <Mail className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="truncate">{customerEmail}</span>
          </div>
        )}
        
        {customerPhone && (
          <div className="flex items-center gap-3 text-sm mobile-touch-target">
            <Phone className="h-4 w-4 text-primary flex-shrink-0" />
            <span>{customerPhone}</span>
          </div>
        )}

        {customer?.preferred_channel && (
          <div className="flex items-center gap-3 text-sm mobile-touch-target">
            <MessageSquare className="h-4 w-4 text-primary flex-shrink-0" />
            <span>Prefers: {customer.preferred_channel}</span>
          </div>
        )}
      </div>

      <Separator className="md:block" />

      <div className="mobile-native-card md:p-0 md:border-0 md:shadow-none md:rounded-none space-y-3">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Activity Timeline</h4>
        {customer?.id && (
          <CustomerTimeline 
            customerId={customer.id} 
            currentConversationId={conversation.id}
          />
        )}
      </div>

      {customer?.notes && (
        <>
          <Separator className="md:block" />
          <div className="mobile-native-card md:p-0 md:border-0 md:shadow-none md:rounded-none space-y-2">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Notes</h4>
            <Card className="p-3 md:p-3 bg-muted/30 rounded-xl md:rounded-lg border-border/30">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{customer.notes}</p>
            </Card>
          </div>
        </>
      )}

      <Separator />

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase">Quick Actions</h4>
        <div className="grid gap-2">
          {conversation.status !== 'resolved' && (
            <Button 
              variant="default" 
              className="w-full justify-start bg-success hover:bg-success/90"
              onClick={async () => {
                await supabase
                  .from('conversations')
                  .update({ 
                    status: 'resolved',
                    resolved_at: new Date().toISOString()
                  })
                  .eq('id', conversation.id);
                toast({ title: "Conversation resolved" });
                onUpdate();
              }}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Resolve & Close
            </Button>
          )}

          <Button 
            variant="outline" 
            className="w-full justify-start"
            onClick={() => setSnoozeOpen(true)}
          >
            <Clock className="h-4 w-4 mr-2" />
            Snooze
          </Button>

          <Select
            value={conversation.priority}
            onValueChange={(value) => updatePriority(value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Change Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high">🔴 High Priority</SelectItem>
              <SelectItem value="medium">🟡 Medium Priority</SelectItem>
              <SelectItem value="low">🟢 Low Priority</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={conversation.status}
            onValueChange={(value) => updateStatus(value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Change Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="waiting_customer">Waiting Customer</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>

          {!conversation.assigned_to && (
            <Button 
              variant="outline" 
              className="w-full justify-start" 
              onClick={handleAssignToMe}
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Assign to Me
            </Button>
          )}
        </div>
      </div>

      <SnoozeDialog
        conversationId={conversation.id}
        open={snoozeOpen}
        onOpenChange={setSnoozeOpen}
        onSuccess={onUpdate}
      />
    </div>
  );

  async function updatePriority(priority: string) {
    await supabase
      .from('conversations')
      .update({ priority })
      .eq('id', conversation.id);
    onUpdate();
  }

  async function updateStatus(status: string) {
    await supabase
      .from('conversations')
      .update({ status })
      .eq('id', conversation.id);
    onUpdate();
  }

  async function handleAssignToMe() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('conversations')
      .update({ assigned_to: user.id })
      .eq('id', conversation.id);
    
    toast({
      title: "Conversation assigned",
      description: "This conversation has been assigned to you.",
    });
    
    onUpdate();
  }
};
