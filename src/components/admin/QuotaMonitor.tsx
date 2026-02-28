import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, Zap, Brain, Mail, Bot } from "lucide-react";

interface QuotaItem {
  provider: string;
  used: number;
  limit: number;
  period: string;
  icon: React.ReactNode;
  color: string;
}

export function QuotaMonitor() {
  const [quotas, setQuotas] = useState<QuotaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [usageByHour, setUsageByHour] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    fetchQuotas();
  }, []);

  const fetchQuotas = async () => {
    setLoading(true);
    try {
      // Fetch aggregated usage from last hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      
      const { data: usageData } = await supabase
        .from('api_usage')
        .select('provider, requests, tokens_used')
        .gte('created_at', oneHourAgo);

      // Aggregate by provider
      const aggregated: Record<string, { requests: number; tokens: number }> = {};
      (usageData || []).forEach(row => {
        if (!aggregated[row.provider]) {
          aggregated[row.provider] = { requests: 0, tokens: 0 };
        }
        aggregated[row.provider].requests += row.requests || 0;
        aggregated[row.provider].tokens += row.tokens_used || 0;
      });

      // Create quota items with estimated limits
      const quotaItems: QuotaItem[] = [
        {
          provider: 'Gemini',
          used: aggregated['gemini']?.requests || 0,
          limit: 1000,
          period: 'per minute',
          icon: <Brain className="h-5 w-5" />,
          color: 'text-blue-500',
        },
        {
          provider: 'Lovable Gateway',
          used: aggregated['lovable']?.requests || 0,
          limit: 500,
          period: 'per hour',
          icon: <Zap className="h-5 w-5" />,
          color: 'text-purple-500',
        },
        {
          provider: 'Aurinko',
          used: aggregated['aurinko']?.requests || 0,
          limit: 600,
          period: 'per minute',
          icon: <Mail className="h-5 w-5" />,
          color: 'text-orange-500',
        },
        {
          provider: 'OpenAI',
          used: aggregated['openai']?.requests || 0,
          limit: 1000,
          period: 'per minute',
          icon: <Bot className="h-5 w-5" />,
          color: 'text-green-500',
        },
      ];

      setQuotas(quotaItems);

      // Fetch hourly breakdown
      const { data: hourlyData } = await supabase
        .from('api_usage')
        .select('provider, requests, tokens_used, created_at')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(100);

      setUsageByHour(hourlyData || []);
    } catch (error) {
      console.error('Error fetching quotas:', error);
    } finally {
      setLoading(false);
    }
  };

  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">API Quota Monitor</CardTitle>
        <Button variant="ghost" size="sm" onClick={fetchQuotas} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {quotas.map((quota) => {
            const percentage = (quota.used / quota.limit) * 100;
            
            return (
              <Card key={quota.provider} className="bg-muted/30">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className={quota.color}>{quota.icon}</div>
                    <div>
                      <h4 className="font-medium">{quota.provider}</h4>
                      <p className="text-xs text-muted-foreground">{quota.period}</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{quota.used.toLocaleString()} used</span>
                      <span className="text-muted-foreground">{quota.limit.toLocaleString()} limit</span>
                    </div>
                    <Progress 
                      value={Math.min(percentage, 100)} 
                      className={`h-2 ${getUsageColor(percentage)}`}
                    />
                    <p className="text-xs text-right text-muted-foreground">
                      {percentage.toFixed(1)}% utilized
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Recent Usage Table */}
        <div>
          <h4 className="font-medium mb-3">Recent API Calls (Last 24h)</h4>
          {usageByHour.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No API usage data recorded yet. Usage will appear here as edge functions make API calls.
            </p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2">Provider</th>
                    <th className="text-left p-2">Requests</th>
                    <th className="text-left p-2">Tokens</th>
                    <th className="text-left p-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {usageByHour.slice(0, 10).map((row, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-2 font-mono text-xs">{String(row.provider)}</td>
                      <td className="p-2">{String(row.requests)}</td>
                      <td className="p-2">{String(row.tokens_used)}</td>
                      <td className="p-2 text-muted-foreground">
                        {new Date(String(row.created_at)).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
