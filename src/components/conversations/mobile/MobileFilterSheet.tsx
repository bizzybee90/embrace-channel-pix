import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ChevronLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statusFilter: string[];
  priorityFilter: string[];
  channelFilter: string[];
  categoryFilter: string[];
  onStatusFilterChange: (value: string[]) => void;
  onPriorityFilterChange: (value: string[]) => void;
  onChannelFilterChange: (value: string[]) => void;
  onCategoryFilterChange: (value: string[]) => void;
}

export const MobileFilterSheet = ({
  open,
  onOpenChange,
  statusFilter,
  priorityFilter,
  channelFilter,
  categoryFilter,
  onStatusFilterChange,
  onPriorityFilterChange,
  onChannelFilterChange,
  onCategoryFilterChange,
}: MobileFilterSheetProps) => {
  const statusOptions = [
    { label: 'New', value: 'new' },
    { label: 'Open', value: 'open' },
    { label: 'Pending', value: 'pending' },
  ];

  const priorityOptions = [
    { label: 'Urgent', value: 'urgent' },
    { label: 'High', value: 'high' },
    { label: 'Medium', value: 'medium' },
    { label: 'Low', value: 'low' },
  ];

  const channelOptions = [
    { label: 'SMS', value: 'sms' },
    { label: 'Email', value: 'email' },
    { label: 'WhatsApp', value: 'whatsapp' },
    { label: 'Phone', value: 'phone' },
  ];

  const categoryOptions = [
    { label: 'Billing', value: 'billing' },
    { label: 'Technical', value: 'technical' },
    { label: 'General', value: 'general' },
  ];

  const hasActiveFilters = 
    statusFilter.length > 0 || 
    priorityFilter.length > 0 || 
    channelFilter.length > 0 || 
    categoryFilter.length > 0;

  const handleClearAll = () => {
    onStatusFilterChange([]);
    onPriorityFilterChange([]);
    onChannelFilterChange([]);
    onCategoryFilterChange([]);
  };

  const toggleFilter = (currentValues: string[], value: string, onChange: (values: string[]) => void) => {
    if (currentValues.includes(value)) {
      onChange(currentValues.filter(v => v !== value));
    } else {
      onChange([...currentValues, value]);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] p-0">
        <div className="flex flex-col h-full bg-background">
          {/* Header */}
          <div className="px-5 pt-safe pb-4 border-b border-border/40 bg-background/95 backdrop-blur-xl">
            <div className="flex items-center justify-between pt-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onOpenChange(false)}
                  className="flex items-center justify-center w-9 h-9 rounded-full bg-muted active:scale-95 transition-transform"
                >
                  <ChevronLeft className="h-5 w-5 text-foreground" />
                </button>
                <h2 className="text-[20px] font-semibold text-foreground">Filters</h2>
              </div>
              
              {/* Clear All Button */}
              {hasActiveFilters && (
                <button
                  onClick={handleClearAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-muted-foreground text-[14px] font-medium active:scale-95 transition-all hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                  Clear All
                </button>
              )}
            </div>
          </div>

          {/* Filter Sections */}
          <div className="flex-1 overflow-y-auto px-5 py-6 space-y-8">
            {/* Status Section */}
            <div className="animate-fade-in" style={{ animationDelay: '0ms' }}>
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Status
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {/* All button */}
                <button
                  onClick={() => onStatusFilterChange([])}
                  className={cn(
                    "h-[48px] rounded-2xl text-[15px] font-medium transition-all duration-300 ease-out",
                    "active:scale-[0.92] border",
                    statusFilter.length === 0
                      ? "bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]"
                      : "bg-muted text-muted-foreground border-border/50 hover:border-primary/30 hover:bg-muted/80"
                  )}
                >
                  All
                </button>
                {statusOptions.map((option, idx) => (
                  <button
                    key={option.value}
                    onClick={() => toggleFilter(statusFilter, option.value, onStatusFilterChange)}
                    className={cn(
                      "h-[48px] rounded-2xl text-[15px] font-medium transition-all duration-300 ease-out",
                      "active:scale-[0.92] border",
                      statusFilter.includes(option.value)
                        ? "bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]"
                        : "bg-muted text-muted-foreground border-border/50 hover:border-primary/30 hover:bg-muted/80"
                    )}
                    style={{ animationDelay: `${(idx + 1) * 50}ms` }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Priority Section */}
            <div className="animate-fade-in" style={{ animationDelay: '100ms' }}>
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Priority
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {/* All button */}
                <button
                  onClick={() => onPriorityFilterChange([])}
                  className={cn(
                    "h-[48px] rounded-2xl text-[15px] font-medium transition-all duration-300 ease-out",
                    "active:scale-[0.92] border",
                    priorityFilter.length === 0
                      ? "bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]"
                      : "bg-muted text-muted-foreground border-border/50 hover:border-primary/30 hover:bg-muted/80"
                  )}
                >
                  All
                </button>
                {priorityOptions.map((option, idx) => (
                  <button
                    key={option.value}
                    onClick={() => toggleFilter(priorityFilter, option.value, onPriorityFilterChange)}
                    className={cn(
                      "h-[48px] rounded-2xl text-[15px] font-medium transition-all duration-300 ease-out",
                      "active:scale-[0.92] border",
                      priorityFilter.includes(option.value)
                        ? "bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]"
                        : "bg-muted text-muted-foreground border-border/50 hover:border-primary/30 hover:bg-muted/80"
                    )}
                    style={{ animationDelay: `${100 + (idx + 1) * 50}ms` }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Channel Section */}
            <div className="animate-fade-in" style={{ animationDelay: '200ms' }}>
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Channel
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {/* All button */}
                <button
                  onClick={() => onChannelFilterChange([])}
                  className={cn(
                    "h-[48px] rounded-2xl text-[15px] font-medium transition-all duration-300 ease-out",
                    "active:scale-[0.92] border",
                    channelFilter.length === 0
                      ? "bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]"
                      : "bg-muted text-muted-foreground border-border/50 hover:border-primary/30 hover:bg-muted/80"
                  )}
                >
                  All
                </button>
                {channelOptions.map((option, idx) => (
                  <button
                    key={option.value}
                    onClick={() => toggleFilter(channelFilter, option.value, onChannelFilterChange)}
                    className={cn(
                      "h-[48px] rounded-2xl text-[15px] font-medium transition-all duration-300 ease-out",
                      "active:scale-[0.92] border",
                      channelFilter.includes(option.value)
                        ? "bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]"
                        : "bg-muted text-muted-foreground border-border/50 hover:border-primary/30 hover:bg-muted/80"
                    )}
                    style={{ animationDelay: `${200 + (idx + 1) * 50}ms` }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Section */}
            <div className="animate-fade-in" style={{ animationDelay: '300ms' }}>
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Category
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {/* All button */}
                <button
                  onClick={() => onCategoryFilterChange([])}
                  className={cn(
                    "h-[48px] rounded-2xl text-[15px] font-medium transition-all duration-300 ease-out",
                    "active:scale-[0.92] border",
                    categoryFilter.length === 0
                      ? "bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]"
                      : "bg-muted text-muted-foreground border-border/50 hover:border-primary/30 hover:bg-muted/80"
                  )}
                >
                  All
                </button>
                {categoryOptions.map((option, idx) => (
                  <button
                    key={option.value}
                    onClick={() => toggleFilter(categoryFilter, option.value, onCategoryFilterChange)}
                    className={cn(
                      "h-[48px] rounded-2xl text-[15px] font-medium transition-all duration-300 ease-out",
                      "active:scale-[0.92] border",
                      categoryFilter.includes(option.value)
                        ? "bg-primary text-primary-foreground border-primary shadow-sm scale-[1.02]"
                        : "bg-muted text-muted-foreground border-border/50 hover:border-primary/30 hover:bg-muted/80"
                    )}
                    style={{ animationDelay: `${300 + (idx + 1) * 50}ms` }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
