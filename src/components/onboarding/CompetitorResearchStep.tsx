import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Search, Globe, Loader2, CheckCircle2, ArrowRight, XCircle, Sparkles, FileText, Brain, Wand2, MapPin } from 'lucide-react';
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

interface PlacePrediction {
  description: string;
  place_id: string;
}

type Status = 'idle' | 'discovering' | 'validating' | 'scraping' | 'extracting' | 'deduplicating' | 'refining' | 'embedding' | 'completed' | 'error';

const targetCountOptions = [
  { value: 50, label: '50 competitors', description: 'Quick research (5-10 min)' },
  { value: 100, label: '100 competitors', description: 'Recommended balance (10-20 min)', recommended: true },
  { value: 250, label: '250 competitors', description: 'Comprehensive (30-45 min)' },
];

// Extract clean service area name (first location without radius)
const parseServiceArea = (serviceArea?: string): string => {
  if (!serviceArea) return '';
  // Support both pipe and comma format
  const parts = serviceArea.includes(' | ') 
    ? serviceArea.split(' | ')
    : serviceArea.split(',');
  const first = parts[0]?.trim() || '';
  // Remove radius if present: "Luton (20 miles)" -> "Luton"
  return first.replace(/\s*\(\d+\s*miles?\)$/i, '').trim();
};

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
  const [serviceArea, setServiceArea] = useState(draft.serviceArea ?? parseServiceArea(businessContext.serviceArea) ?? '');
  const [targetCount, setTargetCount] = useState(draft.targetCount ?? 100);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState({
    sitesDiscovered: 0,
    sitesValidated: 0,
    sitesScraped: 0,
    pagesScraped: 0,
    faqsExtracted: 0,
    faqsAfterDedup: 0,
    faqsRefined: 0,
    faqsAdded: 0,
    currentSite: null as string | null,
  });
  const [error, setError] = useState<string | null>(null);

  // Google Places autocomplete state
  const [serviceAreaSearch, setServiceAreaSearch] = useState('');
  const [serviceAreaFocused, setServiceAreaFocused] = useState(false);
  const [placePredictions, setPlacePredictions] = useState<PlacePrediction[]>([]);
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(false);

  // Google Places search
  const searchPlaces = useCallback(async (input: string) => {
    if (!input || input.trim().length < 2) {
      setPlacePredictions([]);
      return;
    }

    setIsLoadingPlaces(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-places-autocomplete', {
        body: { input: input.trim() }
      });

      if (error) {
        console.error('Places API error:', error);
        setPlacePredictions([]);
        return;
      }

      setPlacePredictions(data.predictions || []);
    } catch (err) {
      console.error('Error fetching places:', err);
      setPlacePredictions([]);
    } finally {
      setIsLoadingPlaces(false);
    }
  }, []);

  // Debounce places search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (serviceAreaSearch) {
        searchPlaces(serviceAreaSearch);
      } else {
        setPlacePredictions([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [serviceAreaSearch, searchPlaces]);

  const handleSelectLocation = (location: string) => {
    // Clean up country suffix
    let cleanLocation = location.trim();
    const countryPattern = /, (UK|United Kingdom|USA|United States|Australia|Canada|Ireland|Germany|France|Italy|Spain|Netherlands|New Zealand|India|Poland|Czechia|South Korea|Malaysia|Belarus|England|Scotland|Wales|Northern Ireland)$/i;
    cleanLocation = cleanLocation.replace(countryPattern, '');
    
    setServiceArea(cleanLocation);
    setServiceAreaSearch('');
    setPlacePredictions([]);
  };

  // Persist form inputs
  useEffect(() => {
    if (status !== 'idle') return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ nicheQuery, serviceArea, targetCount, updatedAt: Date.now() })
      );
    } catch { /* ignore */ }
  }, [draftKey, nicheQuery, serviceArea, targetCount, status]);

  // Poll for job progress
  useEffect(() => {
    if (!jobId || status === 'completed' || status === 'error' || status === 'idle') return;

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('competitor_research_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (data) {
        setProgress({
          sitesDiscovered: data.sites_discovered || 0,
          sitesValidated: data.sites_validated || data.sites_approved || 0,
          sitesScraped: data.sites_scraped || 0,
          pagesScraped: data.pages_scraped || 0,
          faqsExtracted: data.faqs_extracted || data.faqs_generated || 0,
          faqsAfterDedup: data.faqs_after_dedup || 0,
          faqsRefined: data.faqs_refined || 0,
          faqsAdded: data.faqs_added || data.faqs_refined || 0,
          currentSite: data.current_scraping_domain || null,
        });

        if (data.status === 'completed') {
          setStatus('completed');
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
          industry: nicheQuery,
          location: serviceArea,
          status: 'queued',
        })
        .select()
        .single();

      if (jobError) throw jobError;

      setJobId(job.id);

      // Start the discovery process
      const { error: invokeError } = await supabase.functions.invoke('competitor-discover', {
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
    switch (status) {
      case 'discovering': return 5 + Math.min(10, (progress.sitesDiscovered / targetCount) * 10);
      case 'validating': return 15 + Math.min(10, (progress.sitesValidated / Math.max(progress.sitesDiscovered, 1)) * 10);
      case 'scraping': return 25 + Math.min(25, (progress.sitesScraped / Math.max(progress.sitesValidated, 1)) * 25);
      case 'extracting': return 50 + Math.min(15, (progress.faqsExtracted / 100) * 15);
      case 'deduplicating': return 70;
      case 'refining': return 75 + Math.min(20, (progress.faqsRefined / Math.max(progress.faqsAfterDedup, 1)) * 20);
      case 'embedding': return 95;
      case 'completed': return 100;
      default: return 0;
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case 'discovering': return 'Discovering competitors...';
      case 'validating': return 'Validating business websites...';
      case 'scraping': return progress.currentSite ? `Scraping ${progress.currentSite}...` : 'Scraping websites...';
      case 'extracting': return 'Extracting FAQs from content...';
      case 'deduplicating': return 'Removing duplicate FAQs...';
      case 'refining': return 'Refining FAQs for your business...';
      case 'embedding': return 'Generating search embeddings...';
      default: return 'Processing...';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'discovering':
      case 'validating':
        return <Search className="h-5 w-5 animate-pulse text-primary" />;
      case 'scraping':
        return <Globe className="h-5 w-5 animate-spin text-blue-500" />;
      case 'extracting':
        return <FileText className="h-5 w-5 animate-pulse text-amber-500" />;
      case 'deduplicating':
        return <Brain className="h-5 w-5 animate-pulse text-purple-500" />;
      case 'refining':
      case 'embedding':
        return <Wand2 className="h-5 w-5 animate-pulse text-green-500" />;
      default:
        return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
    }
  };

  if (status === 'completed') {
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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="text-xl font-bold text-primary">{progress.sitesDiscovered}</div>
            <div className="text-[10px] text-muted-foreground">Discovered</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="text-xl font-bold text-blue-600">{progress.sitesScraped}</div>
            <div className="text-[10px] text-muted-foreground">Scraped</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="text-xl font-bold text-amber-600">{progress.faqsExtracted}</div>
            <div className="text-[10px] text-muted-foreground">FAQs Found</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="text-xl font-bold text-green-600">{progress.faqsAdded}</div>
            <div className="text-[10px] text-muted-foreground">Refined FAQs</div>
          </div>
        </div>

        {progress.faqsAdded > 0 && (
          <p className="text-center text-sm text-muted-foreground">
            Your knowledge base now includes {progress.faqsAdded} business-specific FAQs from {progress.sitesScraped} competitor websites.
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
            Building your competitive knowledge base...
          </CardDescription>
        </div>

        <div className="space-y-4 p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-3">
            {getStatusIcon()}
            <span className="font-medium">{getStatusLabel()}</span>
          </div>

          <Progress value={getProgressPercent()} className="h-2" />

          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Sites discovered:</span>
              <span className="font-medium text-foreground">{progress.sitesDiscovered}</span>
            </div>
            <div className="flex justify-between">
              <span>Sites scraped:</span>
              <span className="font-medium text-foreground">{progress.sitesScraped}</span>
            </div>
            <div className="flex justify-between">
              <span>Pages scraped:</span>
              <span className="font-medium text-foreground">{progress.pagesScraped}</span>
            </div>
            <div className="flex justify-between">
              <span>FAQs extracted:</span>
              <span className="font-medium text-amber-600">{progress.faqsExtracted}</span>
            </div>
            {progress.faqsAfterDedup > 0 && (
              <div className="flex justify-between">
                <span>After dedup:</span>
                <span className="font-medium text-purple-600">{progress.faqsAfterDedup}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Refined FAQs:</span>
              <span className="font-medium text-green-600">{progress.faqsRefined}</span>
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
          <Label htmlFor="area">Service Area</Label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
            <Input
              id="area"
              value={serviceAreaFocused ? serviceAreaSearch : serviceArea}
              onChange={(e) => {
                setServiceAreaSearch(e.target.value);
                if (!serviceAreaFocused) setServiceArea(e.target.value);
              }}
              onFocus={() => {
                setServiceAreaFocused(true);
                setServiceAreaSearch(serviceArea);
              }}
              onBlur={() => {
                // Delay to allow click on dropdown
                setTimeout(() => setServiceAreaFocused(false), 200);
              }}
              placeholder="Search for a city or town..."
              className="pl-10"
            />
            {isLoadingPlaces && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
            {serviceAreaFocused && placePredictions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                {placePredictions.map((prediction) => (
                  <button
                    key={prediction.place_id}
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center gap-2"
                    onClick={() => handleSelectLocation(prediction.description)}
                  >
                    <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    {prediction.description}
                  </button>
                ))}
              </div>
            )}
          </div>
          {serviceArea && !serviceAreaFocused && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              <span>Selected: <strong className="text-foreground">{serviceArea}</strong></span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            We'll find real local competitors in your area using Google Places
          </p>
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
          <strong>What happens:</strong> We discover real {nicheQuery || 'businesses'} via Google Places, 
          scrape their websites, extract FAQs, remove duplicates, then refine each FAQ 
          to match YOUR business voice.
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
