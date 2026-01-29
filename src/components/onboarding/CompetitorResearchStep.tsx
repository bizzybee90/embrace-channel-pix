import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Search, Loader2, ArrowRight, Sparkles, MapPin } from 'lucide-react';
import { CompetitorPipelineProgress } from './CompetitorPipelineProgress';

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

type Status = 'idle' | 'starting' | 'running' | 'completed' | 'error';

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

  const handleStart = async () => {
    if (!nicheQuery.trim()) {
      toast.error('Please enter your industry/niche');
      return;
    }

    setStatus('starting');
    setError(null);

    try {
      // Use the Apify-based discovery which creates its own job
      // and returns 50-100+ competitors via Google Maps Scraper
      const { data, error: invokeError } = await supabase.functions.invoke('start-competitor-research', {
        body: {
          workspaceId,
          industry: nicheQuery,
          location: serviceArea || 'UK',
          radiusMiles: 25,
          maxCompetitors: targetCount,
        }
      });

      if (invokeError) throw invokeError;
      
      if (!data?.success || !data?.jobId) {
        throw new Error(data?.error || 'Failed to start research');
      }

      // Use the job ID created by start-competitor-research
      setJobId(data.jobId);
      setStatus('running');
      toast.success('Competitor research started!');

    } catch (err) {
      console.error('Failed to start research:', err);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to start competitor research');
      toast.error('Failed to start research');
    }
  };

  const handleSkip = () => {
    onComplete({ sitesScraped: 0, faqsGenerated: 0 });
  };

  const handlePipelineComplete = (results: { sitesScraped: number; faqsGenerated: number }) => {
    onComplete(results);
  };

  const handleRetry = () => {
    setError(null);
    setJobId(null);
    setStatus('idle');
  };

  // Show pipeline progress when job is running
  if (status === 'running' && jobId) {
    return (
      <CompetitorPipelineProgress
        workspaceId={workspaceId}
        jobId={jobId}
        nicheQuery={nicheQuery}
        serviceArea={serviceArea}
        targetCount={targetCount}
        onComplete={handlePipelineComplete}
        onBack={onBack}
        onRetry={handleRetry}
      />
    );
  }

  // Starting state
  if (status === 'starting') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Starting Research
          </CardTitle>
          <CardDescription className="mt-2">
            Setting up competitor discovery...
          </CardDescription>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            Back
          </Button>
          <Button variant="outline" onClick={handleSkip} className="flex-1">
            Skip
          </Button>
        </div>
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <CardTitle className="text-xl">Research Error</CardTitle>
          <CardDescription className="mt-2">
            Something went wrong during competitor research.
          </CardDescription>
        </div>

        {error && (
          <p className="text-center text-sm text-destructive">{error}</p>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
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

  // Idle state - show form
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

      <div className="bg-primary/5 rounded-lg p-3 text-sm border border-primary/20">
        <p className="text-foreground">
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
