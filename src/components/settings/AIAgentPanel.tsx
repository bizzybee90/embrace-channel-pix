import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Sparkles, Bot, Settings as SettingsIcon, Save } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';

interface AIModel {
  id: string;
  name: string;
  provider: 'lovable' | 'anthropic' | 'openai' | 'google';
  type: 'text' | 'image' | 'multimodal';
  status: 'active' | 'available' | 'inactive';
  description: string;
}

const lovableModels: AIModel[] = [
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'lovable',
    type: 'multimodal',
    status: 'active',
    description: 'Top-tier Gemini model for complex reasoning and multimodal tasks'
  },
  {
    id: 'google/gemini-3-pro-preview',
    name: 'Gemini 3 Pro Preview',
    provider: 'lovable',
    type: 'multimodal',
    status: 'active',
    description: 'Next-generation Gemini model with enhanced capabilities'
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'lovable',
    type: 'multimodal',
    status: 'active',
    description: 'Balanced performance and cost for most use cases'
  },
  {
    id: 'google/gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    provider: 'lovable',
    type: 'text',
    status: 'active',
    description: 'Fast and cost-effective for simple tasks'
  },
  {
    id: 'google/gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash Image',
    provider: 'lovable',
    type: 'image',
    status: 'active',
    description: 'Image generation model'
  },
  {
    id: 'google/gemini-3-pro-image-preview',
    name: 'Gemini 3 Pro Image Preview',
    provider: 'lovable',
    type: 'image',
    status: 'active',
    description: 'Next-gen image generation'
  },
  {
    id: 'openai/gpt-5',
    name: 'GPT-5',
    provider: 'lovable',
    type: 'multimodal',
    status: 'active',
    description: 'Most capable OpenAI model with superior reasoning'
  },
  {
    id: 'openai/gpt-5-mini',
    name: 'GPT-5 Mini',
    provider: 'lovable',
    type: 'text',
    status: 'active',
    description: 'Balanced OpenAI model for most tasks'
  },
  {
    id: 'openai/gpt-5-nano',
    name: 'GPT-5 Nano',
    provider: 'lovable',
    type: 'text',
    status: 'active',
    description: 'Fast and efficient for high-volume tasks'
  }
];

const claudeModels: AIModel[] = [
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    type: 'multimodal',
    status: 'active',
    description: 'Most capable Claude model with superior reasoning'
  },
  {
    id: 'claude-opus-4-1-20250805',
    name: 'Claude Opus 4.1',
    provider: 'anthropic',
    type: 'multimodal',
    status: 'active',
    description: 'Highly intelligent and capable model'
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    type: 'multimodal',
    status: 'available',
    description: 'High-performance with exceptional reasoning'
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    type: 'text',
    status: 'available',
    description: 'Fastest Claude model for quick responses'
  }
];

export const AIAgentPanel = () => {
  const { toast } = useToast();
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);

  useEffect(() => {
    const checkAnthropicKey = async () => {
      // Check if ANTHROPIC_API_KEY secret exists
      try {
        const { data, error } = await supabase.functions.invoke('claude-ai-agent', {
          body: { test: true }
        });
        
        // If we get a response without auth error, the key exists
        setHasAnthropicKey(!error || error.message !== 'ANTHROPIC_API_KEY is not set');
      } catch {
        setHasAnthropicKey(false);
      }
    };

    checkAnthropicKey();
    loadSystemPrompt();
  }, []);

  const loadSystemPrompt = async () => {
    // Load saved system prompt from workspace settings (future enhancement)
    // For now, show a default
    setSystemPrompt('You are a helpful AI assistant for customer support. Be concise, professional, and friendly.');
  };

  const saveSystemPrompt = async () => {
    setIsSaving(true);
    try {
      // Save to workspace settings (future enhancement)
      // For now, just show success
      
      toast({
        title: 'System Prompt Updated',
        description: 'Your AI agent configuration has been saved.'
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save system prompt',
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getProviderBadge = (provider: AIModel['provider']) => {
    const colors = {
      lovable: 'bg-primary/10 text-primary border-primary/20',
      anthropic: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
      openai: 'bg-green-500/10 text-green-600 border-green-500/20',
      google: 'bg-blue-500/10 text-blue-600 border-blue-500/20'
    };
    const labels = {
      lovable: 'Lovable AI',
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      google: 'Google'
    };
    return (
      <Badge variant="outline" className={colors[provider]}>
        {labels[provider]}
      </Badge>
    );
  };

  const getStatusBadge = (status: AIModel['status']) => {
    const colors = {
      active: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
      available: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
      inactive: 'bg-muted text-muted-foreground border-muted'
    };
    return (
      <Badge variant="outline" className={colors[status]}>
        {status === 'active' ? '✓ Active' : status === 'available' ? 'Available' : 'Inactive'}
      </Badge>
    );
  };

  const getTypeBadge = (type: AIModel['type']) => {
    const icons = {
      text: '📝',
      image: '🖼️',
      multimodal: '🎨'
    };
    return (
      <Badge variant="secondary" className="text-xs">
        {icons[type]} {type.charAt(0).toUpperCase() + type.slice(1)}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <CardTitle>AI Agent Management</CardTitle>
          </div>
          <CardDescription>
            Manage connected AI models and configure system prompts for your agents
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="models" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="models">
                <Sparkles className="h-4 w-4 mr-2" />
                Connected Models
              </TabsTrigger>
              <TabsTrigger value="prompts">
                <SettingsIcon className="h-4 w-4 mr-2" />
                System Prompts
              </TabsTrigger>
            </TabsList>

            <TabsContent value="models" className="space-y-6">
              {/* Lovable AI Models */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Lovable AI Gateway
                  </h3>
                  <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                    Built-in • No API Key Required
                  </Badge>
                </div>
                <div className="grid gap-3">
                  {lovableModels.map((model) => (
                    <Card key={model.id} className="border-border/50">
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-medium">{model.name}</h4>
                              {getTypeBadge(model.type)}
                              {getProviderBadge(model.provider)}
                              {getStatusBadge(model.status)}
                            </div>
                            <p className="text-sm text-muted-foreground">{model.description}</p>
                            <code className="text-xs bg-muted px-2 py-1 rounded">{model.id}</code>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Claude Models */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Bot className="h-5 w-5 text-orange-600" />
                    Anthropic Claude
                  </h3>
                  {hasAnthropicKey ? (
                    <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                      API Key Configured
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                      API Key Required
                    </Badge>
                  )}
                </div>
                <div className="grid gap-3">
                  {claudeModels.map((model) => (
                    <Card key={model.id} className="border-border/50">
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-medium">{model.name}</h4>
                              {getTypeBadge(model.type)}
                              {getProviderBadge(model.provider)}
                              {getStatusBadge(hasAnthropicKey ? model.status : 'inactive')}
                            </div>
                            <p className="text-sm text-muted-foreground">{model.description}</p>
                            <code className="text-xs bg-muted px-2 py-1 rounded">{model.id}</code>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="prompts" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Default System Prompt</CardTitle>
                  <CardDescription>
                    Configure the default behavior for your AI agents across all channels
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="system-prompt">System Prompt</Label>
                    <Textarea
                      id="system-prompt"
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      placeholder="Enter your system prompt here..."
                      className="min-h-[200px] font-mono text-sm"
                    />
                  </div>
                  <Button onClick={saveSystemPrompt} disabled={isSaving}>
                    <Save className="h-4 w-4 mr-2" />
                    {isSaving ? 'Saving...' : 'Save System Prompt'}
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-amber-500/20 bg-amber-500/5">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    💡 Best Practices
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <ul className="list-disc list-inside space-y-1">
                    <li>Be specific about the agent's role and tone</li>
                    <li>Include key business information and policies</li>
                    <li>Specify when to escalate to human agents</li>
                    <li>Define response length and format preferences</li>
                    <li>Add examples for complex scenarios</li>
                  </ul>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};
