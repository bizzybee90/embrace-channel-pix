import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Globe, CheckCircle2, XCircle, Loader2, StopCircle } from 'lucide-react';

interface CompetitorSite {
  id: string;
  domain: string;
  business_name: string | null;
  url: string;
}

interface SiteResult {
  siteId: string;
  domain: string;
  success: boolean;
  faqsFound?: number;
  faqsValidated?: number;
  faqsAdded?: number;
  error?: string;
}

interface MiningResults {
  sitesProcessed: number;
  totalFaqsFound: number;
  totalFaqsValidated: number;
  totalFaqsAdded: number;
}

interface CompetitorMiningLoopProps {
  workspaceId: string;
  jobId: string;
  competitors: CompetitorSite[];
  onComplete: (results: MiningResults) => void;
  onCancel: () => void;
}

export function CompetitorMiningLoop({
  workspaceId,
  jobId,
  competitors,
  onComplete,
  onCancel
}: CompetitorMiningLoopProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<SiteResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(true);
  const [currentDomain, setCurrentDomain] = useState<string | null>(null);

  const mineCurrentSite = useCallback(async () => {
    if (!isProcessing || currentIndex >= competitors.length) return;
    
    const site = competitors[currentIndex];
    setCurrentDomain(site.domain);

    try {
      const { data, error } = await supabase.functions.invoke('kb-mine-site', {
        body: {
          site_id: site.id,
          workspace_id: workspaceId,
          job_id: jobId
        }
      });

      if (error) throw error;

      setResults(prev => [...prev, {
        siteId: site.id,
        domain: site.domain,
        success: data?.success ?? true,
        faqsFound: data?.faqs_found ?? 0,
        faqsValidated: data?.faqs_validated ?? 0,
        faqsAdded: data?.faqs_added ?? 0
      }]);
    } catch (err: any) {
      console.error('Mining error for', site.domain, err);
      setResults(prev => [...prev, {
        siteId: site.id,
        domain: site.domain,
        success: false,
        error: err.message || 'Unknown error'
      }]);
    }

    setCurrentIndex(prev => prev + 1);
  }, [currentIndex, competitors, isProcessing, workspaceId, jobId]);

  // Process one competitor at a time
  useEffect(() => {
    if (isProcessing && currentIndex < competitors.length) {
      mineCurrentSite();
    }
  }, [currentIndex, isProcessing, competitors.length, mineCurrentSite]);

  // Auto-complete when done
  useEffect(() => {
    if (currentIndex >= competitors.length && results.length === competitors.length) {
      setCurrentDomain(null);
      onComplete({
        sitesProcessed: results.filter(r => r.success).length,
        totalFaqsFound: results.reduce((sum, r) => sum + (r.faqsFound || 0), 0),
        totalFaqsValidated: results.reduce((sum, r) => sum + (r.faqsValidated || 0), 0),
        totalFaqsAdded: results.reduce((sum, r) => sum + (r.faqsAdded || 0), 0)
      });
    }
  }, [currentIndex, results, competitors.length, onComplete]);

  const handleStop = () => {
    setIsProcessing(false);
    onCancel();
  };

  const progressPercent = competitors.length > 0
    ? Math.round((currentIndex / competitors.length) * 100)
    : 0;

  const totalFaqsFound = results.reduce((sum, r) => sum + (r.faqsFound || 0), 0);
  const totalValidated = results.reduce((sum, r) => sum + (r.faqsValidated || 0), 0);
  const totalAdded = results.reduce((sum, r) => sum + (r.faqsAdded || 0), 0);

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Mining competitor websites...
          </span>
          <span className="font-medium">{currentIndex}/{competitors.length}</span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* Current site indicator */}
      {currentDomain && (
        <div className="flex items-center gap-2 text-sm">
          <Globe className="h-4 w-4 animate-spin text-primary" />
          <span>Processing: <strong>{currentDomain}</strong></span>
        </div>
      )}

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-muted/30">
          <CardContent className="p-3 text-center">
            <div className="text-xl font-bold">{totalFaqsFound}</div>
            <div className="text-xs text-muted-foreground">Found</div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-3 text-center">
            <div className="text-xl font-bold text-amber-600">{totalValidated}</div>
            <div className="text-xs text-muted-foreground">Validated</div>
          </CardContent>
        </Card>
        <Card className="bg-green-50 dark:bg-green-950/20">
          <CardContent className="p-3 text-center">
            <div className="text-xl font-bold text-green-600">{totalAdded}</div>
            <div className="text-xs text-muted-foreground">Added</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent results */}
      {results.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {results.slice(-5).reverse().map((result) => (
            <div
              key={result.siteId}
              className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded"
            >
              <div className="flex items-center gap-2">
                {result.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span className="truncate max-w-[150px]">{result.domain}</span>
              </div>
              {result.success ? (
                <Badge variant="secondary" className="text-xs">
                  +{result.faqsAdded || 0} FAQs
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-xs">
                  Failed
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Stop button */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleStop}
        className="w-full"
        disabled={!isProcessing}
      >
        <StopCircle className="h-4 w-4 mr-2" />
        Stop Mining
      </Button>
    </div>
  );
}
