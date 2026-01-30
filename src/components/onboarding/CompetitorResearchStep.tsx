import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Search, Loader2, Sparkles, MapPin } from 'lucide-react';
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

const BUSINESS_TYPES = [
  // Cleaning Services
  { value: 'window_cleaning', label: 'Window Cleaning' },
  { value: 'carpet_cleaning', label: 'Carpet Cleaning' },
  { value: 'pressure_washing', label: 'Pressure Washing' },
  { value: 'general_cleaning', label: 'General Cleaning' },
  { value: 'domestic_cleaning', label: 'Domestic Cleaning' },
  { value: 'commercial_cleaning', label: 'Commercial Cleaning' },
  { value: 'oven_cleaning', label: 'Oven Cleaning' },
  { value: 'gutter_cleaning', label: 'Gutter Cleaning' },
  { value: 'end_of_tenancy', label: 'End of Tenancy Cleaning' },
  { value: 'upholstery_cleaning', label: 'Upholstery Cleaning' },
  // Building & Construction
  { value: 'builder', label: 'Builder' },
  { value: 'bricklayer', label: 'Bricklayer' },
  { value: 'carpenter', label: 'Carpenter' },
  { value: 'joiner', label: 'Joiner' },
  { value: 'plasterer', label: 'Plasterer' },
  { value: 'tiler', label: 'Tiler' },
  { value: 'flooring', label: 'Flooring' },
  { value: 'roofer', label: 'Roofer' },
  { value: 'scaffolding', label: 'Scaffolding' },
  { value: 'driveway', label: 'Driveway Contractor' },
  { value: 'fencing', label: 'Fencing' },
  { value: 'decking', label: 'Decking' },
  // Trades
  { value: 'plumber', label: 'Plumber' },
  { value: 'electrician', label: 'Electrician' },
  { value: 'gas_engineer', label: 'Gas Engineer' },
  { value: 'heating_engineer', label: 'Heating Engineer' },
  { value: 'boiler_engineer', label: 'Boiler Engineer' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'air_conditioning', label: 'Air Conditioning' },
  { value: 'locksmith', label: 'Locksmith' },
  { value: 'glazier', label: 'Glazier' },
  // Decorating
  { value: 'painter_decorator', label: 'Painter & Decorator' },
  { value: 'interior_designer', label: 'Interior Designer' },
  { value: 'kitchen_fitter', label: 'Kitchen Fitter' },
  { value: 'bathroom_fitter', label: 'Bathroom Fitter' },
  // Outdoor & Garden
  { value: 'landscaping', label: 'Landscaping' },
  { value: 'gardener', label: 'Gardener' },
  { value: 'lawn_care', label: 'Lawn Care' },
  { value: 'tree_surgeon', label: 'Tree Surgeon' },
  { value: 'garden_maintenance', label: 'Garden Maintenance' },
  // Automotive
  { value: 'mobile_mechanic', label: 'Mobile Mechanic' },
  { value: 'car_valeting', label: 'Car Valeting' },
  { value: 'mobile_tyres', label: 'Mobile Tyres' },
  { value: 'mot_garage', label: 'MOT Garage' },
  // Pet Services
  { value: 'dog_groomer', label: 'Dog Groomer' },
  { value: 'pet_groomer', label: 'Pet Groomer' },
  { value: 'dog_walker', label: 'Dog Walker' },
  { value: 'pet_sitter', label: 'Pet Sitter' },
  { value: 'dog_trainer', label: 'Dog Trainer' },
  // Home Services
  { value: 'handyman', label: 'Handyman' },
  { value: 'property_maintenance', label: 'Property Maintenance' },
  { value: 'pest_control', label: 'Pest Control' },
  { value: 'removals', label: 'Removals' },
  { value: 'man_and_van', label: 'Man & Van' },
  { value: 'house_clearance', label: 'House Clearance' },
  { value: 'skip_hire', label: 'Skip Hire' },
  { value: 'waste_removal', label: 'Waste Removal' },
  { value: 'chimney_sweep', label: 'Chimney Sweep' },
  // Health & Beauty
  { value: 'hairdresser', label: 'Hairdresser' },
  { value: 'barber', label: 'Barber' },
  { value: 'beauty_therapist', label: 'Beauty Therapist' },
  { value: 'nail_technician', label: 'Nail Technician' },
  { value: 'massage_therapist', label: 'Massage Therapist' },
  { value: 'personal_trainer', label: 'Personal Trainer' },
  // Events
  { value: 'photographer', label: 'Photographer' },
  { value: 'videographer', label: 'Videographer' },
  { value: 'dj', label: 'DJ' },
  { value: 'caterer', label: 'Caterer' },
  { value: 'event_planner', label: 'Event Planner' },
  { value: 'wedding_planner', label: 'Wedding Planner' },
  { value: 'florist', label: 'Florist' },
  // Professional Services
  { value: 'accountant', label: 'Accountant' },
  { value: 'bookkeeper', label: 'Bookkeeper' },
  { value: 'estate_agent', label: 'Estate Agent' },
  { value: 'letting_agent', label: 'Letting Agent' },
  { value: 'surveyor', label: 'Surveyor' },
  { value: 'driving_instructor', label: 'Driving Instructor' },
  // IT & Tech
  { value: 'it_support', label: 'IT Support' },
  { value: 'computer_repair', label: 'Computer Repair' },
  { value: 'web_developer', label: 'Web Developer' },
  // Other
  { value: 'tailor', label: 'Tailor' },
  { value: 'appliance_repair', label: 'Appliance Repair' },
  { value: 'dry_cleaner', label: 'Dry Cleaner' },
  { value: 'courier', label: 'Courier' },
  { value: 'taxi', label: 'Taxi' },
  { value: 'childminder', label: 'Childminder' },
  { value: 'care_worker', label: 'Care Worker' },
  { value: 'other', label: 'Other' },
];

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

  // Check if we have data from props or draft
  const hasInitialNiche = !!(draft.nicheQuery || businessContext.businessType);
  const hasInitialArea = !!(draft.serviceArea || businessContext.serviceArea);

  const [status, setStatus] = useState<Status>('idle');
  const [nicheQuery, setNicheQuery] = useState(draft.nicheQuery ?? businessContext.businessType ?? '');
  const [serviceArea, setServiceArea] = useState(draft.serviceArea ?? parseServiceArea(businessContext.serviceArea) ?? '');
  const [targetCount, setTargetCount] = useState(draft.targetCount ?? 100);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(!hasInitialNiche);

  // Resume the latest in-progress job after refresh so the UI doesn't look "paused".
  useEffect(() => {
    if (status !== 'idle' || jobId) return;

    const resume = async () => {
      const { data, error } = await supabase
        .from('competitor_research_jobs')
        .select('id,status')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data?.id) return;

      // Only resume if the job is still active.
      const activeStatuses = new Set([
        'queued',
        'geocoding',
        'discovering',
        'filtering',
        'scraping',
        'extracting',
        'deduplicating',
        'refining',
        'embedding',
      ]);

      if (activeStatuses.has(String(data.status))) {
        setJobId(data.id);
        setStatus('running');
      }
    };

    resume();
  }, [workspaceId, status, jobId]);

  // Niche/business type search state
  const [nicheSearch, setNicheSearch] = useState('');
  const [nicheFocused, setNicheFocused] = useState(false);

  // Google Places autocomplete state
  const [serviceAreaSearch, setServiceAreaSearch] = useState('');
  const [serviceAreaFocused, setServiceAreaFocused] = useState(false);
  const [placePredictions, setPlacePredictions] = useState<PlacePrediction[]>([]);
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(false);

  // Filter business types based on search with fuzzy matching
  const filteredBusinessTypes = useMemo(() => {
    if (!nicheSearch || nicheSearch.trim().length < 1) return [];
    
    const search = nicheSearch.toLowerCase().trim();
    
    const scored = BUSINESS_TYPES
      .map(type => {
        const label = type.label.toLowerCase();
        const value = type.value.toLowerCase();
        let score = 0;
        
        if (label === search || value === search) {
          score = 100;
        } else if (label.startsWith(search) || value.startsWith(search)) {
          score = 80;
        } else if (label.split(/[\s&]+/).some(word => word.startsWith(search)) || 
                   value.split('_').some(word => word.startsWith(search))) {
          score = 60;
        } else if (label.includes(search) || value.includes(search)) {
          score = 40;
        }
        
        return { type, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(item => item.type);
    
    return scored;
  }, [nicheSearch]);

  const handleSelectNiche = (label: string) => {
    setNicheQuery(label);
    setNicheSearch('');
    setNicheFocused(false);
  };

  // Fetch from database if props and draft are empty (happens after page refresh)
  useEffect(() => {
    // Skip if we already have data from props or draft
    if (hasInitialNiche && hasInitialArea) {
      setIsLoadingContext(false);
      return;
    }
    
    const fetchBusinessContext = async () => {
      setIsLoadingContext(true);
      try {
        const { data } = await supabase
          .from('business_context')
          .select('business_type, service_area')
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        if (data) {
          if (data.business_type && !hasInitialNiche) {
            setNicheQuery(data.business_type);
          }
          if (data.service_area && !hasInitialArea) {
            setServiceArea(parseServiceArea(data.service_area));
          }
        }
      } catch (err) {
        console.error('Error fetching business context:', err);
      } finally {
        setIsLoadingContext(false);
      }
    };

    fetchBusinessContext();
  }, [workspaceId, hasInitialNiche, hasInitialArea]);

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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
            <Input
              id="niche"
              value={nicheFocused ? nicheSearch : nicheQuery}
              onChange={(e) => {
                setNicheSearch(e.target.value);
                if (!nicheFocused) setNicheQuery(e.target.value);
              }}
              onFocus={() => {
                setNicheFocused(true);
                setNicheSearch('');
              }}
              onBlur={() => {
                // Delay to allow click on dropdown
                setTimeout(() => setNicheFocused(false), 200);
              }}
              placeholder="Start typing to search..."
              className="pl-10"
            />
            {nicheFocused && filteredBusinessTypes.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                {filteredBusinessTypes.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center gap-2"
                    onClick={() => handleSelectNiche(type.label)}
                  >
                    <Search className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    {type.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {nicheQuery && !nicheFocused && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Search className="h-3 w-3" />
              <span>Selected: <strong className="text-foreground">{nicheQuery}</strong></span>
            </div>
          )}
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
