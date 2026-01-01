import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Search, Globe, Loader2, CheckCircle2, ArrowRight, XCircle, Sparkles } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface CompetitorResearchStepProps {
  workspaceId: string;
  businessContext: {
    companyName: string;
    businessType: string;
    serviceArea?: string;
  };
  onComplete: (results: { sitesScraped: number; faqsGenerated: number }) => void;
  onBack: () => void;
}

type Status = 'idle' | 'discovering' | 'scraping' | 'generating' | 'complete' | 'error';

const targetCountOptions = [
  { value: 50, label: '50 competitors', description: 'Quick research (5-10 min)' },
  { value: 100, label: '100 competitors', description: 'Recommended balance (10-20 min)', recommended: true },
  { value: 250, label: '250 competitors', description: 'Comprehensive (30-45 min)' },
];

export function CompetitorResearchStep({ 
  workspaceId, 
  businessContext,
  onComplete, 
  onBack 
}: CompetitorResearchStepProps) {
  const draftKey = `bizzybee:onboarding:${workspaceId}:competitorDraft`;

  const readDraft = () => {
    try {
      const raw = localStorage.getItem(draftKey);
      return raw
        ? (JSON.parse(raw) as { nicheQuery?: string; serviceArea?: string; targetCount?: number })
        : {};
    } catch {
      return {};
    }
  };

  const draft = readDraft();

  const [status, setStatus] = useState<Status>('idle');
  const [nicheQuery, setNicheQuery] = useState(draft.nicheQuery ?? businessContext.businessType ?? '');
  const [serviceArea, setServiceArea] = useState(draft.serviceArea ?? businessContext.serviceArea ?? '');
  const [targetCount, setTargetCount] = useState(draft.targetCount ?? 100);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState({
    sitesDiscovered: 0,
    sitesApproved: 0,
    sitesScraped: 0,
    faqsGenerated: 0,
    faqsAdded: 0,
    currentSite: null as string | null,
  });
  const [error, setError] = useState<string | null>(null);

  // Persist form inputs so Back/refresh doesn't wipe them
  useEffect(() => {
    if (status !== 'idle') return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ nicheQuery, serviceArea, targetCount, updatedAt: Date.now() })
      );
    } catch {
      // ignore
    }
  }, [draftKey, nicheQuery, serviceArea, targetCount, status]);

  // Poll for job progress
  useEffect(() => {
    if (!jobId || status === 'complete' || status === 'error' || status === 'idle') return;

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('competitor_research_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (data) {
        setProgress({
          sitesDiscovered: data.sites_discovered || 0,
          sitesApproved: data.sites_approved || 0,
          sitesScraped: data.sites_scraped || 0,
          faqsGenerated: data.faqs_generated || 0,
          faqsAdded: data.faqs_added || 0,
          currentSite: data.current_scraping_domain || null,
        });

        if (data.status === 'completed') {
          setStatus('complete');
          clearInterval(interval);
        } else if (data.status === 'error') {
          setStatus('error');
          setError(data.error_message || 'Research failed');
          clearInterval(interval);
        } else {
          setStatus(data.status as Status);
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [jobId, status]);

  const handleStart = async () => {
    if (!nicheQuery.trim()) {
      toast.error('Please enter your industry/niche');
      return;
    }

    setStatus('discovering');
    setError(null);

    try {
      // Create the job record
      const { data: job, error: jobError } = await supabase
        .from('competitor_research_jobs')
        .insert({
          workspace_id: workspaceId,
          niche_query: nicheQuery,
          service_area: serviceArea || null,
          target_count: targetCount,
          status: 'queued',
        })
        .select()
        .single();

      if (jobError) throw jobError;

      setJobId(job.id);

      // Start the discovery process using smart Gemini-powered discovery
      const { error: invokeError } = await supabase.functions.invoke('competitor-discover-smart', {
        body: {
          jobId: job.id,
          workspaceId,
          nicheQuery,
          serviceArea,
          targetCount,
        }
      });

      if (invokeError) throw invokeError;

      toast.success('Competitor research started!');

    } catch (err) {
      console.error('Failed to start research:', err);
      setStatus('error');
      setError('Failed to start competitor research');
      toast.error('Failed to start research');
    }
  };

  const handleSkip = () => {
    onComplete({ sitesScraped: 0, faqsGenerated: 0 });
  };

  const handleContinue = () => {
    onComplete({
      sitesScraped: progress.sitesScraped,
      faqsGenerated: progress.faqsAdded,
    });
  };

  const getProgressPercent = () => {
    if (status === 'discovering') return 10 + (progress.sitesDiscovered / targetCount) * 20;
    if (status === 'scraping') return 30 + (progress.sitesScraped / Math.max(progress.sitesApproved, 1)) * 50;
    if (status === 'generating') return 80 + (progress.faqsGenerated > 0 ? 15 : 0);
    if (status === 'complete') return 100;
    return 0;
  };

  if (status === 'complete') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl">Competitor Research Complete!</CardTitle>
          <CardDescription className="mt-2">
            We've analyzed your competitors and enriched your knowledge base.
          </CardDescription>
        </div>

        <div className="flex items-center justify-center p-6">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-muted/30 rounded-lg p-4">
            <div className="text-2xl font-bold text-primary">{progress.sitesApproved}</div>
            <div className="text-xs text-muted-foreground">Competitors found</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-600">{progress.sitesScraped}</div>
            <div className="text-xs text-muted-foreground">Sites analyzed</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-600">{progress.faqsAdded}</div>
            <div className="text-xs text-muted-foreground">FAQs added</div>
          </div>
        </div>

        {progress.faqsAdded > 0 && (
          <p className="text-center text-sm text-muted-foreground">
            Your knowledge base now includes insights from {progress.sitesScraped} competitor websites.
          </p>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            Back
          </Button>
          <Button onClick={handleContinue} className="flex-1 gap-2">
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl">Research Error</CardTitle>
          <CardDescription className="mt-2">
            Something went wrong during competitor research.
          </CardDescription>
        </div>

        <div className="flex items-center justify-center p-6">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
            <XCircle className="h-8 w-8 text-red-600" />
          </div>
        </div>

        {error && (
          <p className="text-center text-sm text-red-600">{error}</p>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            Back
          </Button>
          <Button variant="outline" onClick={handleSkip} className="flex-1">
            Skip for now
          </Button>
          <Button onClick={() => { setStatus('idle'); setError(null); }} className="flex-1">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (status !== 'idle') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl">Researching Competitors</CardTitle>
          <CardDescription className="mt-2">
            {status === 'discovering' && 'Finding competitors in your niche...'}
            {status === 'scraping' && 'Analyzing competitor websites...'}
            {status === 'generating' && 'Generating FAQs from insights...'}
          </CardDescription>
        </div>

        <div className="space-y-4 p-4 bg-muted/30 rounded-lg">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="font-medium">
                {status === 'discovering' && `Discovering competitors...`}
                {status === 'scraping' && progress.currentSite 
                  ? `Scraping ${progress.currentSite}...`
                  : `Scraping competitors...`}
                {status === 'generating' && 'Generating FAQs...'}
              </span>
            </div>
            {status === 'scraping' && (
              <span className="text-xs text-muted-foreground ml-8">
                {progress.sitesScraped} of {progress.sitesApproved} sites completed
                {progress.faqsGenerated > 0 && ` • ${progress.faqsGenerated} FAQs generated`}
              </span>
            )}
          </div>

          <Progress value={getProgressPercent()} className="h-2" />

          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Competitors found:</span>
              <span className="font-medium text-foreground">{progress.sitesApproved}</span>
            </div>
            <div className="flex justify-between">
              <span>Sites scraped:</span>
              <span className="font-medium text-foreground">{progress.sitesScraped}</span>
            </div>
            <div className="flex justify-between">
              <span>FAQs generated:</span>
              <span className="font-medium text-green-600">{progress.faqsGenerated}</span>
            </div>
            <div className="flex justify-between">
              <span>FAQs added:</span>
              <span className="font-medium text-green-600">{progress.faqsAdded}</span>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          This may take {targetCount <= 50 ? '5-10' : targetCount <= 100 ? '10-20' : '30-45'} minutes. 
          You can continue onboarding while this runs in the background.
        </p>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            Back
          </Button>
          <Button onClick={handleSkip} className="flex-1">
            Continue (run in background)
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <CardTitle className="text-xl flex items-center justify-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Competitor Research
        </CardTitle>
        <CardDescription className="mt-2">
          Learn from your competitors' FAQs to build a comprehensive knowledge base.
        </CardDescription>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="niche">Your Industry / Niche</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="niche"
              value={nicheQuery}
              onChange={(e) => setNicheQuery(e.target.value)}
              placeholder="e.g., end of tenancy cleaning, plumbing, landscaping"
              className="pl-10"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Be specific: "end of tenancy cleaning" works better than just "cleaning"
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="area">Service Area (optional)</Label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="area"
              value={serviceArea}
              onChange={(e) => setServiceArea(e.target.value)}
              placeholder="e.g., London, Manchester, UK"
              className="pl-10"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>How many competitors to analyze?</Label>
          <RadioGroup
            value={targetCount.toString()}
            onValueChange={(v) => setTargetCount(parseInt(v))}
            className="space-y-2"
          >
            {targetCountOptions.map((option) => (
              <div
                key={option.value}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  targetCount === option.value
                    ? 'border-primary/50 bg-primary/5'
                    : 'hover:bg-accent/50'
                } ${option.recommended ? 'ring-1 ring-primary/30' : ''}`}
                onClick={() => setTargetCount(option.value)}
              >
                <RadioGroupItem value={option.value.toString()} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{option.label}</span>
                    {option.recommended && (
                      <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{option.description}</p>
                </div>
              </div>
            ))}
          </RadioGroup>
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-sm border border-blue-200 dark:border-blue-800">
        <p className="text-blue-800 dark:text-blue-200">
          <strong>What happens:</strong> We search for real {nicheQuery || 'businesses'} websites, 
          filter out directories, scrape their FAQs and pricing pages, then generate synthesized 
          FAQs for your knowledge base.
        </p>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button variant="outline" onClick={handleSkip} className="flex-1">
          Skip
        </Button>
        <Button onClick={handleStart} disabled={!nicheQuery.trim()} className="flex-1 gap-2">
          <Search className="h-4 w-4" />
          Start Research
        </Button>
      </div>
    </div>
  );
}
