import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Bot, Settings as SettingsIcon, Save, Trash2, Edit2, Route, MessageSquare, Calculator, RefreshCw, AlertTriangle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';

interface AIModel {
  id: string;
  name: string;
  provider: 'lovable' | 'anthropic';
  type: 'text' | 'image' | 'multimodal';
  status: 'active' | 'available';
  description: string;
}

const claudeModels: AIModel[] = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', type: 'multimodal', status: 'active', description: 'High-performance with exceptional reasoning - Default for specialists' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', type: 'text', status: 'active', description: 'Fast responses - Default for routing' },
];

interface SystemPrompt {
  id: string;
  name: string;
  agent_type: 'router' | 'customer_support' | 'quote' | 'triage';
  prompt: string;
  model: string;
  is_default: boolean;
  is_active: boolean;
}

const agentTypeInfo: Record<string, { icon: any; label: string; description: string }> = {
  triage: { icon: Sparkles, label: 'Triage Agent', description: 'Classifies incoming emails - determines urgency, sentiment, and if reply needed' },
  router: { icon: Route, label: 'Router Agent', description: 'Routes messages to Customer Support or Quote specialist' },
  customer_support: { icon: MessageSquare, label: 'Customer Support', description: 'Handles general inquiries, complaints, and account questions' },
  quote: { icon: Calculator, label: 'Quote Agent', description: 'Handles pricing questions and quote requests' },
};

export const AIAgentPanel = () => {
  const { toast } = useToast();
  const { workspace } = useWorkspace();
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPrompt, setEditingPrompt] = useState<SystemPrompt | null>(null);
  const [promptName, setPromptName] = useState('');
  const [promptText, setPromptText] = useState('');
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-20250514');
  const [selectedAgentType, setSelectedAgentType] = useState<'router' | 'customer_support' | 'quote' | 'triage'>('customer_support');
  const [isSaving, setIsSaving] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [reanalyzeProgress, setReanalyzeProgress] = useState(0);
  const [reanalyzeStatus, setReanalyzeStatus] = useState<string | null>(null);
  const [totalProcessed, setTotalProcessed] = useState(0);
  const [totalChanged, setTotalChanged] = useState(0);
  const [changedEmails, setChangedEmails] = useState<Array<{
    id: string;
    originalBucket: string;
    newBucket: string;
    ruleApplied: string | null;
  }>>([]);

  // Fetch count of untriaged conversations
  const { data: untriagedCount = 0, refetch: refetchUntriaged } = useQuery({
    queryKey: ['untriaged-count', workspace?.id],
    queryFn: async () => {
      if (!workspace?.id) return 0;
      const { count } = await supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id)
        .is('email_classification', null);
      return count || 0;
    },
    enabled: !!workspace?.id,
  });

  // Fetch total conversation count for progress
  const { data: totalConversations = 0 } = useQuery({
    queryKey: ['total-conversations', workspace?.id],
    queryFn: async () => {
      if (!workspace?.id) return 0;
      const { count } = await supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id);
      return count || 0;
    },
    enabled: !!workspace?.id,
  });

  const handleReanalyze = async (dryRun = false, skipLLM = false, runAll = false) => {
    if (!workspace?.id) return;

    setIsReanalyzing(true);
    setReanalyzeProgress(0);
    setTotalProcessed(0);
    setTotalChanged(0);
    setChangedEmails([]);
    setReanalyzeStatus(dryRun ? 'Previewing changes...' : 'Analyzing emails...');

    try {
      let offset = 0;
      const batchSize = 50; // Use consistent batch size, Anthropic API handles it fine
      let hasMore = true;
      let processedTotal = 0;
      let changedTotal = 0;
      let allChangedEmails: Array<{
        id: string;
        originalBucket: string;
        newBucket: string;
        ruleApplied: string | null;
      }> = [];

      while (hasMore) {
        const { data, error } = await supabase.functions.invoke('bulk-retriage-conversations', {
          body: {
            workspaceId: workspace.id,
            limit: batchSize,
            offset,
            dryRun,
            skipLLM,
          },
        });

        if (error) throw error;

        processedTotal += data.processed || 0;
        changedTotal += data.changed || 0;
        
        // Collect changed email details from results
        if (data.results && Array.isArray(data.results)) {
          allChangedEmails = [...allChangedEmails, ...data.results];
        }
        
        setTotalProcessed(processedTotal);
        setTotalChanged(changedTotal);
        setChangedEmails(allChangedEmails);
        setReanalyzeProgress(Math.min(95, (processedTotal / Math.max(totalConversations, 1)) * 100));
        setReanalyzeStatus(`Processed ${processedTotal} emails...`);

        // If we processed fewer than batchSize, we're done
        // Or if runAll is false, only do one batch
        if ((data.processed || 0) < batchSize || !runAll) {
          hasMore = false;
        } else {
          offset += batchSize;
        }
      }

      if (dryRun) {
        toast({
          title: 'Preview Complete',
          description: `Would update ${changedTotal} of ${processedTotal} conversations`,
        });
      } else {
        toast({
          title: 'Re-analysis Complete',
          description: `Processed ${processedTotal} emails, ${changedTotal} updated`,
        });
        refetchUntriaged();
      }

      setReanalyzeProgress(100);
      setReanalyzeStatus('Complete!');
    } catch (error: any) {
      console.error('Re-analyze error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to re-analyze inbox',
        variant: 'destructive',
      });
      setReanalyzeStatus('Failed');
    } finally {
      // Keep results visible longer, only clear progress state
      setTimeout(() => {
        setIsReanalyzing(false);
        setReanalyzeProgress(0);
        setReanalyzeStatus(null);
        setTotalProcessed(0);
        setTotalChanged(0);
        // Keep changedEmails visible until next run
      }, 3000);
    }
  };

  useEffect(() => {
    loadPrompts();
  }, [workspace?.id]);

  const loadPrompts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('system_prompts')
        .select('*')
        .order('agent_type')
        .order('is_default', { ascending: false });

      if (error) throw error;
      
      // Type assertion for the data since Supabase types might not be updated yet
      setPrompts((data || []) as unknown as SystemPrompt[]);
    } catch (error) {
      console.error('Error loading prompts:', error);
      toast({ title: 'Error loading prompts', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSavePrompt = async () => {
    if (!promptName.trim() || !promptText.trim()) {
      toast({ title: 'Name and prompt are required', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      if (editingPrompt) {
        const { error } = await supabase
          .from('system_prompts')
          .update({
            name: promptName.trim(),
            prompt: promptText.trim(),
            model: selectedModel,
            agent_type: selectedAgentType,
          })
          .eq('id', editingPrompt.id);

        if (error) throw error;
        toast({ title: 'Prompt updated' });
      } else {
        const { error } = await supabase
          .from('system_prompts')
          .insert({
            workspace_id: workspace?.id || null,
            name: promptName.trim(),
            prompt: promptText.trim(),
            model: selectedModel,
            agent_type: selectedAgentType,
            is_default: false,
            is_active: true,
          });

        if (error) throw error;
        toast({ title: 'Prompt created' });
      }

      resetForm();
      loadPrompts();
    } catch (error) {
      console.error('Error saving prompt:', error);
      toast({ title: 'Failed to save prompt', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setEditingPrompt(null);
    setPromptName('');
    setPromptText('');
    setSelectedModel('claude-sonnet-4-20250514');
    setSelectedAgentType('customer_support');
  };

  const handleEditPrompt = (prompt: SystemPrompt) => {
    setEditingPrompt(prompt);
    setPromptName(prompt.name);
    setPromptText(prompt.prompt);
    setSelectedModel(prompt.model);
    setSelectedAgentType(prompt.agent_type);
  };

  const handleDeletePrompt = async (id: string) => {
    try {
      const { error } = await supabase.from('system_prompts').delete().eq('id', id);
      if (error) throw error;
      toast({ title: 'Prompt deleted' });
      loadPrompts();
    } catch (error) {
      toast({ title: 'Failed to delete', variant: 'destructive' });
    }
  };

  const handleSetDefault = async (id: string, agentType: string) => {
    try {
      // Remove default from other prompts of same type
      await supabase
        .from('system_prompts')
        .update({ is_default: false })
        .eq('agent_type', agentType)
        .eq('is_default', true);

      // Set this one as default
      const { error } = await supabase
        .from('system_prompts')
        .update({ is_default: true })
        .eq('id', id);

      if (error) throw error;
      toast({ title: 'Default prompt updated' });
      loadPrompts();
    } catch (error) {
      toast({ title: 'Failed to set default', variant: 'destructive' });
    }
  };

  const getAgentIcon = (type: string) => {
    const info = agentTypeInfo[type as keyof typeof agentTypeInfo];
    if (!info) return null;
    const Icon = info.icon;
    return <Icon className="h-4 w-4" />;
  };

  const groupedPrompts = {
    router: prompts.filter(p => p.agent_type === 'router'),
    customer_support: prompts.filter(p => p.agent_type === 'customer_support'),
    quote: prompts.filter(p => p.agent_type === 'quote'),
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <CardTitle>Multi-Agent System</CardTitle>
          </div>
          <CardDescription>
            Configure your AI agents: Router decides which specialist handles each message
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="prompts" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="prompts">
                <SettingsIcon className="h-4 w-4 mr-2" />
                Agent Prompts
              </TabsTrigger>
              <TabsTrigger value="models">
                <Sparkles className="h-4 w-4 mr-2" />
                Models
              </TabsTrigger>
            </TabsList>

            <TabsContent value="prompts" className="space-y-4">
              {/* Agent Flow Diagram */}
              <Card className="bg-muted/30">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-center gap-2 text-sm flex-wrap">
                    <Badge variant="outline" className="gap-1">
                      <MessageSquare className="h-3 w-3" /> Incoming Message
                    </Badge>
                    <span>→</span>
                    <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 gap-1">
                      <Route className="h-3 w-3" /> Router Agent
                    </Badge>
                    <span>→</span>
                    <div className="flex flex-col gap-1">
                      <Badge variant="outline" className="gap-1 text-xs">
                        <MessageSquare className="h-3 w-3" /> Customer Support
                      </Badge>
                      <Badge variant="outline" className="gap-1 text-xs">
                        <Calculator className="h-3 w-3" /> Quote Agent
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Create/Edit Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {editingPrompt ? 'Edit Prompt' : 'Create New Prompt'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Agent Type</Label>
                      <Select value={selectedAgentType} onValueChange={(v) => setSelectedAgentType(v as any)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="triage">✨ Triage Agent</SelectItem>
                          <SelectItem value="router">🚦 Router Agent</SelectItem>
                          <SelectItem value="customer_support">💬 Customer Support</SelectItem>
                          <SelectItem value="quote">📊 Quote Agent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Model</Label>
                      <Select value={selectedModel} onValueChange={setSelectedModel}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="claude-sonnet-4-20250514">Claude Sonnet 4 (Specialist)</SelectItem>
                          <SelectItem value="claude-3-5-haiku-20241022">Claude 3.5 Haiku (Fast)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Prompt Name</Label>
                    <Input
                      value={promptName}
                      onChange={(e) => setPromptName(e.target.value)}
                      placeholder="e.g., Customer Support v2"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>System Prompt</Label>
                    <Textarea
                      value={promptText}
                      onChange={(e) => setPromptText(e.target.value)}
                      placeholder="Enter your system prompt..."
                      className="min-h-[200px] font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">{promptText.length} characters</p>
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={handleSavePrompt} disabled={isSaving}>
                      <Save className="h-4 w-4 mr-2" />
                      {isSaving ? 'Saving...' : editingPrompt ? 'Update' : 'Create'}
                    </Button>
                    {editingPrompt && (
                      <Button variant="outline" onClick={resetForm}>Cancel</Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Saved Prompts by Agent Type */}
              {loading ? (
                <p className="text-muted-foreground text-sm">Loading prompts...</p>
              ) : (
                Object.entries(groupedPrompts).map(([type, typePrompts]) => {
                  const info = agentTypeInfo[type as keyof typeof agentTypeInfo];
                  if (!info) return null;
                  const Icon = info.icon;
                  
                  return (
                    <Card key={type}>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          {info.label}
                        </CardTitle>
                        <CardDescription className="text-xs">{info.description}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {typePrompts.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No prompts configured</p>
                        ) : (
                          typePrompts.map((prompt) => (
                            <div key={prompt.id} className="flex items-center justify-between p-3 border rounded-lg gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium truncate">{prompt.name}</span>
                                  {prompt.is_default && <Badge className="text-xs">Default</Badge>}
                                  <Badge variant="secondary" className="text-xs">{prompt.model}</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                                  {prompt.prompt.substring(0, 100)}...
                                </p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditPrompt(prompt)}>
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                                {!prompt.is_default && (
                                  <Button variant="outline" size="sm" onClick={() => handleSetDefault(prompt.id, prompt.agent_type)}>
                                    Set Default
                                  </Button>
                                )}
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDeletePrompt(prompt.id)} disabled={prompt.is_default}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>

            <TabsContent value="models" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bot className="h-5 w-5 text-orange-600" />
                    Anthropic Claude (Active)
                  </CardTitle>
                  <CardDescription>
                    Claude models are used for the multi-agent system
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {claudeModels.map((model) => (
                    <div key={model.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{model.name}</span>
                          <Badge className="bg-emerald-500/10 text-emerald-600 text-xs">Active</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{model.description}</p>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded mt-1 inline-block">{model.id}</code>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-amber-500/20 bg-amber-500/5">
                <CardContent className="pt-4">
                  <p className="text-sm text-muted-foreground">
                    <strong>How it works:</strong> The Router Agent (Haiku) quickly analyzes each message and routes to either Customer Support or Quote Agent (Sonnet). This is more efficient and accurate than a single agent handling everything.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Re-Analyze Inbox Section */}
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-amber-600" />
            Re-Analyze Historical Emails
          </CardTitle>
          <CardDescription>
            {totalConversations > 0 ? (
              <span className="flex items-center gap-2">
                {untriagedCount > 0 && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                {totalConversations.toLocaleString()} total emails
                {untriagedCount > 0 && ` (${untriagedCount.toLocaleString()} not yet analyzed)`}
              </span>
            ) : (
              'No emails to analyze'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isReanalyzing && (
            <div className="space-y-2">
              <Progress value={reanalyzeProgress} className="h-2" />
              <p className="text-sm text-muted-foreground">
                {reanalyzeStatus} {totalProcessed > 0 && `(${totalChanged} changed)`}
              </p>
            </div>
          )}

          {/* Changed Emails List */}
          {changedEmails.length > 0 && !isReanalyzing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">
                  {changedEmails.length} email{changedEmails.length !== 1 ? 's' : ''} updated:
                </p>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setChangedEmails([])}
                  className="text-xs"
                >
                  Clear
                </Button>
              </div>
              <div className="max-h-[200px] overflow-y-auto space-y-1 border rounded-lg p-2 bg-muted/30">
                {changedEmails.map((email) => (
                  <div key={email.id} className="flex items-center gap-2 text-xs py-1 border-b border-border/50 last:border-0">
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {email.originalBucket || 'none'}
                    </Badge>
                    <span className="text-muted-foreground">→</span>
                    <Badge className="text-[10px] shrink-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                      {email.newBucket}
                    </Badge>
                    {email.ruleApplied && (
                      <span className="text-muted-foreground truncate">
                        (rule: {email.ruleApplied})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button 
              onClick={() => handleReanalyze(false, true, true)} 
              disabled={isReanalyzing || totalConversations === 0}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isReanalyzing ? 'animate-spin' : ''}`} />
              {isReanalyzing ? 'Analyzing...' : 'Apply Sender Rules (All)'}
            </Button>
            <Button 
              variant="outline"
              onClick={() => handleReanalyze(false, false, true)} 
              disabled={isReanalyzing || totalConversations === 0}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Full AI Re-Analysis (All)
            </Button>
            <Button 
              variant="ghost"
              onClick={() => handleReanalyze(true, false, false)} 
              disabled={isReanalyzing || totalConversations === 0}
            >
              Preview (100)
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            <strong>Sender Rules Only:</strong> Fast - applies existing rules without AI calls<br />
            <strong>Full AI Re-Analysis:</strong> Thorough - uses AI to classify each email (slower, uses API credits)<br />
            <strong>All:</strong> Processes entire inbox in batches of 100
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
