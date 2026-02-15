import { Inbox, Send, Mail, Sparkles, Ban, Archive, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type InboxFolder, CATEGORY_GROUPS } from '@/lib/emailDirection';
import { useInboxCounts } from '@/hooks/useInboxEmails';

interface InboxSidebarProps {
  activeFolder: InboxFolder;
  onFolderChange: (folder: InboxFolder) => void;
  activeCategoryFilter: string | null;
  onCategoryFilterChange: (category: string | null) => void;
}

const FOLDER_ITEMS: { key: InboxFolder; label: string; icon: React.ReactNode; countKey?: string }[] = [
  { key: 'inbox', label: 'Inbox', icon: <Inbox className="h-4 w-4" />, countKey: 'inbox' },
  { key: 'needs-reply', label: 'Needs Reply', icon: <Mail className="h-4 w-4" />, countKey: 'needsReply' },
  { key: 'ai-review', label: 'AI Review', icon: <Sparkles className="h-4 w-4" />, countKey: 'aiReview' },
  { key: 'sent', label: 'Sent', icon: <Send className="h-4 w-4" /> },
  { key: 'noise', label: 'Spam & Noise', icon: <Ban className="h-4 w-4" /> },
  { key: 'all', label: 'All Mail', icon: <Archive className="h-4 w-4" />, countKey: 'total' },
];

export const InboxSidebar = ({ activeFolder, onFolderChange, activeCategoryFilter, onCategoryFilterChange }: InboxSidebarProps) => {
  const { data: counts } = useInboxCounts();

  return (
    <div className="w-[220px] flex-shrink-0 border-r border-border bg-card flex flex-col h-full overflow-y-auto">
      <div className="p-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Mail</h2>
      </div>

      {/* Folders */}
      <div className="p-2 space-y-0.5">
        {FOLDER_ITEMS.map(item => {
          const count = item.countKey && counts ? (counts as Record<string, number>)[item.countKey] : null;
          return (
            <button
              key={item.key}
              onClick={() => { onFolderChange(item.key); onCategoryFilterChange(null); }}
              className={cn(
                'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors',
                activeFolder === item.key && !activeCategoryFilter
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              {item.icon}
              <span className="flex-1 text-left truncate">{item.label}</span>
              {count != null && count > 0 && (
                <span className="text-xs tabular-nums text-muted-foreground">{count.toLocaleString()}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Category Filters */}
      <div className="p-2 border-t border-border mt-2">
        <p className="text-xs font-medium text-muted-foreground px-2.5 py-1 uppercase tracking-wider">Categories</p>
        <div className="space-y-0.5 mt-1">
          {CATEGORY_GROUPS.map(group => (
            <button
              key={group.key}
              onClick={() => onCategoryFilterChange(activeCategoryFilter === group.key ? null : group.key)}
              className={cn(
                'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors',
                activeCategoryFilter === group.key
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              <Tag className="h-3.5 w-3.5" />
              <span className="flex-1 text-left truncate">{group.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
