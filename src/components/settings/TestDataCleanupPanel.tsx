import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Trash2, AlertTriangle, RefreshCw, Loader2, Building2, ArrowRight, Zap, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
import { Progress } from '@/components/ui/progress';

interface CleanupStep {
  id: number;
  name: string;
  description: string;
}

const CLEANUP_STEPS: CleanupStep[] = [
  { id: 1, name: 'Clean Orphaned Messages', description: 'Remove messages without conversations' },
  { id: 2, name: 'Dedupe Conversations', description: 'Remove duplicate email threads' },
  { id: 3, name: 'Dedupe Customers', description: 'Remove duplicate customer records' },
  { id: 4, name: 'Clear Import Queue', description: 'Clear pending email imports' },
  { id: 5, name: 'Reset Progress', description: 'Reset import progress for fresh start' },
];

export const TestDataCleanupPanel = () => {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [counts, setCounts] = useState<{conversations: number; messages: number; customers: number} | null>(null);
  const [deleteCustomers, setDeleteCustomers] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [savingContext, setSavingContext] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [stepResults, setStepResults] = useState<Record<number, { deleted: number; remaining: number; message: string }>>({});

  // Fetch existing business context
  const fetchBusinessContext = async () => {
    if (!workspace?.id) return;
    
    const { data } = await supabase
      .from('business_context')
      .select('custom_flags')
      .eq('workspace_id', workspace.id)
      .single();
    
    if (data?.custom_flags) {
      const flags = data.custom_flags as Record<string, unknown>;
      setCompanyName((flags.company_name as string) || '');
    }
  };

  useEffect(() => {
    fetchBusinessContext();
  }, [workspace?.id]);

  const saveCompanyName = async () => {
    if (!workspace?.id || !companyName.trim()) return;
    
    setSavingContext(true);
    try {
      const { data: existing } = await supabase
        .from('business_context')
        .select('id, custom_flags')
        .eq('workspace_id', workspace.id)
        .single();

      const updatedFlags = {
        ...(existing?.custom_flags as Record<string, unknown> || {}),
        company_name: companyName.trim()
      };

      if (existing) {
        await supabase
          .from('business_context')
          .update({ custom_flags: updatedFlags })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('business_context')
          .insert({ workspace_id: workspace.id, custom_flags: updatedFlags });
      }

      toast({
        title: 'Company name saved',
        description: 'Your AI will now use this to classify emails correctly.',
      });
    } catch (error) {
      console.error('Error saving company name:', error);
      toast({
        title: 'Failed to save',
        description: 'Could not save company name.',
        variant: 'destructive',
      });
    } finally {
      setSavingContext(false);
    }
  };

  const runCleanupStep = async (step: number) => {
    if (!workspace?.id) return;
    
    setCleanupRunning(true);
    setCurrentStep(step);
    
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-duplicates', {
        body: { step, workspaceId: workspace.id }
      });

      if (error) throw error;

      setStepResults(prev => ({ ...prev, [step]: data }));
      
      toast({
        title: `Step ${step} Complete`,
        description: data.message,
      });

      // Refresh counts after cleanup
      fetchCounts();
    } catch (error: any) {
      console.error('Cleanup error:', error);
      toast({
        title: 'Cleanup failed',
        description: error?.message || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setCleanupRunning(false);
      setCurrentStep(null);
    }
  };

  const runAllSteps = async () => {
    for (const step of CLEANUP_STEPS) {
      await runCleanupStep(step.id);
      // Small delay between steps
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    toast({
      title: 'All cleanup steps complete',
      description: 'Your database has been cleaned up.',
    });
  };

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
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('workspace_id', workspace.id);

      const conversationIds = conversations?.map(c => c.id) || [];

      if (conversationIds.length > 0) {
        const { error: msgError } = await supabase
          .from('messages')
          .delete()
          .in('conversation_id', conversationIds);

        if (msgError) throw msgError;
      }

      const { error: convError } = await supabase
        .from('conversations')
        .delete()
        .eq('workspace_id', workspace.id);

      if (convError) throw convError;

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

  const handleResetAndResync = async () => {
    if (!workspace?.id) return;
    
    setResyncing(true);
    try {
      // Step 1: Clear all conversations and messages
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('workspace_id', workspace.id);

      const conversationIds = conversations?.map(c => c.id) || [];

      if (conversationIds.length > 0) {
        await supabase.from('messages').delete().in('conversation_id', conversationIds);
      }
      await supabase.from('conversations').delete().eq('workspace_id', workspace.id);

      toast({
        title: 'Step 1: Data cleared',
        description: `Deleted ${conversationIds.length} conversations. Starting re-sync...`,
      });

      // Step 2: Find email config and trigger sync
      const { data: emailConfigs } = await supabase
        .from('email_provider_configs')
        .select('id')
        .eq('workspace_id', workspace.id)
        .limit(1);

      if (emailConfigs && emailConfigs.length > 0) {
        const { error: syncError } = await supabase.functions.invoke('email-sync', {
          body: {
            configId: emailConfigs[0].id,
            mode: 'all_historical_90_days',
            maxMessages: 25,
          }
        });

        if (syncError) {
          console.error('Sync error:', syncError);
          toast({
            title: 'Re-sync started with issues',
            description: 'Some emails may not have synced. Check Settings → Email to retry.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Re-sync complete!',
            description: 'Emails have been re-imported with your updated business context.',
          });
        }
      } else {
        toast({
          title: 'No email account connected',
          description: 'Connect an email account first, then try again.',
          variant: 'destructive',
        });
      }

      setCounts(null);
    } catch (error) {
      console.error('Error in reset and resync:', error);
      toast({
        title: 'Reset failed',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setResyncing(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-6">
        {/* Business Context Quick Setup */}
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <Building2 className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-3 flex-1">
              <div>
                <h3 className="text-lg font-semibold">Company Identity</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Set your company name so AI can correctly classify invoices TO you vs. misdirected ones.
                </p>
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder="e.g. MAC Cleaning"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="max-w-xs"
                />
                <Button 
                  onClick={saveCompanyName} 
                  disabled={savingContext || !companyName.trim()}
                  variant="outline"
                >
                  {savingContext ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>

              {companyName && (
                <p className="text-xs text-muted-foreground">
                  ✓ AI will classify invoices addressed to "{companyName}" as legitimate.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Reset & Re-sync Section */}
        <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-start gap-3">
            <RefreshCw className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="space-y-3 flex-1">
              <div>
                <h3 className="text-lg font-semibold">Reset & Re-sync Emails</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Clear all emails and re-import them with your current business context.
                  This will re-triage everything using your company name and settings.
                </p>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={resyncing || !companyName.trim()} className="gap-2">
                    {resyncing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    {resyncing ? 'Re-syncing...' : 'Reset & Re-sync All Emails'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset and re-sync all emails?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <p>This will:</p>
                      <ul className="list-disc list-inside text-sm">
                        <li>Delete all current conversations and messages</li>
                        <li>Re-import emails from the last 90 days</li>
                        <li>Re-triage with your current business context (company name, etc.)</li>
                      </ul>
                      <p className="font-medium mt-2">Company: {companyName}</p>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleResetAndResync}>
                      Yes, reset and re-sync
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {!companyName.trim() && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <ArrowRight className="h-3 w-3" />
                  Set your company name above first
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Nuclear Cleanup Section */}
        <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
            <div className="space-y-4 flex-1">
              <div>
                <h3 className="text-lg font-semibold">Database Cleanup (Large Datasets)</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Clean up duplicate records in batches. Use this if you have millions of duplicate records
                  from import issues. Run each step multiple times if needed.
                </p>
              </div>

              <div className="space-y-2">
                {CLEANUP_STEPS.map((step) => (
                  <div 
                    key={step.id}
                    className="flex items-center justify-between p-3 bg-background/50 rounded-lg border"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                        stepResults[step.id] ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
                      }`}>
                        {stepResults[step.id] ? <CheckCircle2 className="h-4 w-4" /> : step.id}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{step.name}</p>
                        <p className="text-xs text-muted-foreground">{step.description}</p>
                        {stepResults[step.id] && (
                          <p className="text-xs text-green-600 mt-1">
                            {stepResults[step.id].message}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runCleanupStep(step.id)}
                      disabled={cleanupRunning}
                    >
                      {currentStep === step.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Run'
                      )}
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="gap-2" disabled={cleanupRunning}>
                      <Zap className="h-4 w-4" />
                      Run All Steps
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Run all cleanup steps?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will run all 5 cleanup steps in sequence. This may take a few minutes
                        for large datasets. You can also run steps individually.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={runAllSteps}>
                        Run All
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        </div>

        {/* Clear Test Data Section */}
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