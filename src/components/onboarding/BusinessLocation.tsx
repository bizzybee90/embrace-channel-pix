import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MapPin, Loader2, CheckCircle } from 'lucide-react';

interface BusinessLocationProps {
  workspaceId: string;
  onComplete: () => void;
}

interface ResolvedLocation {
  place_name: string;
  county: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  confidence: number;
  disambiguation_note?: string;
  place_id?: string;
}

export const BusinessLocation = ({ workspaceId, onComplete }: BusinessLocationProps) => {
  const [businessName, setBusinessName] = useState('');
  const [location, setLocation] = useState('');
  const [postcode, setPostcode] = useState('');
  const [serviceRadius, setServiceRadius] = useState([25]);
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState<ResolvedLocation | null>(null);

  const resolveLocation = async () => {
    if (!location.trim()) {
      toast.error('Please enter your business location');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('business-location', {
        body: {
          workspace_id: workspaceId,
          business_name: businessName,
          location_query: location,
          postcode: postcode,
          service_radius: serviceRadius[0],
          get_place_id: true
        }
      });

      if (error) throw error;

      setResolved(data.location);
      toast.success('Location found!');

    } catch (e: any) {
      toast.error(e.message || 'Failed to resolve location');
    } finally {
      setLoading(false);
    }
  };

  if (resolved) {
    return (
      <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckCircle className="h-12 w-12 text-green-600" />
            <MapPin className="h-6 w-6 text-muted-foreground" />
            
            <div className="space-y-2">
              <p className="text-lg font-medium">{resolved.formatted_address}</p>
              {resolved.disambiguation_note && (
                <p className="text-sm text-muted-foreground">
                  {resolved.disambiguation_note}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Service radius: {serviceRadius[0]} miles
              </p>
            </div>

            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={() => setResolved(null)}>
                Change
              </Button>
              <Button onClick={onComplete}>
                Continue
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          <CardTitle>Business Location</CardTitle>
        </div>
        <CardDescription>
          Help us find your exact location for accurate local competitor research
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="businessName">Business Name</Label>
          <Input
            id="businessName"
            placeholder="MAC Window Cleaning"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">City/Town or Full Address</Label>
          <Input
            id="location"
            placeholder="Luton, UK or 123 High Street, Manchester"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="postcode">Postcode (helps accuracy)</Label>
          <Input
            id="postcode"
            placeholder="LU1 2AB"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
          />
        </div>

        <div className="space-y-3">
          <div className="flex justify-between">
            <Label>Service Radius</Label>
            <span className="text-sm text-muted-foreground">{serviceRadius[0]} miles</span>
          </div>
          <Slider
            value={serviceRadius}
            onValueChange={setServiceRadius}
            min={5}
            max={50}
            step={5}
          />
        </div>

        <Button onClick={resolveLocation} disabled={loading} className="w-full">
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Finding location...
            </>
          ) : (
            <>
              <MapPin className="mr-2 h-4 w-4" />
              Find My Location
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};
