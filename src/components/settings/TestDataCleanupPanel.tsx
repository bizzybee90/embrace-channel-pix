import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Trash2, AlertTriangle, CheckCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export const TestDataCleanupPanel = () => {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<{conversations: number; messages: number; customers: number} | null>(null);
  const [deleteCustomers, setDeleteCustomers] = useState(false);

  const fetchCounts = async () => {
    if (!workspace?.id) return;

    try {
      const [convResult, msgResult, custResult] = await Promise.all([
        supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
        supabase.from('messages').select('id', { count: 'exact', head: true }),
        supabase.from('customers').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
      ]);

      setCounts({
        conversations: convResult.count || 0,
        messages: msgResult.count || 0,
        customers: custResult.count || 0,
      });
    } catch (error) {
      console.error('Error fetching counts:', error);
    }
  };

  const handleClearData = async () => {
    if (!workspace?.id) return;
    
    setLoading(true);
    try {
      // First, get all conversation IDs for this workspace
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('workspace_id', workspace.id);

      const conversationIds = conversations?.map(c => c.id) || [];

      // Delete messages for those conversations
      if (conversationIds.length > 0) {
        const { error: msgError } = await supabase
          .from('messages')
          .delete()
          .in('conversation_id', conversationIds);

        if (msgError) throw msgError;
      }

      // Delete conversations
      const { error: convError } = await supabase
        .from('conversations')
        .delete()
        .eq('workspace_id', workspace.id);

      if (convError) throw convError;

      // Optionally delete customers
      if (deleteCustomers) {
        const { error: custError } = await supabase
          .from('customers')
          .delete()
          .eq('workspace_id', workspace.id);

        if (custError) throw custError;
      }

      toast({
        title: 'Data cleared successfully',
        description: `Deleted ${conversationIds.length} conversations and their messages${deleteCustomers ? ', plus all customers' : ''}.`,
      });

      setCounts(null);
      setDeleteCustomers(false);

    } catch (error) {
      console.error('Error clearing data:', error);
      toast({
        title: 'Failed to clear data',
        description: 'Some data may not have been deleted. Check console for details.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Clear Test Data
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Delete all test conversations, messages, and optionally customers to start fresh. 
            This action cannot be undone.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={fetchCounts}>
            Check Current Data
          </Button>

          {counts && (
            <div className="text-sm text-muted-foreground flex items-center gap-4">
              <span>{counts.conversations} conversations</span>
              <span>{counts.messages} messages</span>
              <span>{counts.customers} customers</span>
            </div>
          )}
        </div>

        <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-3 flex-1">
              <p className="text-sm font-medium text-destructive">
                Warning: This will permanently delete all data
              </p>
              <p className="text-sm text-muted-foreground">
                All conversations and messages will be deleted. This is useful for clearing 
                test data before going live with real customers.
              </p>

              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="delete-customers" 
                  checked={deleteCustomers}
                  onCheckedChange={(checked) => setDeleteCustomers(checked === true)}
                />
                <Label htmlFor="delete-customers" className="text-sm cursor-pointer">
                  Also delete all customers
                </Label>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={loading}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    {loading ? 'Clearing...' : 'Clear All Test Data'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <p>This action cannot be undone. This will permanently delete:</p>
                      <ul className="list-disc list-inside text-sm">
                        <li>All conversations in your workspace</li>
                        <li>All messages within those conversations</li>
                        {deleteCustomers && <li>All customer records</li>}
                      </ul>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleClearData}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Yes, delete everything
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};