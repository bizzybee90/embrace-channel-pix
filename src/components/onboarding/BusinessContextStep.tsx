import { useState, useMemo, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, Loader2, X, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface BusinessContextStepProps {
  workspaceId: string;
  value: {
    companyName: string;
    businessType: string;
    isHiring: boolean;
    receivesInvoices: boolean;
    emailDomain: string;
    websiteUrl: string;
    serviceArea: string;
  };
  onChange: (value: any) => void;
  onNext: () => void;
  onBack: () => void;
}

interface PlacePrediction {
  description: string;
  place_id: string;
  original?: string;
}

interface ServiceArea {
  name: string;
  radius?: number; // in miles
}

const BUSINESS_TYPES = [
  { value: 'window_cleaning', label: 'Window Cleaning' },
  { value: 'carpet_cleaning', label: 'Carpet Cleaning' },
  { value: 'pressure_washing', label: 'Pressure Washing' },
  { value: 'general_cleaning', label: 'General Cleaning' },
  { value: 'dog_groomer', label: 'Dog Groomer' },
  { value: 'pet_services', label: 'Pet Services' },
  { value: 'plumber', label: 'Plumber' },
  { value: 'electrician', label: 'Electrician' },
  { value: 'locksmith', label: 'Locksmith' },
  { value: 'roofer', label: 'Roofer' },
  { value: 'painter_decorator', label: 'Painter & Decorator' },
  { value: 'landscaping', label: 'Landscaping' },
  { value: 'gardener', label: 'Gardener' },
  { value: 'mobile_mechanic', label: 'Mobile Mechanic' },
  { value: 'pest_control', label: 'Pest Control' },
  { value: 'removals', label: 'Removals' },
  { value: 'handyman', label: 'Handyman' },
  { value: 'property_maintenance', label: 'Property Maintenance' },
  { value: 'professional_services', label: 'Professional Services' },
  { value: 'other', label: 'Other' },
];

export function BusinessContextStep({ workspaceId, value, onChange, onNext, onBack }: BusinessContextStepProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [businessTypeSearch, setBusinessTypeSearch] = useState('');
  const [serviceAreaSearch, setServiceAreaSearch] = useState('');
  const [businessTypeFocused, setBusinessTypeFocused] = useState(false);
  const [serviceAreaFocused, setServiceAreaFocused] = useState(false);
  const [placePredictions, setPlacePredictions] = useState<PlacePrediction[]>([]);
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(false);

  // Parse service areas from pipe-separated string (supports radius like "Luton (20 miles)")
  const selectedAreas = useMemo((): ServiceArea[] => {
    if (!value.serviceArea) return [];
    // Support both old comma format and new pipe format
    const raw = value.serviceArea.includes(' | ') 
      ? value.serviceArea.split(' | ').map(s => s.trim()).filter(Boolean)
      : value.serviceArea.split(',').map(s => s.trim()).filter(Boolean);
    
    return raw.map(area => {
      // Parse radius if present: "Luton (20 miles)"
      const radiusMatch = area.match(/^(.+?)\s*\((\d+)\s*miles?\)$/i);
      if (radiusMatch) {
        return { name: radiusMatch[1].trim(), radius: parseInt(radiusMatch[2], 10) };
      }
      return { name: area, radius: undefined };
    });
  }, [value.serviceArea]);

  // Parse business types from comma-separated string
  const selectedBusinessTypes = useMemo(() => {
    if (!value.businessType) return [];
    return value.businessType.split(',').map(s => s.trim()).filter(Boolean);
  }, [value.businessType]);

  // Filter business types based on search (exclude already selected)
  const filteredBusinessTypes = useMemo(() => {
    if (!businessTypeSearch) return BUSINESS_TYPES.filter(type => !selectedBusinessTypes.includes(type.value) && !selectedBusinessTypes.includes(type.label)).slice(0, 8);
    const search = businessTypeSearch.toLowerCase();
    return BUSINESS_TYPES.filter(type => 
      (type.label.toLowerCase().includes(search) || 
      type.value.toLowerCase().includes(search)) &&
      !selectedBusinessTypes.includes(type.value) &&
      !selectedBusinessTypes.includes(type.label)
    ).slice(0, 8);
  }, [businessTypeSearch, selectedBusinessTypes]);

  // Debounced Google Places search
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

      // Filter out already selected areas
      const areaNames = selectedAreas.map(a => a.name);
      const filtered = (data.predictions || []).filter(
        (p: PlacePrediction) => !areaNames.includes(p.description)
      );
      setPlacePredictions(filtered);
    } catch (err) {
      console.error('Error fetching places:', err);
      setPlacePredictions([]);
    } finally {
      setIsLoadingPlaces(false);
    }
  }, [selectedAreas]);

  // Debounce the search
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

  const handleAddBusinessType = (typeLabel: string) => {
    const trimmed = typeLabel.trim();
    if (trimmed && !selectedBusinessTypes.includes(trimmed)) {
      const newTypes = [...selectedBusinessTypes, trimmed];
      onChange({ ...value, businessType: newTypes.join(', ') });
    }
    setBusinessTypeSearch('');
  };

  const handleSelectBusinessType = (type: { value: string; label: string }) => {
    handleAddBusinessType(type.label);
  };

  const handleRemoveBusinessType = (typeLabel: string) => {
    const newTypes = selectedBusinessTypes.filter(t => t !== typeLabel);
    onChange({ ...value, businessType: newTypes.join(', ') });
  };

  const handleBusinessTypeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && businessTypeSearch.trim()) {
      e.preventDefault();
      handleAddBusinessType(businessTypeSearch);
    }
  };

  const handleSelectLocation = (location: string, radius?: number) => {
    // The edge function already strips country suffix, but clean up just in case
    let cleanLocation = location.trim();
    const countryPattern = /, (UK|United Kingdom|USA|United States|Australia|Canada|Ireland|Germany|France|Italy|Spain|Netherlands|New Zealand|India|Poland|Czechia|South Korea|Malaysia|Belarus|England|Scotland|Wales|Northern Ireland)$/i;
    cleanLocation = cleanLocation.replace(countryPattern, '');
    
    const areaNames = selectedAreas.map(a => a.name);
    if (cleanLocation && !areaNames.includes(cleanLocation)) {
      const newArea: ServiceArea = { name: cleanLocation, radius };
      const newAreas = [...selectedAreas, newArea];
      // Serialize with radius: "Luton (20 miles)" or just "Luton"
      const serialized = newAreas.map(a => a.radius ? `${a.name} (${a.radius} miles)` : a.name).join(' | ');
      onChange({ ...value, serviceArea: serialized });
    }
    setServiceAreaSearch('');
    setPlacePredictions([]);
  };

  const handleUpdateRadius = (areaName: string, radius: number | undefined) => {
    const newAreas = selectedAreas.map(a => 
      a.name === areaName ? { ...a, radius } : a
    );
    const serialized = newAreas.map(a => a.radius ? `${a.name} (${a.radius} miles)` : a.name).join(' | ');
    onChange({ ...value, serviceArea: serialized });
  };

  const handleLocationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && serviceAreaSearch.trim()) {
      e.preventDefault();
      handleSelectLocation(serviceAreaSearch);
    }
  };

  const handleRemoveLocation = (areaName: string) => {
    const newAreas = selectedAreas.filter(a => a.name !== areaName);
    const serialized = newAreas.map(a => a.radius ? `${a.name} (${a.radius} miles)` : a.name).join(' | ');
    onChange({ ...value, serviceArea: serialized });
  };

  const handleSave = async () => {
    if (!value.companyName || selectedBusinessTypes.length === 0) {
      toast.error('Please enter your company name and select at least one business type');
      return;
    }

    setIsSaving(true);
    try {
      const { data: existing } = await supabase
        .from('business_context')
        .select('id')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      const contextData = {
        workspace_id: workspaceId,
        company_name: value.companyName,
        business_type: value.businessType,
        email_domain: value.emailDomain || null,
        website_url: value.websiteUrl || null,
        service_area: value.serviceArea || null,
        is_hiring: value.isHiring,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        await supabase
          .from('business_context')
          .update(contextData)
          .eq('id', existing.id);
      } else {
        await supabase.from('business_context').insert(contextData);
      }

      await supabase
        .from('workspaces')
        .update({ name: value.companyName })
        .eq('id', workspaceId);

      if (value.receivesInvoices) {
        const invoiceSenders = ['xero.com', 'quickbooks.com', 'sage.com', 'freshbooks.com', 'stripe.com', 'paypal.com'];
        for (const domain of invoiceSenders) {
          const { data: existingRule } = await supabase
            .from('sender_rules')
            .select('id')
            .eq('sender_pattern', `@${domain}`)
            .eq('workspace_id', workspaceId)
            .maybeSingle();

          if (!existingRule) {
            await supabase.from('sender_rules').insert({
              workspace_id: workspaceId,
              sender_pattern: `@${domain}`,
              default_classification: 'supplier_invoice',
              default_requires_reply: false,
              is_active: true,
            });
          }
        }
      }

      if (value.isHiring) {
        const jobPortals = ['indeed.com', 'linkedin.com', 'reed.co.uk', 'totaljobs.com', 'cv-library.co.uk', 'glassdoor.com'];
        for (const domain of jobPortals) {
          const { data: existingRule } = await supabase
            .from('sender_rules')
            .select('id')
            .eq('sender_pattern', `@${domain}`)
            .eq('workspace_id', workspaceId)
            .maybeSingle();

          if (!existingRule) {
            await supabase.from('sender_rules').insert({
              workspace_id: workspaceId,
              sender_pattern: `@${domain}`,
              default_classification: 'recruitment_hr',
              default_requires_reply: false,
              is_active: true,
            });
          }
        }
      }

      onNext();
    } catch (error) {
      console.error('Error saving business context:', error);
      toast.error('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">Tell us about your business</h2>
        <p className="text-sm text-muted-foreground">
          This helps BizzyBee understand your business and answer customer questions
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Your company name *</Label>
          <Input
            placeholder="e.g., Sarah's Dog Grooming"
            value={value.companyName}
            onChange={(e) => onChange({ ...value, companyName: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Used to identify your business in emails
          </p>
        </div>

        <div className="space-y-2">
          <Label>What type of business is this? *</Label>
          {selectedBusinessTypes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedBusinessTypes.map((typeLabel) => (
                <Badge key={typeLabel} variant="secondary" className="gap-1 pr-1">
                  {typeLabel}
                  <button
                    type="button"
                    onClick={() => handleRemoveBusinessType(typeLabel)}
                    className="ml-1 hover:bg-muted rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <div className="relative">
            <Input
              placeholder="Type your business type and press Enter..."
              value={businessTypeSearch}
              onChange={(e) => setBusinessTypeSearch(e.target.value)}
              onKeyDown={handleBusinessTypeKeyDown}
              onFocus={() => setBusinessTypeFocused(true)}
              onBlur={() => setTimeout(() => setBusinessTypeFocused(false), 150)}
            />
            {businessTypeFocused && (filteredBusinessTypes.length > 0 || (businessTypeSearch.trim() && !filteredBusinessTypes.some(t => t.label.toLowerCase() === businessTypeSearch.toLowerCase()))) && (
              <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                {businessTypeSearch.trim() && !filteredBusinessTypes.some(t => t.label.toLowerCase() === businessTypeSearch.toLowerCase()) && (
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground border-b"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleAddBusinessType(businessTypeSearch);
                    }}
                  >
                    Add "{businessTypeSearch.trim()}"
                  </button>
                )}
                {filteredBusinessTypes.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectBusinessType(type);
                    }}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Type any business type and press Enter, or select from suggestions
          </p>
        </div>

        <div className="space-y-2">
          <Label>Your website URL (optional)</Label>
          <Input
            placeholder="e.g., https://sarahsdoggrooming.co.uk"
            value={value.websiteUrl || ''}
            onChange={(e) => onChange({ ...value, websiteUrl: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            We'll extract your prices, services, and policies automatically
          </p>
        </div>

        <div className="space-y-2">
          <Label>Service areas (optional)</Label>
          {selectedAreas.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedAreas.map((area) => (
                <div key={area.name} className="flex items-center gap-1 bg-secondary rounded-md pl-2 pr-1 py-1">
                  <MapPin className="h-3 w-3 text-muted-foreground" />
                  <span className="text-sm">{area.name}</span>
                  <Select
                    value={area.radius?.toString() || 'exact'}
                    onValueChange={(val) => handleUpdateRadius(area.name, val === 'exact' ? undefined : parseInt(val, 10))}
                  >
                    <SelectTrigger className="h-6 w-auto min-w-[70px] text-xs border-0 bg-transparent px-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exact">exact</SelectItem>
                      <SelectItem value="5">+5 mi</SelectItem>
                      <SelectItem value="10">+10 mi</SelectItem>
                      <SelectItem value="15">+15 mi</SelectItem>
                      <SelectItem value="20">+20 mi</SelectItem>
                      <SelectItem value="30">+30 mi</SelectItem>
                      <SelectItem value="50">+50 mi</SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => handleRemoveLocation(area.name)}
                    className="hover:bg-muted rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="relative">
            <Input
              placeholder="Search for a location..."
              value={serviceAreaSearch}
              onChange={(e) => setServiceAreaSearch(e.target.value)}
              onKeyDown={handleLocationKeyDown}
              onFocus={() => setServiceAreaFocused(true)}
              onBlur={() => setTimeout(() => setServiceAreaFocused(false), 200)}
            />
            {serviceAreaFocused && (isLoadingPlaces || placePredictions.length > 0 || (serviceAreaSearch.trim().length >= 2 && !placePredictions.some(p => p.description.toLowerCase() === serviceAreaSearch.toLowerCase()))) && (
              <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                {isLoadingPlaces ? (
                  <div className="flex items-center justify-center py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Searching...
                  </div>
                ) : (
                  <>
                    {serviceAreaSearch.trim().length >= 2 && !placePredictions.some(p => p.description.toLowerCase() === serviceAreaSearch.toLowerCase()) && (
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground border-b"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectLocation(serviceAreaSearch);
                        }}
                      >
                        Add "{serviceAreaSearch.trim()}"
                      </button>
                    )}
                    {placePredictions.map((prediction) => (
                      <button
                        key={prediction.place_id}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectLocation(prediction.description);
                        }}
                      >
                        {prediction.description}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Search for cities, regions, or countries you serve
          </p>
        </div>

        <div className="space-y-2">
          <Label>Your business email domain</Label>
          <Input
            placeholder="e.g., sarahsdoggrooming.co.uk"
            value={value.emailDomain}
            onChange={(e) => onChange({ ...value, emailDomain: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Helps identify internal vs external emails
          </p>
        </div>

        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
          <div className="space-y-0.5">
            <Label>Are you currently hiring?</Label>
            <p className="text-xs text-muted-foreground">
              Helps us flag job applications separately
            </p>
          </div>
          <Switch
            checked={value.isHiring}
            onCheckedChange={(checked) => onChange({ ...value, isHiring: checked })}
          />
        </div>

        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
          <div className="space-y-0.5">
            <Label>Do you receive invoices by email?</Label>
            <p className="text-xs text-muted-foreground">
              Auto-sorts invoices from Xero, QuickBooks, etc.
            </p>
          </div>
          <Switch
            checked={value.receivesInvoices}
            onCheckedChange={(checked) => onChange({ ...value, receivesInvoices: checked })}
          />
        </div>
      </div>

      <div className="flex gap-3 pt-4">
        <Button
          variant="outline"
          className="flex-1"
          onClick={onBack}
        >
          <ChevronLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          className="flex-1"
          onClick={handleSave}
          disabled={isSaving || !value.companyName || selectedBusinessTypes.length === 0}
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              Continue
              <ChevronRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
