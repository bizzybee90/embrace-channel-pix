import { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Brain, TrendingUp, TrendingDown, Minus, Star, RefreshCw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface CustomerIntelligenceProps {
  workspaceId: string;
  customerId: string;
  conversationId?: string;
}

interface CustomerData {
  id: string;
  name: string | null;
  email: string | null;
  vip_status: boolean;
  sentiment_trend: string | null;
  response_preference: string | null;
  topics_discussed: string[] | null;
  intelligence: {
    summary?: string;
    communication_patterns?: {
      typical_response_time?: string;
      message_length?: string;
      tone?: string;
    };
    lifetime_value_estimate?: string;
  } | null;
  last_analyzed_at: string | null;
}

interface CustomerInsight {
  id: string;
  insight_type: string;
  insight_text: string;
  confidence: number | null;
  created_at: string;
}

export const CustomerIntelligence = ({ workspaceId, customerId, conversationId }: CustomerIntelligenceProps) => {
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [insights, setInsights] = useState<CustomerInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const enrichAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [customerId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: customerData } = await supabase
        .from('customers')
        .select('id, name, email, vip_status, sentiment_trend, response_preference, topics_discussed, intelligence, last_analyzed_at')
        .eq('id', customerId)
        .single();

      const { data: insightsData } = await supabase
        .from('customer_insights')
        .select('id, insight_type, insight_text, confidence, created_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(10);

      const typedCustomer = customerData as CustomerData | null;
      setCustomer(typedCustomer);
      setInsights((insightsData || []) as CustomerInsight[]);

      // Auto-enrich if intelligence is empty and we haven't tried yet for this customer
      const intel = typedCustomer?.intelligence as CustomerData['intelligence'];
      const hasIntelligence = intel && Object.keys(intel).length > 0 && intel.summary;
      const hasInsights = (insightsData || []).length > 0;

      if (!hasIntelligence && !hasInsights && enrichAttemptedRef.current !== customerId) {
        enrichAttemptedRef.current = customerId;
        triggerEnrichment();
      }
    } catch (e) {
      console.error('Error fetching intelligence:', e);
    } finally {
      setLoading(false);
    }
  };

  const triggerEnrichment = async () => {
    setEnriching(true);
    try {
      // Find conversation to enrich from
      let convId = conversationId;
      if (!convId) {
        const { data: recentConv } = await supabase
          .from('conversations')
          .select('id')
          .eq('customer_id', customerId)
          .eq('workspace_id', workspaceId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();
        convId = recentConv?.id;
      }

      if (!convId) {
        setEnriching(false);
        return;
      }

      const { error } = await supabase.functions.invoke('ai-enrich-conversation', {
        body: {
          conversation_id: convId,
          customer_id: customerId,
          workspace_id: workspaceId,
        },
      });

      if (error) {
        console.error('Enrichment error:', error);
      } else {
        // Refresh data after enrichment
        await fetchData();
      }
    } catch (err) {
      console.error('Auto-enrichment error:', err);
    } finally {
      setEnriching(false);
    }
  };

  const handleManualRefresh = async () => {
    enrichAttemptedRef.current = null; // Reset so it can re-enrich
    setEnriching(true);
    try {
      let convId = conversationId;
      if (!convId) {
        const { data: recentConv } = await supabase
          .from('conversations')
          .select('id')
          .eq('customer_id', customerId)
          .eq('workspace_id', workspaceId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();
        convId = recentConv?.id;
      }

      if (!convId) {
        toast.info('No conversations found');
        setEnriching(false);
        return;
      }

      const { error } = await supabase.functions.invoke('ai-enrich-conversation', {
        body: {
          conversation_id: convId,
          customer_id: customerId,
          workspace_id: workspaceId,
        },
      });

      if (error) {
        toast.error('Refresh failed');
      } else {
        toast.success('Intelligence updated');
        await fetchData();
      }
    } catch (err) {
      toast.error('Refresh failed');
    } finally {
      setEnriching(false);
    }
  };

  const getSentimentIcon = (trend: string | null | undefined) => {
    switch (trend) {
      case 'positive': return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'negative': return <TrendingDown className="h-4 w-4 text-red-500" />;
      case 'declining': return <TrendingDown className="h-4 w-4 text-orange-500" />;
      default: return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getSentimentColor = (trend: string | null | undefined) => {
    switch (trend) {
      case 'positive': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'negative': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      case 'declining': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getInsightTypeColor = (type: string) => {
    switch (type) {
      case 'opportunity': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'risk': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      case 'preference': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'behavior': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const intelligence = customer?.intelligence as CustomerData['intelligence'];
  const hasContent = !!(intelligence?.summary || insights.length > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Brain className="h-5 w-5 text-primary" />
          Customer Intelligence
        </CardTitle>
        {hasContent && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={handleManualRefresh}
                disabled={enriching}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${enriching ? 'animate-spin' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Re-analyze customer</TooltipContent>
          </Tooltip>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Skeleton loader when enriching or no content */}
        {!hasContent && (
          <div className="space-y-4 animate-pulse">
            <div className="flex gap-2">
              <div className="h-5 w-16 bg-muted rounded-full" />
              <div className="h-5 w-20 bg-muted rounded-full" />
            </div>
            <div className="h-12 bg-muted rounded-lg" />
            <div className="space-y-2">
              <div className="h-4 w-3/4 bg-muted rounded" />
              <div className="h-4 w-1/2 bg-muted rounded" />
            </div>
            <div className="flex gap-1">
              <div className="h-5 w-14 bg-muted rounded-full" />
              <div className="h-5 w-18 bg-muted rounded-full" />
              <div className="h-5 w-12 bg-muted rounded-full" />
            </div>
            <p className="text-xs text-muted-foreground text-center pt-2">
              {enriching ? 'Analyzing customer…' : 'Building intelligence profile…'}
            </p>
          </div>
        )}

        {hasContent && (
          <>
            {/* Status Badges */}
            <div className="flex flex-wrap gap-2">
              {customer?.vip_status && (
                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                  <Star className="h-3 w-3 mr-1" />
                  VIP
                </Badge>
              )}
              <Badge variant="outline" className={getSentimentColor(customer?.sentiment_trend)}>
                {getSentimentIcon(customer?.sentiment_trend)}
                <span className="ml-1 capitalize">{customer?.sentiment_trend || 'Unknown'}</span>
              </Badge>
              {intelligence?.lifetime_value_estimate && (
                <Badge variant="outline" className="capitalize">
                  LTV: {intelligence.lifetime_value_estimate}
                </Badge>
              )}
              {customer?.response_preference && (
                <Badge variant="outline" className="capitalize">
                  {customer.response_preference}
                </Badge>
              )}
            </div>

            {/* Intelligence Summary */}
            {intelligence?.summary && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-sm text-muted-foreground">{intelligence.summary}</p>
              </div>
            )}

            {/* Communication Patterns */}
            {intelligence?.communication_patterns && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Communication Style
                </p>
                <div className="flex flex-wrap gap-1">
                  {intelligence.communication_patterns.tone && (
                    <Badge variant="secondary" className="text-xs capitalize">
                      {intelligence.communication_patterns.tone}
                    </Badge>
                  )}
                  {intelligence.communication_patterns.message_length && (
                    <Badge variant="secondary" className="text-xs capitalize">
                      {intelligence.communication_patterns.message_length} messages
                    </Badge>
                  )}
                  {intelligence.communication_patterns.typical_response_time && (
                    <Badge variant="secondary" className="text-xs capitalize">
                      Responds {intelligence.communication_patterns.typical_response_time}
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {/* Topics */}
            {customer?.topics_discussed && customer.topics_discussed.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Topics discussed
                </p>
                <div className="flex flex-wrap gap-1">
                  {customer.topics_discussed.map((topic: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {topic}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Insights */}
            {insights.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Recent Insights
                </p>
                <div className="space-y-2">
                  {insights.slice(0, 5).map((insight) => (
                    <div key={insight.id} className="rounded-lg border bg-card p-2.5">
                      <div className="flex items-start gap-2">
                        <Badge className={`${getInsightTypeColor(insight.insight_type)} text-xs capitalize shrink-0`}>
                          {insight.insight_type}
                        </Badge>
                        <p className="text-sm text-muted-foreground">{insight.insight_text}</p>
                      </div>
                      {insight.confidence && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Confidence: {Math.round(insight.confidence * 100)}%
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Last Analyzed */}
            {customer?.last_analyzed_at && (
              <p className="text-xs text-muted-foreground">
                Last analyzed: {new Date(customer.last_analyzed_at).toLocaleDateString()}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
