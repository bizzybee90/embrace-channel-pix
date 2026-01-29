import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { WebsitePipelineProgress } from './WebsitePipelineProgress';

interface KnowledgeBaseStepProps {
  workspaceId: string;
  businessContext: {
    companyName: string;
    businessType: string;
    websiteUrl?: string;
  };
  onComplete: (results: { industryFaqs: number; websiteFaqs: number }) => void;
  onBack: () => void;
}

type Status = 'idle' | 'starting' | 'running' | 'complete' | 'error';

export function KnowledgeBaseStep({ workspaceId, businessContext, onComplete, onBack }: KnowledgeBaseStepProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState({ faqsExtracted: 0, pagesScraped: 0 });

  // If no website URL, skip straight to complete
  useEffect(() => {
    if (!businessContext.websiteUrl) {
      setStatus('complete');
    } else {
      // Auto-start scraping
      startScraping();
    }
  }, []);

  const startScraping = async (opts?: { provider?: 'apify' | 'firecrawl' }) => {
    if (!businessContext.websiteUrl) return;
    
    setStatus('starting');
    setError(null);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('start-own-website-scrape', {
        body: {
          workspaceId,
          websiteUrl: businessContext.websiteUrl,
          ...(opts?.provider ? { forceProvider: opts.provider } : {}),
        }
      });

      if (invokeError) {
        throw new Error(invokeError.message || 'Failed to start scraping');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to start scraping');
      }

      setJobId(data.jobId);
      setStatus('running');
    } catch (err: any) {
      console.error('Start scraping error:', err);
      setError(err.message || 'Something went wrong');
      setStatus('error');
    }
  };

  const handleRetry = (opts?: { provider?: 'apify' | 'firecrawl' }) => {
    setError(null);
    setResults({ faqsExtracted: 0, pagesScraped: 0 });
    startScraping(opts);
  };

  const handlePipelineComplete = (pipelineResults: { faqsExtracted: number; pagesScraped: number }) => {
    setResults(pipelineResults);
    onComplete({
      industryFaqs: 0,
      websiteFaqs: pipelineResults.faqsExtracted
    });
  };

  const handleSkip = () => {
    onComplete({
      industryFaqs: 0,
      websiteFaqs: 0
    });
  };


  // Show pipeline progress when job is running
  if (status === 'running' && jobId && businessContext.websiteUrl) {
    return (
      <WebsitePipelineProgress
        workspaceId={workspaceId}
        jobId={jobId}
        websiteUrl={businessContext.websiteUrl}
        onComplete={handlePipelineComplete}
        onBack={onBack}
        onRetry={handleRetry}
      />
    );
  }

  // Complete state (no website URL provided)
  if (status === 'complete') {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">Ready to continue</h2>
          <p className="text-sm text-muted-foreground">
            You can add FAQs manually in Settings → Knowledge Base later
          </p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button onClick={() => onComplete({ industryFaqs: 0, websiteFaqs: 0 })} className="flex-1">
            Continue
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  // Starting state
  if (status === 'starting') {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">Connecting to your website...</h2>
          <p className="text-sm text-muted-foreground">
            This will just take a moment
          </p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button variant="ghost" onClick={handleSkip} className="flex-1 text-muted-foreground">
            Skip this step
          </Button>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
          <AlertCircle className="h-8 w-8 text-destructive" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            {error || 'We couldn\'t scrape your website. You can add FAQs manually later.'}
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button variant="outline" onClick={handleSkip} className="flex-1">
          Skip for now
        </Button>
        <Button onClick={() => handleRetry()} className="flex-1">
          Try Again
        </Button>
      </div>
    </div>
  );
}
