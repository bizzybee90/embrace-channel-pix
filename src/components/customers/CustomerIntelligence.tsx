import { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Brain, TrendingUp, TrendingDown, Minus, Star, RefreshCw, MessageSquare, Clock, Hash } from 'lucide-react';
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
        await fetchData();
      }
    } catch (err) {
      console.error('Auto-enrichment error:', err);
    } finally {
      setEnriching(false);
    }
  };

  const handleManualRefresh = async () => {
    enrichAttemptedRef.current = null;
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

  const getSentimentLabel = (trend: string | null | undefined) => {
    switch (trend) {
      case 'positive': return 'Positive';
      case 'negative': return 'Negative';
      case 'declining': return 'Declining';
      default: return 'Neutral';
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

  const getInitials = (name: string | null, email: string | null) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    if (email) return email[0].toUpperCase();
    return '?';
  };

  // ── Loading state: structured skeleton ──
  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 space-y-5">
          {/* Avatar skeleton */}
          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 rounded-full bg-muted animate-pulse" />
            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
            <div className="h-3 w-40 bg-muted rounded animate-pulse" />
          </div>
          {/* Summary skeleton */}
          <div className="space-y-2 px-2">
            <div className="h-3 w-full bg-muted rounded animate-pulse" />
            <div className="h-3 w-4/5 bg-muted rounded animate-pulse" />
            <div className="h-3 w-3/5 bg-muted rounded animate-pulse" />
          </div>
          {/* Pills skeleton */}
          <div className="flex gap-2 justify-center">
            <div className="h-6 w-16 bg-muted rounded-full animate-pulse" />
            <div className="h-6 w-20 bg-muted rounded-full animate-pulse" />
          </div>
          <p className="text-xs text-center font-medium bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-500 animate-pulse">
            ✨ AI analyzing customer history...
          </p>
        </CardContent>
      </Card>
    );
  }

  const intelligence = customer?.intelligence as CustomerData['intelligence'];
  const hasContent = !!(intelligence?.summary || insights.length > 0);

  // ── Enriching state (no content yet): structured skeleton ──
  if (!hasContent) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5 text-primary" />
            Customer Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 rounded-full bg-muted animate-pulse" />
            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
            <div className="h-3 w-40 bg-muted rounded animate-pulse" />
          </div>
          <div className="space-y-2 px-2">
            <div className="h-3 w-full bg-muted rounded animate-pulse" />
            <div className="h-3 w-4/5 bg-muted rounded animate-pulse" />
            <div className="h-3 w-3/5 bg-muted rounded animate-pulse" />
          </div>
          <div className="flex gap-2 justify-center">
            <div className="h-6 w-16 bg-muted rounded-full animate-pulse" />
            <div className="h-6 w-20 bg-muted rounded-full animate-pulse" />
          </div>
          <p className="text-xs text-center font-medium bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-500 animate-pulse">
            {enriching ? '✨ AI analyzing customer history...' : '✨ Building intelligence profile...'}
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Loaded state: premium CRM bento box ──
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Brain className="h-5 w-5 text-primary" />
          Customer Intelligence
        </CardTitle>
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
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Avatar + Name Header */}
        <div className="flex flex-col items-center gap-2">
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold shadow-lg">
            {getInitials(customer?.name ?? null, customer?.email ?? null)}
          </div>
          <div className="text-center">
            <p className="font-semibold text-foreground text-base">
              {customer?.name || 'Unknown Customer'}
            </p>
            {customer?.email && (
              <p className="text-sm text-muted-foreground">{customer.email}</p>
            )}
          </div>
          {/* Status row */}
          <div className="flex flex-wrap gap-1.5 justify-center">
            {customer?.vip_status && (
              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                <Star className="h-3 w-3 mr-1" />
                VIP
              </Badge>
            )}
            {intelligence?.lifetime_value_estimate && (
              <Badge variant="outline" className="capitalize text-xs">
                LTV: {intelligence.lifetime_value_estimate}
              </Badge>
            )}
          </div>
        </div>

        {/* AI Summary — blockquote style */}
        {intelligence?.summary && (
          <div className="bg-accent/40 dark:bg-accent/20 p-4 rounded-xl text-sm text-foreground/80 leading-relaxed border border-border/50">
            {intelligence.summary}
          </div>
        )}

        {/* Bento sections */}
        <div className="space-y-4">
          {/* Communication Style */}
          {intelligence?.communication_patterns && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Communication Style
              </p>
              <div className="flex flex-wrap gap-1.5">
                {intelligence.communication_patterns.tone && (
                  <span className="inline-flex items-center gap-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800/40 px-2 py-1 rounded-md text-xs font-medium">
                    <MessageSquare className="h-3 w-3" />
                    {intelligence.communication_patterns.tone}
                  </span>
                )}
                {intelligence.communication_patterns.message_length && (
                  <span className="inline-flex items-center gap-1 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border border-purple-100 dark:border-purple-800/40 px-2 py-1 rounded-md text-xs font-medium">
                    <Hash className="h-3 w-3" />
                    {intelligence.communication_patterns.message_length} messages
                  </span>
                )}
                {intelligence.communication_patterns.typical_response_time && (
                  <span className="inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-100 dark:border-amber-800/40 px-2 py-1 rounded-md text-xs font-medium">
                    <Clock className="h-3 w-3" />
                    {intelligence.communication_patterns.typical_response_time}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Sentiment */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Sentiment
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`${getSentimentColor(customer?.sentiment_trend)} text-xs`}>
                {getSentimentIcon(customer?.sentiment_trend)}
                <span className="ml-1">{getSentimentLabel(customer?.sentiment_trend)}</span>
              </Badge>
            </div>
          </div>

          {/* Topics — colored tag pills */}
          {customer?.topics_discussed && customer.topics_discussed.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Topics
              </p>
              <div className="flex flex-wrap gap-1.5">
                {customer.topics_discussed.map((topic: string, i: number) => (
                  <span
                    key={i}
                    className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800/40 px-2 py-1 rounded-md text-xs font-medium"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Insights */}
        {insights.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Insights
            </p>
            <div className="space-y-2">
              {insights.slice(0, 5).map((insight) => (
                <div key={insight.id} className="rounded-xl border bg-card p-2.5">
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
          <p className="text-xs text-muted-foreground text-center">
            Last analyzed: {new Date(customer.last_analyzed_at).toLocaleDateString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
