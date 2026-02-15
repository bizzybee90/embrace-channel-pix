import { Check, Ban, Tag, MessageSquare, Reply, Forward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CATEGORY_GROUPS } from '@/lib/emailDirection';

interface QuickActionsBarProps {
  emailId: string;
  workspaceId: string;
}

export const QuickActionsBar = ({ emailId, workspaceId }: QuickActionsBarProps) => {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inbox-emails'] });
    queryClient.invalidateQueries({ queryKey: ['inbox-counts'] });
    queryClient.invalidateQueries({ queryKey: ['inbox-email-detail'] });
  };

  const markHandled = async () => {
    const { error } = await supabase
      .from('email_import_queue')
      .update({ requires_reply: false, status: 'processed' })
      .eq('id', emailId);
    if (error) { toast.error('Failed to update'); return; }
    toast.success('Marked as handled');
    invalidate();
  };

  const markSpam = async () => {
    const { error } = await supabase
      .from('email_import_queue')
      .update({ category: 'spam', is_noise: true })
      .eq('id', emailId);
    if (error) { toast.error('Failed to update'); return; }
    toast.success('Marked as spam');
    invalidate();
  };

  const changeCategory = async (category: string) => {
    const { error } = await supabase
      .from('email_import_queue')
      .update({ category })
      .eq('id', emailId);
    if (error) { toast.error('Failed to update'); return; }
    toast.success(`Category changed to ${category}`);
    invalidate();
  };

  return (
    <div className="flex items-center gap-2 p-3 border-t border-border bg-card flex-nowrap overflow-x-auto">
      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => toast.info('Reply coming soon')}>
        <Reply className="h-3.5 w-3.5" />
        Reply
      </Button>
      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => toast.info('Forward coming soon')}>
        <Forward className="h-3.5 w-3.5" />
        Forward
      </Button>
      <div className="w-px h-5 bg-border" />
      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={markHandled}>
        <Check className="h-3.5 w-3.5" />
        Handled
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs">
            <Tag className="h-3.5 w-3.5" />
            Category
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {CATEGORY_GROUPS.map(g => (
            <DropdownMenuItem key={g.key} onClick={() => changeCategory(g.categories[0])}>
              {g.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive" onClick={markSpam}>
        <Ban className="h-3.5 w-3.5" />
        Spam
      </Button>
    </div>
  );
};
