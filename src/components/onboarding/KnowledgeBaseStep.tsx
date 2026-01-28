import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, Loader2, CheckCircle2, Globe, AlertCircle, FileText, Sparkles } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

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

interface ScrapingJob {
  id: string;
  status: string;
  total_pages_found: number;
  pages_processed: number;
  faqs_found: number;
  faqs_stored: number;
  error_message: string | null;
}

type Status = 'idle' | 'starting' | 'scraping' | 'processing' | 'complete' | 'error';

export function KnowledgeBaseStep({ workspaceId, businessContext, onComplete, onBack }: KnowledgeBaseStepProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState({
    totalPages: 0,
    pagesProcessed: 0,
    faqsFound: 0,
    faqsStored: 0
  });
  const [error, setError] = useState<string | null>(null);

  // If no website URL, skip straight to complete
  useEffect(() => {
    if (!businessContext.websiteUrl) {
      setStatus('complete');
    } else {
      // Auto-start scraping
      startScraping();
    }
  }, []);

  // Subscribe to job updates
  useEffect(() => {
    if (!jobId) return;

    const channel = supabase
      .channel(`scraping-job-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'scraping_jobs',
          filter: `id=eq.${jobId}`
        },
        (payload) => {
          const job = payload.new as ScrapingJob;
          
          setProgress({
            totalPages: job.total_pages_found || 0,
            pagesProcessed: job.pages_processed || 0,
            faqsFound: job.faqs_found || 0,
            faqsStored: job.faqs_stored || 0
          });
          
          switch (job.status) {
            case 'scraping':
              setStatus('scraping');
              break;
            case 'processing':
              setStatus('processing');
              break;
            case 'completed':
              setStatus('complete');
              break;
            case 'failed':
              setStatus('error');
              setError(job.error_message || 'Something went wrong');
              break;
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  const startScraping = async () => {
    if (!businessContext.websiteUrl) return;
    
    setStatus('starting');
    setError(null);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('start-own-website-scrape', {
        body: {
          workspaceId,
          websiteUrl: businessContext.websiteUrl
        }
      });

      if (invokeError) {
        throw new Error(invokeError.message || 'Failed to start scraping');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to start scraping');
      }

      setJobId(data.jobId);
      setStatus('scraping');
    } catch (err: any) {
      console.error('Start scraping error:', err);
      setError(err.message || 'Something went wrong');
      setStatus('error');
    }
  };

  const handleRetry = () => {
    setError(null);
    setProgress({ totalPages: 0, pagesProcessed: 0, faqsFound: 0, faqsStored: 0 });
    startScraping();
  };

  const handleContinue = () => {
    onComplete({
      industryFaqs: 0,
      websiteFaqs: progress.faqsStored || progress.faqsFound
    });
  };

  const handleSkip = () => {
    onComplete({
      industryFaqs: 0,
      websiteFaqs: 0
    });
  };

  // Calculate progress percentage
  const calculateProgress = () => {
    if (status === 'starting') return 5;
    if (status === 'complete') return 100;
    if (status === 'error') return 0;
    
    if (status === 'scraping') {
      // Scraping phase: 0-40%
      return 10 + Math.min(30, progress.totalPages * 2);
    }
    
    if (status === 'processing') {
      // Processing phase: 40-100%
      if (progress.totalPages === 0) return 45;
      const processingProgress = (progress.pagesProcessed / progress.totalPages) * 60;
      return 40 + processingProgress;
    }
    
    return 0;
  };

  // Error state
  if (status === 'error') {
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
          <Button onClick={handleRetry} className="flex-1">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // Complete state
  if (status === 'complete') {
    const faqCount = progress.faqsStored || progress.faqsFound;
    
    return (
      <div className="space-y-6">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">
              {faqCount > 0 ? 'Knowledge base ready!' : 'Ready to continue'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {faqCount > 0 
                ? 'BizzyBee can now answer questions about your business'
                : 'You can add FAQs manually in Settings → Knowledge Base later'
              }
            </p>
          </div>
        </div>

        {faqCount > 0 && (
          <div className="bg-muted/30 rounded-lg p-6 text-center">
            <Globe className="h-8 w-8 mx-auto mb-3 text-green-600" />
            <div className="text-3xl font-bold text-green-600">{faqCount}</div>
            <div className="text-sm text-muted-foreground mt-1">FAQs extracted from your website</div>
            {progress.pagesProcessed > 0 && (
              <div className="text-xs text-muted-foreground mt-2">
                Analyzed {progress.pagesProcessed} pages
              </div>
            )}
          </div>
        )}

        {faqCount === 0 && businessContext.websiteUrl && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              We couldn't extract FAQs from your website, but that's okay! 
              You can add them manually in Settings → Knowledge Base.
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button onClick={handleContinue} className="flex-1">
            Continue
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  // Loading states
  const getStatusMessage = () => {
    switch (status) {
      case 'starting':
        return 'Connecting to your website...';
      case 'scraping':
        return progress.totalPages > 0 
          ? `Found ${progress.totalPages} pages to analyze...`
          : 'Discovering pages on your website...';
      case 'processing':
        return `Analyzing ${progress.pagesProcessed}/${progress.totalPages} pages...`;
      default:
        return 'Preparing...';
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">Learning from your website</h2>
        <p className="text-sm text-muted-foreground">
          This takes 1-3 minutes
        </p>
      </div>

      <Progress value={calculateProgress()} className="h-2" />

      <div className="space-y-4">
        {/* Scraping status */}
        <div className={`flex items-start gap-4 p-4 rounded-lg transition-colors ${
          status === 'scraping' || status === 'starting' ? 'bg-primary/5 border border-primary/20' : 'bg-muted/30'
        }`}>
          <div className="mt-0.5">
            {(status === 'scraping' || status === 'starting') ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : status === 'processing' ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : (
              <Globe className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1">
            <p className="font-medium">Scraping your website</p>
            <p className="text-xs text-muted-foreground truncate">
              {businessContext.websiteUrl}
            </p>
            {progress.totalPages > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {progress.totalPages} pages found
              </p>
            )}
          </div>
        </div>

        {/* Processing status */}
        <div className={`flex items-start gap-4 p-4 rounded-lg transition-colors ${
          status === 'processing' ? 'bg-primary/5 border border-primary/20' : 'bg-muted/30'
        }`}>
          <div className="mt-0.5">
            {status === 'processing' ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : (
              <FileText className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1">
            <p className="font-medium">Extracting FAQs</p>
            {status === 'processing' && (
              <p className="text-xs text-muted-foreground mt-1">
                {progress.pagesProcessed}/{progress.totalPages} pages • {progress.faqsFound} FAQs found
              </p>
            )}
          </div>
        </div>

        {/* AI Analysis indicator */}
        {status === 'processing' && progress.faqsFound > 0 && (
          <div className="flex items-center gap-2 justify-center text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            <span>AI is analyzing your content...</span>
          </div>
        )}
      </div>

      {/* Status message */}
      <div className="text-center text-sm text-muted-foreground">
        {getStatusMessage()}
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
