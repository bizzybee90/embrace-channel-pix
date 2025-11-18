import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ConversationFiltersProps {
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  priorityFilter: string;
  setPriorityFilter: (value: string) => void;
  channelFilter: string;
  setChannelFilter: (value: string) => void;
  categoryFilter: string;
  setCategoryFilter: (value: string) => void;
}

export const ConversationFilters = ({
  statusFilter,
  setStatusFilter,
  priorityFilter,
  setPriorityFilter,
  channelFilter,
  setChannelFilter,
  categoryFilter,
  setCategoryFilter
}: ConversationFiltersProps) => {
  return (
    <div className="flex gap-2">
      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger className="w-[140px]">
          <SelectValue>
            {statusFilter === 'all' ? 'Status: All' : 
             statusFilter === 'new' ? 'Status: New' :
             statusFilter === 'open' ? 'Status: Open' :
             statusFilter === 'waiting_customer' ? 'Status: Waiting Customer' :
             'Status: Resolved'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="new">New</SelectItem>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="waiting_customer">Waiting Customer</SelectItem>
          <SelectItem value="resolved">Resolved</SelectItem>
        </SelectContent>
      </Select>

      <Select value={priorityFilter} onValueChange={setPriorityFilter}>
        <SelectTrigger className="w-[140px]">
          <SelectValue>
            {priorityFilter === 'all' ? 'Priority: All' :
             priorityFilter === 'high' ? 'Priority: High' :
             priorityFilter === 'medium' ? 'Priority: Medium' :
             'Priority: Low'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Priority</SelectItem>
          <SelectItem value="high">High</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="low">Low</SelectItem>
        </SelectContent>
      </Select>

      <Select value={channelFilter} onValueChange={setChannelFilter}>
        <SelectTrigger className="w-[140px]">
          <SelectValue>
            {channelFilter === 'all' ? 'Channel: All' :
             channelFilter === 'sms' ? 'Channel: SMS' :
             channelFilter === 'whatsapp' ? 'Channel: WhatsApp' :
             channelFilter === 'email' ? 'Channel: Email' :
             'Channel: Web Chat'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Channels</SelectItem>
          <SelectItem value="sms">SMS</SelectItem>
          <SelectItem value="whatsapp">WhatsApp</SelectItem>
          <SelectItem value="email">Email</SelectItem>
          <SelectItem value="web_chat">Web Chat</SelectItem>
        </SelectContent>
      </Select>

      <Select value={categoryFilter} onValueChange={setCategoryFilter}>
        <SelectTrigger className="w-[140px]">
          <SelectValue>
            {categoryFilter === 'all' ? 'Category: All' :
             categoryFilter === 'billing_payment' ? 'Category: Billing & Payment' :
             categoryFilter === 'technical_support' ? 'Category: Technical Support' :
             categoryFilter === 'account_management' ? 'Category: Account Management' :
             categoryFilter === 'product_inquiry' ? 'Category: Product Inquiry' :
             categoryFilter === 'complaint' ? 'Category: Complaint' :
             'Category: Other'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          <SelectItem value="billing_payment">Billing & Payment</SelectItem>
          <SelectItem value="technical_support">Technical Support</SelectItem>
          <SelectItem value="account_management">Account Management</SelectItem>
          <SelectItem value="product_inquiry">Product Inquiry</SelectItem>
          <SelectItem value="complaint">Complaint</SelectItem>
          <SelectItem value="other">Other</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};
