import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { 
  Search, 
  Plus, 
  Loader2, 
  Globe, 
  Star, 
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  Sparkles,
  ExternalLink,
  X,
  MapPin
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Competitor {
  id: string;
  business_name: string | null;
  domain: string;
  url: string;
  rating: number | null;
  reviews_count: number | null;
  is_selected: boolean;
  discovery_source: string | null;
  location_data: any;
  distance_miles: number | null;
}

interface CompetitorReviewScreenProps {
  workspaceId: string;
  jobId: string;
  nicheQuery: string;
  serviceArea: string;
  onConfirm: (selectedCount: number) => void;
  onBack: () => void;
  onSkip: () => void;
}

// Known directories that might slip through - show warning badge
const SUSPICIOUS_DOMAINS = [
  'yell', 'checkatrade', 'bark', 'trustatrader', 'mybuilder',
  'rated-people', 'ratedpeople', 'trustpilot', 'houzz', 'yelp',
  'freeindex', 'gumtree', 'scoot', 'findatrade', 'hotfrog'
];

export function CompetitorReviewScreen({
  workspaceId,
  jobId,
  nicheQuery,
  serviceArea,
  onConfirm,
  onBack,
  onSkip,
}: CompetitorReviewScreenProps) {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [isAddingUrl, setIsAddingUrl] = useState(false);

  // Fetch competitors for this job
  useEffect(() => {
    const fetchCompetitors = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('competitor_sites')
          .select('id, business_name, domain, url, rating, reviews_count, is_selected, discovery_source, location_data, distance_miles')
          .eq('job_id', jobId)
          .order('distance_miles', { ascending: true, nullsFirst: false });

        if (error) throw error;
        setCompetitors(data || []);
      } catch (err) {
        console.error('Error fetching competitors:', err);
        toast.error('Failed to load competitors');
      } finally {
        setIsLoading(false);
      }
    };

    fetchCompetitors();
  }, [jobId]);

  // Filter competitors based on search
  const filteredCompetitors = useMemo(() => {
    if (!searchQuery.trim()) return competitors;
    const search = searchQuery.toLowerCase();
    return competitors.filter(c => 
      c.business_name?.toLowerCase().includes(search) ||
      c.domain.toLowerCase().includes(search)
    );
  }, [competitors, searchQuery]);

  // Calculate selected count
  const selectedCount = useMemo(() => 
    competitors.filter(c => c.is_selected).length,
    [competitors]
  );

  // Check if domain looks suspicious
  const isSuspiciousDomain = (domain: string): boolean => {
    return SUSPICIOUS_DOMAINS.some(sus => domain.toLowerCase().includes(sus));
  };

  // Toggle individual competitor selection
  const handleToggleSelection = async (competitorId: string, newValue: boolean) => {
    // Optimistic update
    setCompetitors(prev => 
      prev.map(c => c.id === competitorId ? { ...c, is_selected: newValue } : c)
    );

    // Persist to database
    const { error } = await supabase
      .from('competitor_sites')
      .update({ is_selected: newValue })
      .eq('id', competitorId);

    if (error) {
      // Revert on error
      setCompetitors(prev => 
        prev.map(c => c.id === competitorId ? { ...c, is_selected: !newValue } : c)
      );
      toast.error('Failed to update selection');
    }
  };

  // Select all / Deselect all
  const handleSelectAll = async (select: boolean) => {
    const ids = competitors.map(c => c.id);
    
    // Optimistic update
    setCompetitors(prev => prev.map(c => ({ ...c, is_selected: select })));

    // Persist to database
    const { error } = await supabase
      .from('competitor_sites')
      .update({ is_selected: select })
      .in('id', ids);

    if (error) {
      // Revert on error
      toast.error('Failed to update selections');
    }
  };

  // Delete a competitor
  const handleDeleteCompetitor = async (competitorId: string) => {
    // Optimistic update
    setCompetitors(prev => prev.filter(c => c.id !== competitorId));

    const { error } = await supabase
      .from('competitor_sites')
      .delete()
      .eq('id', competitorId);

    if (error) {
      // Refetch on error
      toast.error('Failed to delete competitor');
    }
  };

  // Add manual URL
  const handleAddManualUrl = async () => {
    if (!manualUrl.trim()) return;

    let cleanUrl = manualUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    let hostname: string;
    try {
      hostname = new URL(cleanUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      toast.error('Invalid URL format');
      return;
    }

    // Check if already exists
    if (competitors.some(c => c.domain === hostname || c.url === cleanUrl)) {
      toast.error('This website is already in the list');
      return;
    }

    setIsAddingUrl(true);
    try {
      const { data, error } = await supabase
        .from('competitor_sites')
        .insert({
          job_id: jobId,
          workspace_id: workspaceId,
          business_name: hostname,
          url: cleanUrl,
          domain: hostname,
          discovery_source: 'manual',
          status: 'approved',
          scrape_status: 'pending',
          is_selected: true,
        })
        .select()
        .single();

      if (error) throw error;

      setCompetitors(prev => [...prev, data as Competitor]);
      setManualUrl('');
      toast.success('Competitor added');
    } catch (err) {
      console.error('Error adding URL:', err);
      toast.error('Failed to add competitor');
    } finally {
      setIsAddingUrl(false);
    }
  };

  // Confirm and start scraping
  const handleConfirm = async () => {
    if (selectedCount === 0) {
      toast.error('Please select at least one competitor');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('competitor-scrape-start', {
        body: { jobId, workspaceId }
      });

      if (error) throw error;

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to start scraping');
      }

      toast.success(`Deep analysis started for ${selectedCount} websites`);
      onConfirm(selectedCount);
    } catch (err) {
      console.error('Error starting scrape:', err);
      toast.error('Failed to start analysis');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Estimate cost based on selected count
  const estimatedCost = useMemo(() => {
    const costPerSite = 0.10; // ~$0.10 per site with deep crawl
    return (selectedCount * costPerSite).toFixed(2);
  }, [selectedCount]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading competitors...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center space-y-1">
        <h2 className="text-xl font-semibold text-foreground">Review Competitors</h2>
        <p className="text-sm text-muted-foreground">
          We found <span className="font-medium text-foreground">{competitors.length}</span> businesses.
          Uncheck any that aren't relevant competitors.
        </p>
      </div>

      {/* Search and bulk actions */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search competitors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleSelectAll(true)}
        >
          Select All
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleSelectAll(false)}
        >
          Clear
        </Button>
      </div>

      {/* Competitor list */}
      <ScrollArea className="h-[320px] rounded-md border">
        <div className="p-2 space-y-1">
          {filteredCompetitors.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? 'No competitors match your search' : 'No competitors found'}
            </div>
          ) : (
            filteredCompetitors.map((competitor) => (
              <div
                key={competitor.id}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                  competitor.is_selected 
                    ? 'bg-primary/5 border-primary/20' 
                    : 'bg-muted/30 border-transparent opacity-60'
                )}
              >
                <Checkbox
                  checked={competitor.is_selected}
                  onCheckedChange={(checked) => 
                    handleToggleSelection(competitor.id, checked === true)
                  }
                />
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground truncate">
                      {competitor.business_name || competitor.domain}
                    </span>
                    {competitor.distance_miles != null && (
                      <Badge variant="outline" className="text-xs">
                        <MapPin className="h-3 w-3 mr-1" />
                        {competitor.distance_miles} mi
                      </Badge>
                    )}
                    {competitor.discovery_source === 'manual' && (
                      <Badge variant="secondary" className="text-xs">
                        Manual
                      </Badge>
                    )}
                    {isSuspiciousDomain(competitor.domain) && (
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        May be directory
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
                    <span className="flex items-center gap-1">
                      <Globe className="h-3 w-3" />
                      {competitor.domain}
                    </span>
                    {competitor.rating && (
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        {competitor.rating.toFixed(1)}
                        {competitor.reviews_count && (
                          <span className="text-xs">({competitor.reviews_count})</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    asChild
                  >
                    <a href={competitor.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteCompetitor(competitor.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Add manual URL */}
      <div className="border rounded-lg p-3 bg-muted/30">
        <p className="text-sm font-medium mb-2">Add a competitor we missed</p>
        <div className="flex gap-2">
          <Input
            placeholder="https://example.com"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddManualUrl()}
            disabled={isAddingUrl}
          />
          <Button
            onClick={handleAddManualUrl}
            disabled={!manualUrl.trim() || isAddingUrl}
            size="icon"
          >
            {isAddingUrl ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Summary and actions */}
      <div className="border-t pt-4 space-y-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span>
              <span className="font-medium">{selectedCount}</span> competitors selected
            </span>
          </div>
          <span className="text-muted-foreground">
            Estimated analysis cost: ~${estimatedCost}
          </span>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={selectedCount === 0 || isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Confirm & Start Analysis
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
