import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, RotateCcw, Globe, FileText } from 'lucide-react';
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

type Status = 'checking' | 'idle' | 'already_done' | 'starting' | 'running' | 'complete' | 'error';

interface ExistingKnowledge {
  faqCount: number;
  pagesScraped: number;
  scrapedAt: string | null;
}

export function KnowledgeBaseStep({ workspaceId, businessContext, onComplete, onBack }: KnowledgeBaseStepProps) {
  const [status, setStatus] = useState<Status>('checking');
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState({ faqsExtracted: 0, pagesScraped: 0 });
  const [existingKnowledge, setExistingKnowledge] = useState<ExistingKnowledge | null>(null);

  // Check if we already have website knowledge
  useEffect(() => {
    const checkExisting = async () => {
      if (!businessContext.websiteUrl) {
        setStatus('idle');
        return;
      }

      try {
        // Check for existing completed scraping job
        const { data: job } = await supabase
          .from('scraping_jobs')
          .select('id, status, faqs_found, pages_processed, completed_at')
          .eq('workspace_id', workspaceId)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (job && job.faqs_found > 0) {
          setExistingKnowledge({
            faqCount: job.faqs_found,
            pagesScraped: job.pages_processed || 0,
            scrapedAt: job.completed_at,
          });
          setStatus('already_done');
          return;
        }

        // Check for FAQs from website source
        // @ts-ignore - Supabase types cause deep instantiation errors
        const faqResult = await supabase.from('faq_database').select('id').eq('workspace_id', workspaceId).eq('source', 'website').limit(100);
        const faqs = faqResult?.data as Array<{ id: string }> | null;

        const faqCount = faqs?.length || 0;

        if (faqCount > 0) {
          setExistingKnowledge({
            faqCount,
            pagesScraped: 0,
            scrapedAt: null,
          });
          setStatus('already_done');
          return;
        }

        // No existing knowledge, show idle state
        setStatus('idle');
      } catch (err) {
        console.error('Error checking existing knowledge:', err);
        setStatus('idle');
      }
    };

    checkExisting();
  }, [workspaceId, businessContext.websiteUrl]);

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

  const handleContinueWithExisting = () => {
    onComplete({
      industryFaqs: 0,
      websiteFaqs: existingKnowledge?.faqCount || 0
    });
  };

  // Checking state
  if (status === 'checking') {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">Checking existing knowledge...</h2>
          <p className="text-sm text-muted-foreground">
            Just a moment
          </p>
        </div>
      </div>
    );
  }

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

  // Already done state - website knowledge exists
  if (status === 'already_done' && existingKnowledge) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-8 w-8 text-success" />
          </div>
          <h2 className="text-xl font-semibold">Website Knowledge Ready</h2>
          <p className="text-sm text-muted-foreground">
            We already have knowledge from your website
          </p>
        </div>

        <div className="bg-success/5 border border-success/20 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-success" />
              <div>
                <p className="font-medium">{businessContext.websiteUrl}</p>
                <p className="text-sm text-muted-foreground">
                  {existingKnowledge.faqCount} FAQs extracted
                  {existingKnowledge.pagesScraped > 0 && ` from ${existingKnowledge.pagesScraped} pages`}
                </p>
              </div>
            </div>
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button 
            variant="outline" 
            onClick={() => {
              setExistingKnowledge(null);
              setStatus('idle');
            }}
            className="flex-1 gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Re-scrape
          </Button>
          <Button onClick={handleContinueWithExisting} className="flex-1">
            Continue
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  // Idle state - ready to start (no website URL or user chose to re-scrape)
  if (status === 'idle') {
    if (!businessContext.websiteUrl) {
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

    // Has website URL, show start button
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <Globe className="h-12 w-12 text-primary mx-auto" />
          <h2 className="text-xl font-semibold">Extract Website Knowledge</h2>
          <p className="text-sm text-muted-foreground">
            We'll scrape your website to extract FAQs, pricing, and services
          </p>
        </div>

        <div className="bg-muted/30 border rounded-lg p-4">
          <div className="flex items-center gap-3">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <p className="font-medium">{businessContext.websiteUrl}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button variant="ghost" onClick={handleSkip} className="flex-1 text-muted-foreground">
            Skip this step
          </Button>
          <Button onClick={() => startScraping()} className="flex-1">
            Start Scraping
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
