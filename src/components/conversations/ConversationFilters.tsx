import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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
  const filters = [
    {
      label: 'Status',
      value: statusFilter,
      onChange: setStatusFilter,
      options: [
        { label: 'All', value: 'all' },
        { label: 'New', value: 'new' },
        { label: 'Open', value: 'open' },
        { label: 'Waiting', value: 'waiting_customer' },
        { label: 'Resolved', value: 'resolved' },
      ]
    },
    {
      label: 'Priority',
      value: priorityFilter,
      onChange: setPriorityFilter,
      options: [
        { label: 'All', value: 'all' },
        { label: 'High', value: 'high' },
        { label: 'Medium', value: 'medium' },
        { label: 'Low', value: 'low' },
      ]
    },
    {
      label: 'Channel',
      value: channelFilter,
      onChange: setChannelFilter,
      options: [
        { label: 'All', value: 'all' },
        { label: 'SMS', value: 'sms' },
        { label: 'WhatsApp', value: 'whatsapp' },
        { label: 'Email', value: 'email' },
        { label: 'Web', value: 'web_chat' },
      ]
    },
    {
      label: 'Category',
      value: categoryFilter,
      onChange: setCategoryFilter,
      options: [
        { label: 'All', value: 'all' },
        { label: 'Billing', value: 'billing_payment' },
        { label: 'Technical', value: 'technical_support' },
        { label: 'Account', value: 'account_management' },
        { label: 'Product', value: 'product_inquiry' },
        { label: 'Complaint', value: 'complaint' },
        { label: 'Other', value: 'other' },
      ]
    },
  ];

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
      {filters.map((filter) => (
        <div key={filter.label} className="flex gap-1.5 flex-shrink-0">
          {filter.options.map((option) => (
            <Badge
              key={option.value}
              variant={filter.value === option.value ? 'default' : 'outline'}
              className={cn(
                "rounded-full px-4 py-2 cursor-pointer transition-all duration-200 text-xs font-medium whitespace-nowrap",
                filter.value === option.value 
                  ? "bg-primary text-primary-foreground shadow-sm" 
                  : "hover:bg-accent hover:border-primary/20"
              )}
              onClick={() => filter.onChange(option.value)}
            >
              {option.label}
            </Badge>
          ))}
        </div>
      ))}
    </div>
  );
};
