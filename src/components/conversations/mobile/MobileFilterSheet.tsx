import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statusFilter: string;
  priorityFilter: string;
  channelFilter: string;
  categoryFilter: string;
  onStatusFilterChange: (value: string) => void;
  onPriorityFilterChange: (value: string) => void;
  onChannelFilterChange: (value: string) => void;
  onCategoryFilterChange: (value: string) => void;
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
    { label: 'All', value: 'all' },
    { label: 'New', value: 'new' },
    { label: 'Open', value: 'open' },
    { label: 'Pending', value: 'pending' },
  ];

  const priorityOptions = [
    { label: 'All', value: 'all' },
    { label: 'Urgent', value: 'urgent' },
    { label: 'High', value: 'high' },
    { label: 'Medium', value: 'medium' },
    { label: 'Low', value: 'low' },
  ];

  const channelOptions = [
    { label: 'All', value: 'all' },
    { label: 'SMS', value: 'sms' },
    { label: 'Email', value: 'email' },
    { label: 'WhatsApp', value: 'whatsapp' },
    { label: 'Phone', value: 'phone' },
  ];

  const categoryOptions = [
    { label: 'All', value: 'all' },
    { label: 'Billing', value: 'billing' },
    { label: 'Technical', value: 'technical' },
    { label: 'General', value: 'general' },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] p-0">
        <div className="flex flex-col h-full bg-background">
          {/* Header */}
          <div className="px-5 pt-safe pb-4 border-b border-border/40 bg-background/95 backdrop-blur-xl">
            <div className="flex items-center gap-3 pt-4">
              <button
                onClick={() => onOpenChange(false)}
                className="flex items-center justify-center w-9 h-9 rounded-full bg-muted active:scale-95 transition-transform"
              >
                <ChevronLeft className="h-5 w-5 text-foreground" />
              </button>
              <h2 className="text-[20px] font-semibold text-foreground">Filters</h2>
            </div>
          </div>

          {/* Filter Sections */}
          <div className="flex-1 overflow-y-auto px-5 py-6 space-y-8">
            {/* Status Section */}
            <div>
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Status
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {statusOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onStatusFilterChange(option.value)}
                    className={cn(
                      "h-[48px] rounded-2xl text-[15px] font-medium transition-all duration-200",
                      "active:scale-95 border",
                      statusFilter === option.value
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-muted text-muted-foreground border-border/50"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Priority Section */}
            <div>
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Priority
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {priorityOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onPriorityFilterChange(option.value)}
                    className={cn(
                      "h-[48px] rounded-2xl text-[15px] font-medium transition-all duration-200",
                      "active:scale-95 border",
                      priorityFilter === option.value
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-muted text-muted-foreground border-border/50"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Channel Section */}
            <div>
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Channel
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {channelOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onChannelFilterChange(option.value)}
                    className={cn(
                      "h-[48px] rounded-2xl text-[15px] font-medium transition-all duration-200",
                      "active:scale-95 border",
                      channelFilter === option.value
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-muted text-muted-foreground border-border/50"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Section */}
            <div>
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Category
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {categoryOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onCategoryFilterChange(option.value)}
                    className={cn(
                      "h-[48px] rounded-2xl text-[15px] font-medium transition-all duration-200",
                      "active:scale-95 border",
                      categoryFilter === option.value
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-muted text-muted-foreground border-border/50"
                    )}
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
