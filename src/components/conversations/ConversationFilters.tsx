import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

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

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Status: true,
    Priority: false,
    Channel: false,
    Category: false,
  });

  const toggleSection = (label: string) => {
    setOpenSections(prev => ({ ...prev, [label]: !prev[label] }));
  };

  const getActiveCount = (filter: typeof filters[0]) => {
    return filter.value.length;
  };

  return (
    <div className="space-y-1">
      {filters.map((filter) => {
        const activeCount = getActiveCount(filter);
        const isOpen = openSections[filter.label];
        
        return (
          <Collapsible
            key={filter.label}
            open={isOpen}
            onOpenChange={() => toggleSection(filter.label)}
          >
            <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium hover:bg-muted/50 rounded-md transition-colors group">
              <div className="flex items-center gap-2">
                <span className="text-foreground">{filter.label}</span>
                {activeCount > 0 && (
                  <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[10px] font-semibold">
                    {activeCount}
                  </Badge>
                )}
              </div>
              <ChevronDown 
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200",
                  isOpen && "rotate-180"
                )} 
              />
            </CollapsibleTrigger>
            
            <CollapsibleContent className="px-3 pb-2 pt-1">
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
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
};
