import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Search, Loader2, CheckCircle, Building2, Star, X, MapPin, Globe, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface Competitor {
  name: string;
  website: string;
  city?: string;
  distance_miles?: number;
  rating?: number;
  review_count?: number;
}

interface CompetitorDiscoveryProps {
  workspaceId: string;
  onComplete: () => void;
  onBack?: () => void;
}

export const CompetitorDiscovery = ({ workspaceId, onComplete, onBack }: CompetitorDiscoveryProps) => {
  const [status, setStatus] = useState<'idle' | 'searching' | 'complete' | 'error'>('idle');
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locationInfo, setLocationInfo] = useState<{ name?: string; radius?: number } | null>(null);

  const discoverCompetitors = async () => {
    setStatus('searching');
    setError(null);
    
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('trigger-n8n-workflow', {
        body: { workspace_id: workspaceId, workflow_type: 'competitor_discovery' }
      });

      if (invokeError) throw invokeError;
      
      if (!data.success) {
        throw new Error(data.error || 'Discovery failed');
      }

      setCompetitors(data.competitors || []);
      setJobId(data.job_id);
      setLocationInfo({
        name: data.location?.name,
        radius: data.radius_miles
      });
      setStatus('complete');
      
      if (data.competitors_found > 0) {
        toast.success(`Found ${data.competitors_found} local competitors via Google Maps`);
      } else {
        toast.info('No competitors found. You can continue without competitor analysis.');
      }

    } catch (e: any) {
      console.error('Competitor discovery error:', e);
      setError(e.message || 'Discovery failed');
      setStatus('error');
      toast.error(e.message || 'Discovery failed');
    }
  };

  const removeCompetitor = async (website: string) => {
    setCompetitors(prev => prev.filter(c => c.website !== website));
    
    if (jobId) {
      try {
        const domain = new URL(website).hostname.replace('www.', '').toLowerCase();
        await supabase
          .from('competitor_sites')
          .update({ status: 'rejected', is_valid: false })
          .eq('job_id', jobId)
          .eq('domain', domain);
      } catch (e) {
        console.error('Failed to update competitor status:', e);
      }
    }
  };

  if (status === 'error') {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="p-8 text-center">
          <div className="text-destructive mb-4">
            <AlertCircle className="h-12 w-12 mx-auto" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Discovery Failed</h3>
          <p className="text-muted-foreground mb-6 text-sm">{error}</p>
          <div className="flex gap-3 justify-center flex-wrap">
            {onBack && (
              <Button variant="outline" onClick={onBack}>
                Go Back
              </Button>
            )}
            <Button onClick={discoverCompetitors}>
              Try Again
            </Button>
            <Button variant="ghost" onClick={onComplete}>
              Skip
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === 'complete') {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Local Competitors Found
          </CardTitle>
          <CardDescription className="space-y-1">
            <span>Found via Google Maps - real verified businesses</span>
            {locationInfo?.name && (
              <div className="flex items-center gap-1.5 text-xs">
                <MapPin className="h-3 w-3" />
                {locationInfo.name}
                {locationInfo.radius && ` (${locationInfo.radius} mile radius)`}
              </div>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {competitors.length === 0 ? (
            <div className="text-center py-8">
              <Globe className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground mb-4">
                No competitors with websites found in your area.
              </p>
              <p className="text-xs text-muted-foreground mb-6">
                You can continue without competitor analysis or try adjusting your business location.
              </p>
              <Button onClick={onComplete}>Continue</Button>
            </div>
          ) : (
            <>
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {competitors.map((c) => (
                  <div 
                    key={c.website} 
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Building2 className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{c.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                          {c.city && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {c.city}
                            </span>
                          )}
                          {c.distance_miles !== undefined && c.distance_miles !== null && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              {c.distance_miles}mi
                            </Badge>
                          )}
                          {c.rating && (
                            <span className="flex items-center gap-1 text-warning">
                              <Star className="h-3 w-3 fill-current" /> 
                              {c.rating.toFixed(1)}
                              {c.review_count && (
                                <span className="text-muted-foreground">
                                  ({c.review_count})
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => removeCompetitor(c.website)}
                      className="flex-shrink-0 hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              
              <p className="text-sm text-muted-foreground text-center pt-2">
                {competitors.length} competitor{competitors.length !== 1 ? 's' : ''} will be analyzed for FAQs
              </p>

              <Button onClick={onComplete} className="w-full">
                Continue to Scraping
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          Find Local Competitors
        </CardTitle>
        <CardDescription>
          We'll use Google Maps to find verified businesses in your area
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {status === 'idle' && (
          <>
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-sm">How it works:</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                  <span>Search Google Maps for businesses in your industry and location</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                  <span>Only real, verified businesses with websites (no directories)</span>
                </li>
                <li className="flex items-start gap-2">
                  <Star className="h-4 w-4 mt-0.5 text-warning flex-shrink-0" />
                  <span>Includes ratings and distance from your location</span>
                </li>
              </ul>
            </div>
            
            <Button onClick={discoverCompetitors} className="w-full">
              <Search className="h-4 w-4 mr-2" />
              Find Local Competitors
            </Button>
            
            <Button variant="ghost" onClick={onComplete} className="w-full">
              Skip this step
            </Button>
          </>
        )}

        {status === 'searching' && (
          <div className="text-center py-8">
            <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary mb-4" />
            <p className="font-medium">Searching Google Maps...</p>
            <p className="text-sm text-muted-foreground mt-2">
              Finding verified local businesses in your area
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
