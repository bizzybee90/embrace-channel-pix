import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, Clock, Zap, Columns } from 'lucide-react';

interface TestResult {
  model: string;
  channel: string;
  latency: number;
  tokenUsage: any;
  isValidJson: boolean;
  response: any;
  rawResponse: string;
}

const TEST_SCENARIOS = [
  {
    name: 'Quote Request',
    channel: 'whatsapp',
    message: 'Hi, how much do you charge for window cleaning?'
  },
  {
    name: 'Appointment Query',
    channel: 'whatsapp',
    message: 'When is my next window clean?'
  },
  {
    name: 'Quality Complaint (Escalation)',
    channel: 'sms',
    message: 'Not impressed with yesterday\'s clean. Bathroom still had marks and kitchen floor wasn\'t mopped properly.'
  },
  {
    name: 'Payment Dispute (Camera Evidence)',
    channel: 'whatsapp',
    message: 'I\'ve just checked my Ring doorbell and your guy was only here for 10 minutes yesterday! I\'m not paying £28 for that.'
  },
  {
    name: 'Coverage Query',
    channel: 'web',
    message: 'Do you cover Bedford?'
  },
  {
    name: 'Simple Greeting',
    channel: 'whatsapp',
    message: 'Hi there!'
  },
  {
    name: 'Service Question',
    channel: 'email',
    message: 'What services do you offer? I need my gutters cleaned.'
  }
];

const MODELS = [
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (Recommended)', description: 'Most capable and intelligent' },
  { value: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1', description: 'Highly intelligent (expensive)' },
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', description: 'High-performance with exceptional reasoning' },
  { value: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet', description: 'Extended thinking capabilities' },
  { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', description: 'Fastest for quick responses' },
];

const CHANNELS = [
  { value: 'sms', label: 'SMS (≤160 chars)' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'web', label: 'Web Chat' },
  { value: 'email', label: 'Email' }
];

export default function AIComparisonTest() {
  const [model, setModel] = useState('claude-sonnet-4-5');
  const [channel, setChannel] = useState('whatsapp');
  const [customerMessage, setCustomerMessage] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [results, setResults] = useState<TestResult[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const runTest = async () => {
    if (!customerMessage.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a customer message',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-comparison-test', {
        body: { model, channel, customerMessage, systemPrompt: systemPrompt.trim() || undefined }
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      setResults([data, ...results]);

      toast({
        title: 'Test Complete',
        description: `${model} responded in ${data.latency}ms`
      });
    } catch (error: any) {
      console.error('Test error:', error);
      toast({
        title: 'Test Failed',
        description: error.message || 'Failed to run test',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const compareAllChannels = async () => {
    if (!customerMessage.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a customer message',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      // Run tests for all 4 channels in parallel
      const channelTests = CHANNELS.map(ch => 
        supabase.functions.invoke('ai-comparison-test', {
          body: { model, channel: ch.value, customerMessage, systemPrompt: systemPrompt.trim() || undefined }
        })
      );

      const responses = await Promise.all(channelTests);

      // Check for errors
      const errors = responses.filter(r => r.error);
      if (errors.length > 0) {
        throw new Error(`${errors.length} channel test(s) failed`);
      }

      // Add all results
      const newResults = responses.map(r => r.data).filter(d => d && !d.error);
      setResults([...newResults, ...results]);

      toast({
        title: 'Channel Comparison Complete',
        description: `Tested ${model} across all 4 channels`
      });
    } catch (error: any) {
      console.error('Comparison error:', error);
      toast({
        title: 'Comparison Failed',
        description: error.message || 'Failed to run comparison',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadScenario = (scenario: typeof TEST_SCENARIOS[0]) => {
    setChannel(scenario.channel);
    setCustomerMessage(scenario.message);
  };

  const checkSMSLength = (response: string) => {
    return response.length <= 160;
  };

  const checkEscalation = (result: TestResult) => {
    if (!result.isValidJson) return null;
    const shouldEscalate = result.response.escalate === true;
    const hasLowConfidence = result.response.confidence < 0.5;
    return shouldEscalate || hasLowConfidence;
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">AI Model Comparison Test</h1>
          <p className="text-muted-foreground">
            Test different Claude AI models with your MAC Cleaning customer service prompt
          </p>
        </div>

        {/* Test Scenarios */}
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Quick Test Scenarios</h3>
          <div className="flex flex-wrap gap-2">
            {TEST_SCENARIOS.map((scenario) => (
              <Button
                key={scenario.name}
                variant="outline"
                size="sm"
                onClick={() => loadScenario(scenario)}
              >
                {scenario.name}
              </Button>
            ))}
          </div>
        </Card>

        {/* System Prompt Editor */}
        <Card className="p-6">
          <details className="space-y-4">
            <summary className="cursor-pointer font-semibold text-lg mb-4">
              System Prompt {systemPrompt.trim() && <Badge variant="secondary" className="ml-2">Custom</Badge>}
            </summary>
            <div>
              <label className="text-sm font-medium mb-2 block">
                Custom System Prompt (leave blank to use default MAC Cleaning prompt)
              </label>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Enter a custom system prompt, or leave blank to use the default MAC Cleaning customer service prompt..."
                rows={8}
                className="font-mono text-xs"
              />
              {systemPrompt.trim() && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2"
                  onClick={() => setSystemPrompt('')}
                >
                  Reset to Default
                </Button>
              )}
            </div>
          </details>
        </Card>

        {/* Test Controls */}
        <Card className="p-6">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Model</label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        <div className="flex flex-col">
                          <span>{m.label}</span>
                          <span className="text-xs text-muted-foreground">{m.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Channel</label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Customer Message</label>
              <Textarea
                value={customerMessage}
                onChange={(e) => setCustomerMessage(e.target.value)}
                placeholder="Enter a test customer message..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Button onClick={runTest} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Run Test
                  </>
                )}
              </Button>
              
              <Button onClick={compareAllChannels} disabled={loading} variant="outline">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Comparing...
                  </>
                ) : (
                  <>
                    <Columns className="mr-2 h-4 w-4" />
                    Compare All Channels
                  </>
                )}
              </Button>
            </div>
          </div>
        </Card>

        {/* Results */}
        <div className="space-y-4">
          {results.map((result, idx) => (
            <Card key={idx} className="p-6">
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{result.model}</h3>
                    <p className="text-sm text-muted-foreground">Channel: {result.channel}</p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Badge variant={result.isValidJson ? 'default' : 'destructive'}>
                      {result.isValidJson ? (
                        <>
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Valid JSON
                        </>
                      ) : (
                        <>
                          <XCircle className="mr-1 h-3 w-3" />
                          Invalid JSON
                        </>
                      )}
                    </Badge>
                    <Badge variant="outline">
                      <Clock className="mr-1 h-3 w-3" />
                      {result.latency}ms
                    </Badge>
                  </div>
                </div>

                {/* Quality Checks */}
                {result.isValidJson && (
                  <div className="flex flex-wrap gap-2">
                    {result.channel === 'sms' && (
                      <Badge variant={checkSMSLength(result.response.response) ? 'default' : 'destructive'}>
                        SMS: {result.response.response.length} chars
                        {checkSMSLength(result.response.response) ? ' ✓' : ' ✗ (>160)'}
                      </Badge>
                    )}
                    
                    {checkEscalation(result) !== null && (
                      <Badge variant={checkEscalation(result) ? 'default' : 'secondary'}>
                        {checkEscalation(result) ? 'Escalated' : 'Not Escalated'}
                      </Badge>
                    )}

                    {result.response.confidence !== undefined && (
                      <Badge variant="outline">
                        Confidence: {(result.response.confidence * 100).toFixed(0)}%
                      </Badge>
                    )}

                    {result.response.intent && (
                      <Badge variant="secondary">
                        Intent: {result.response.intent}
                      </Badge>
                    )}
                  </div>
                )}

                {/* Response */}
                <div>
                  <h4 className="font-semibold text-sm mb-2">Customer Response:</h4>
                  <div className="bg-muted p-3 rounded-md">
                    {result.isValidJson ? (
                      <p className="text-sm whitespace-pre-wrap">{result.response.response}</p>
                    ) : (
                      <p className="text-sm text-destructive">Failed to parse JSON response</p>
                    )}
                  </div>
                </div>

                {/* Full JSON Response */}
                <details>
                  <summary className="cursor-pointer text-sm font-medium mb-2">
                    Full JSON Response
                  </summary>
                  <pre className="bg-muted p-3 rounded-md text-xs overflow-auto max-h-96">
                    {JSON.stringify(result.response, null, 2)}
                  </pre>
                </details>

                {/* Token Usage */}
                {result.tokenUsage && (
                  <div className="text-xs text-muted-foreground">
                    Tokens: {result.tokenUsage.input_tokens} input + {result.tokenUsage.output_tokens} output
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>

        {results.length === 0 && (
          <Card className="p-12 text-center">
            <p className="text-muted-foreground">
              No test results yet. Run a test to see how different models perform!
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}