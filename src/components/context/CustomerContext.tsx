import { Conversation, Customer } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Mail, Phone, MessageSquare, Crown } from 'lucide-react';

interface CustomerContextProps {
  conversation: Conversation;
}

export const CustomerContext = ({ conversation }: CustomerContextProps) => {
  const customer = conversation.customer;

  if (!customer) {
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
    <div className="p-4 space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Customer Profile</h2>
          {getTierBadge(customer.tier)}
        </div>
        <h3 className="text-xl font-bold">{customer.name || 'Unknown'}</h3>
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase">Contact Info</h4>
        
        {customer.email && (
          <div className="flex items-center gap-2 text-sm">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="break-all">{customer.email}</span>
          </div>
        )}
        
        {customer.phone && (
          <div className="flex items-center gap-2 text-sm">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <span>{customer.phone}</span>
          </div>
        )}

        {customer.preferred_channel && (
          <div className="flex items-center gap-2 text-sm">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <span>Prefers: {customer.preferred_channel}</span>
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase">Recent History</h4>
        <p className="text-sm text-muted-foreground">No previous conversations</p>
      </div>

      {customer.notes && (
        <>
          <Separator />
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase">Notes</h4>
            <Card className="p-3 bg-muted/50">
              <p className="text-sm whitespace-pre-wrap">{customer.notes}</p>
            </Card>
          </div>
        </>
      )}

      <Separator />

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase">Quick Actions</h4>
        <div className="space-y-2">
          <Select
            value={conversation.priority}
            onValueChange={(value) => updatePriority(value)}
          >
            <SelectTrigger>
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
            <SelectTrigger>
              <SelectValue placeholder="Change Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="waiting_customer">Waiting Customer</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" className="w-full">
            Assign to Me
          </Button>
        </div>
      </div>
    </div>
  );

  async function updatePriority(priority: string) {
    // Implementation in parent component
  }

  async function updateStatus(status: string) {
    // Implementation in parent component
  }
};
