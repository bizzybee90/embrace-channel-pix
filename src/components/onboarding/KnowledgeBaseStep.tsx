import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, Loader2, CheckCircle2, BookOpen, Globe, AlertCircle, Database } from 'lucide-react';
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

type Status = 'idle' | 'copying' | 'scraping' | 'complete' | 'error';

export function KnowledgeBaseStep({ workspaceId, businessContext, onComplete, onBack }: KnowledgeBaseStepProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [industryFaqsCopied, setIndustryFaqsCopied] = useState(0);
  const [websiteFaqsGenerated, setWebsiteFaqsGenerated] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    startKnowledgeBaseGeneration();
  }, []);

  const startKnowledgeBaseGeneration = async () => {
    setStatus('copying');
    setProgress(10);

    try {
      // Map business type to industry type slug
      const industryType = businessContext.businessType
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');

      // Step 1: Copy industry FAQs
      console.log('Copying industry FAQs for:', industryType);
      const copyResult = await supabase.functions.invoke('copy-industry-faqs', {
        body: { 
          workspaceId, 
          industryType 
        }
      });

      if (copyResult.error) {
        console.error('Error copying industry FAQs:', copyResult.error);
      }
      
      const industryCopied = copyResult.data?.faqsCopied || 0;
      setIndustryFaqsCopied(industryCopied);
      setProgress(40);

      // Step 2: Scrape website (if URL provided)
      if (businessContext.websiteUrl) {
        setStatus('scraping');
        console.log('Scraping website:', businessContext.websiteUrl);
        
        const scrapeResult = await supabase.functions.invoke('scrape-customer-website', {
          body: { 
            workspaceId, 
            websiteUrl: businessContext.websiteUrl,
            businessName: businessContext.companyName,
            businessType: businessContext.businessType
          }
        });

        if (scrapeResult.error) {
          console.error('Error scraping website:', scrapeResult.error);
        }

        const websiteGenerated = scrapeResult.data?.faqsGenerated || 0;
        setWebsiteFaqsGenerated(websiteGenerated);
      }

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
    setIndustryFaqsCopied(0);
    setWebsiteFaqsGenerated(0);
    setProgress(0);
    startKnowledgeBaseGeneration();
  };

  const handleContinue = () => {
    onComplete({
      industryFaqs: industryFaqsCopied,
      websiteFaqs: websiteFaqsGenerated
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
              {error || 'We couldn\'t build your knowledge base. Please try again.'}
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button onClick={handleRetry} className="flex-1">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (status === 'complete') {
    const totalFaqs = industryFaqsCopied + websiteFaqsGenerated;
    
    return (
      <div className="space-y-6">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Knowledge base ready!</h2>
            <p className="text-sm text-muted-foreground">
              BizzyBee can now answer questions about your business
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-muted/30 rounded-lg p-4 text-center">
            <Database className="h-5 w-5 mx-auto mb-2 text-primary" />
            <div className="text-2xl font-bold text-primary">{industryFaqsCopied}</div>
            <div className="text-xs text-muted-foreground">Industry knowledge</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-4 text-center">
            <Globe className="h-5 w-5 mx-auto mb-2 text-green-600" />
            <div className="text-2xl font-bold text-green-600">{websiteFaqsGenerated}</div>
            <div className="text-xs text-muted-foreground">From your website</div>
          </div>
        </div>

        {websiteFaqsGenerated > 0 && (
          <p className="text-xs text-center text-muted-foreground">
            Your specific prices and services always take priority
          </p>
        )}

        {totalFaqs === 0 && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              No FAQs were generated yet. You can add them manually in Settings → Knowledge Base, 
              or industry templates will be added soon.
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

  // Loading state
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">Building your knowledge base</h2>
        <p className="text-sm text-muted-foreground">
          This takes about 1-2 minutes
        </p>
      </div>

      <Progress value={progress} className="h-2" />

      <div className="space-y-4">
        {/* Industry FAQs step */}
        <div className="flex items-start gap-4 p-4 bg-muted/30 rounded-lg">
          <div className="mt-0.5">
            {status === 'copying' ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : industryFaqsCopied > 0 ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : (
              <BookOpen className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1">
            <p className="font-medium">
              {status === 'copying' ? 'Loading industry knowledge...' : 
               industryFaqsCopied > 0 ? `${industryFaqsCopied} industry FAQs loaded` :
               'Load industry knowledge'}
            </p>
            <p className="text-xs text-muted-foreground">
              Common questions for {businessContext.businessType.toLowerCase()} businesses
            </p>
          </div>
        </div>

        {/* Website scraping step */}
        {businessContext.websiteUrl && (
          <div className="flex items-start gap-4 p-4 bg-muted/30 rounded-lg">
            <div className="mt-0.5">
              {status === 'scraping' ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : websiteFaqsGenerated > 0 ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : status === 'copying' ? (
                <Globe className="h-5 w-5 text-muted-foreground" />
              ) : (
                <Globe className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1">
              <p className="font-medium">
                {status === 'scraping' ? 'Learning from your website...' : 
                 websiteFaqsGenerated > 0 ? `${websiteFaqsGenerated} FAQs from your website` :
                 'Extract your prices & services'}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {businessContext.websiteUrl}
              </p>
            </div>
          </div>
        )}
      </div>

      <Button variant="ghost" onClick={onBack} className="w-full text-muted-foreground">
        <ChevronLeft className="h-4 w-4 mr-2" />
        Go back
      </Button>
    </div>
  );
}
