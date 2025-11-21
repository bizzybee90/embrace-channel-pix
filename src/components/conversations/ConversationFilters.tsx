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
    <div className="space-y-2.5">
      {filters.map((filter) => (
        <div key={filter.label} className="space-y-1">
          <span className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider pl-0.5">
            {filter.label}
          </span>
          <div className="flex gap-1.5 flex-wrap">
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
                    "rounded-md px-2.5 py-0.5 cursor-pointer transition-all duration-150 text-[11px] font-medium whitespace-nowrap",
                    "active:scale-95",
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-sm" 
                      : "hover:bg-accent hover:border-primary/30"
                  )}
                  onClick={handleClick}
                >
                  {option.label}
                </Badge>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
