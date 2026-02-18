import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Lightbulb, TrendingUp, AlertTriangle, Info, RefreshCw, Loader2, X, Sparkles } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface Insight {
  id: string;
  insight_type: string | null;
  title: string | null;
  description: string | null;
  severity: string | null;
  is_actionable: boolean | null;
  is_read: boolean | null;
  created_at: string | null;
  metrics?: Record<string, unknown> | null;
}

interface InsightsWidgetProps {
  workspaceId: string;
}

export const InsightsWidget = ({ workspaceId }: InsightsWidgetProps) => {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (workspaceId) {
      fetchInsights();
    }
  }, [workspaceId]);

  const fetchInsights = async () => {
    try {
      const { data } = await supabase
        .from('inbox_insights')
        .select('id, insight_type, title, description, severity, is_actionable, is_read, created_at, metrics')
        .eq('workspace_id', workspaceId)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(5);
      
      setInsights((data as Insight[]) || []);
    } catch (error) {
      console.error('Error fetching insights:', error);
    } finally {
      setLoading(false);
    }
  };

  const runAnalysis = async () => {
    // pattern-detect edge function has been removed; no-op
    toast.info('Pattern detection has been migrated to n8n workflows.');
  };

  const markAsRead = async (id: string) => {
    await supabase
      .from('inbox_insights')
      .update({ is_read: true })
      .eq('id', id);
    setInsights(insights.filter(i => i.id !== id));
  };

  const getIcon = (type: string, severity: string) => {
    if (severity === 'critical') return <AlertTriangle className="h-4 w-4 text-destructive" />;
    if (severity === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    if (type === 'trend' || type === 'category_trend') return <TrendingUp className="h-4 w-4 text-primary" />;
    if (type === 'opportunity' || type === 'automation_opportunity') return <Lightbulb className="h-4 w-4 text-yellow-500" />;
    if (type === 'summary') return <Sparkles className="h-4 w-4 text-primary" />;
    return <Info className="h-4 w-4 text-muted-foreground" />;
  };

  const getSeverityClass = (severity: string) => {
    switch (severity) {
      case 'critical': return 'border-l-destructive bg-destructive/5';
      case 'warning': return 'border-l-amber-500 bg-amber-500/5';
      default: return 'border-l-primary/50 bg-muted/30';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lightbulb className="h-4 w-4" />
            Insights
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-4 w-4 text-primary" />
          Insights
        </CardTitle>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={runAnalysis}
          disabled={analyzing}
          className="h-8 w-8 p-0"
        >
          {analyzing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {insights.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Lightbulb className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No new insights</p>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={runAnalysis}
              disabled={analyzing}
              className="mt-3"
            >
              {analyzing ? 'Analyzing...' : 'Run Analysis'}
            </Button>
          </div>
        ) : (
          insights.map(insight => (
            <div
              key={insight.id}
              className={`relative p-3 rounded-lg border-l-4 ${getSeverityClass(insight.severity)} transition-all hover:shadow-sm`}
            >
              <button
                onClick={() => markAsRead(insight.id)}
                className="absolute top-2 right-2 p-1 rounded-full hover:bg-muted/80 transition-colors"
                aria-label="Dismiss insight"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
              
              <div className="flex items-start gap-2 pr-6">
                <div className="mt-0.5">
                  {getIcon(insight.insight_type, insight.severity)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm leading-tight">
                    {insight.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {insight.description}
                  </p>
                  {insight.is_actionable && (
                    <Badge variant="outline" className="mt-2 text-xs">
                      Action needed
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};
