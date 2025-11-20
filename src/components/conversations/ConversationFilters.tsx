import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ConversationFiltersProps {
  statusFilter: string[];
  setStatusFilter: (value: string[]) => void;
  priorityFilter: string[];
  setPriorityFilter: (value: string[]) => void;
  channelFilter: string[];
  setChannelFilter: (value: string[]) => void;
  categoryFilter: string[];
  setCategoryFilter: (value: string[]) => void;
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
  const toggleFilter = (currentValues: string[], value: string, onChange: (values: string[]) => void) => {
    if (currentValues.includes(value)) {
      onChange(currentValues.filter(v => v !== value));
    } else {
      onChange([...currentValues, value]);
    }
  };

  const filters = [
    {
      label: 'Status',
      value: statusFilter,
      onChange: setStatusFilter,
      options: [
        { label: 'All', value: '__all__', isAll: true },
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
        { label: 'All', value: '__all__', isAll: true },
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
        { label: 'All', value: '__all__', isAll: true },
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
        { label: 'All', value: '__all__', isAll: true },
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
          {filter.options.map((option) => {
            const isSelected = option.isAll 
              ? filter.value.length === 0 
              : filter.value.includes(option.value);
            
            const handleClick = () => {
              if (option.isAll) {
                filter.onChange([]);
              } else {
                toggleFilter(filter.value, option.value, filter.onChange);
              }
            };
            
            return (
              <Badge
                key={option.value}
                variant={isSelected ? 'default' : 'outline'}
                className={cn(
                  "rounded-full px-4 py-2 cursor-pointer transition-all duration-300 ease-out text-xs font-medium whitespace-nowrap",
                  "active:scale-95",
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-sm scale-[1.02]" 
                    : "hover:bg-accent hover:border-primary/30 hover:scale-[1.02]"
                )}
                onClick={handleClick}
              >
                {option.label}
              </Badge>
            );
          })}
        </div>
      ))}
    </div>
  );
};
