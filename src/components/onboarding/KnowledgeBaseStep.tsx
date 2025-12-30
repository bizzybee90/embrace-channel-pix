import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, Loader2, CheckCircle2, Globe, AlertCircle } from 'lucide-react';
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

type Status = 'idle' | 'scraping' | 'complete' | 'error';

export function KnowledgeBaseStep({ workspaceId, businessContext, onComplete, onBack }: KnowledgeBaseStepProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [websiteFaqsGenerated, setWebsiteFaqsGenerated] = useState(0);
  const [pagesScraped, setPagesScraped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    startKnowledgeBaseGeneration();
  }, []);

  const startKnowledgeBaseGeneration = async () => {
    // If no website URL, skip straight to complete
    if (!businessContext.websiteUrl) {
      console.log('No website URL provided, skipping scraping');
      setStatus('complete');
      setProgress(100);
      return;
    }

    setStatus('scraping');
    setProgress(20);

    try {
      console.log('Scraping website:', businessContext.websiteUrl);
      
      // Simulate progress while scraping
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 5, 90));
      }, 3000);

      const scrapeResult = await supabase.functions.invoke('scrape-customer-website', {
        body: { 
          workspaceId, 
          websiteUrl: businessContext.websiteUrl,
          businessName: businessContext.companyName,
          businessType: businessContext.businessType
        }
      });

      clearInterval(progressInterval);

      if (scrapeResult.error) {
        console.error('Error scraping website:', scrapeResult.error);
        throw new Error(scrapeResult.error.message || 'Failed to scrape website');
      }

      const websiteGenerated = scrapeResult.data?.faqsGenerated || 0;
      const pages = scrapeResult.data?.pagesScraped || 0;
      
      console.log(`Scraping complete: ${pages} pages, ${websiteGenerated} FAQs`);
      
      setWebsiteFaqsGenerated(websiteGenerated);
      setPagesScraped(pages);
      setProgress(100);
      setStatus('complete');

    } catch (err: any) {
      console.error('Knowledge base generation error:', err);
      setError(err.message || 'Something went wrong');
      setStatus('error');
    }
  };

  const handleRetry = () => {
    setError(null);
    setWebsiteFaqsGenerated(0);
    setPagesScraped(0);
    setProgress(0);
    startKnowledgeBaseGeneration();
  };

  const handleContinue = () => {
    onComplete({
      industryFaqs: 0, // No industry templates for now
      websiteFaqs: websiteFaqsGenerated
    });
  };

  const handleSkip = () => {
    onComplete({
      industryFaqs: 0,
      websiteFaqs: 0
    });
  };

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

  if (status === 'complete') {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">
              {websiteFaqsGenerated > 0 ? 'Knowledge base ready!' : 'Ready to continue'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {websiteFaqsGenerated > 0 
                ? 'BizzyBee can now answer questions about your business'
                : 'You can add FAQs manually in Settings → Knowledge Base later'
              }
            </p>
          </div>
        </div>

        {websiteFaqsGenerated > 0 && (
          <div className="bg-muted/30 rounded-lg p-6 text-center">
            <Globe className="h-8 w-8 mx-auto mb-3 text-green-600" />
            <div className="text-3xl font-bold text-green-600">{websiteFaqsGenerated}</div>
            <div className="text-sm text-muted-foreground mt-1">FAQs extracted from your website</div>
            {pagesScraped > 0 && (
              <div className="text-xs text-muted-foreground mt-2">
                Analyzed {pagesScraped} pages
              </div>
            )}
          </div>
        )}

        {websiteFaqsGenerated === 0 && businessContext.websiteUrl && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              We couldn't extract FAQs from your website, but that's okay! 
              You can add them manually in Settings → Knowledge Base.
            </p>
          </div>
        )}

        <Button onClick={handleContinue} className="w-full">
          Continue
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    );
  }

  // Loading state - website scraping
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">Learning from your website</h2>
        <p className="text-sm text-muted-foreground">
          This takes 1-2 minutes
        </p>
      </div>

      <Progress value={progress} className="h-2" />

      <div className="space-y-4">
        <div className="flex items-start gap-4 p-4 bg-muted/30 rounded-lg">
          <div className="mt-0.5">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-medium">Scraping your website...</p>
            <p className="text-xs text-muted-foreground truncate">
              {businessContext.websiteUrl}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Extracting prices, services, policies, and FAQs
            </p>
          </div>
        </div>
      </div>

      <Button variant="ghost" onClick={handleSkip} className="w-full text-muted-foreground">
        Skip this step
      </Button>
    </div>
  );
}
