import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface BusinessContextStepProps {
  workspaceId: string;
  value: {
    companyName: string;
    businessType: string; // Now comma-separated for multiple types
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

const UK_LOCATIONS = [
  'Aberdeen', 'Aberystwyth', 'Aylesbury', 'Bangor', 'Barnsley', 'Basildon', 'Basingstoke', 
  'Bath', 'Bedford', 'Belfast', 'Birkenhead', 'Birmingham', 'Blackburn', 'Blackpool', 
  'Bolton', 'Bournemouth', 'Bradford', 'Brighton', 'Bristol', 'Burnley', 'Burton upon Trent',
  'Bury', 'Cambridge', 'Canterbury', 'Cardiff', 'Carlisle', 'Chelmsford', 'Cheltenham', 
  'Chester', 'Chesterfield', 'Chichester', 'Colchester', 'Coventry', 'Crawley', 'Crewe',
  'Darlington', 'Derby', 'Doncaster', 'Dorchester', 'Dudley', 'Dundee', 'Durham', 
  'Eastbourne', 'Edinburgh', 'Exeter', 'Gateshead', 'Glasgow', 'Gloucester', 'Grimsby',
  'Guildford', 'Halifax', 'Harrogate', 'Hartlepool', 'Hastings', 'Hereford', 'Huddersfield',
  'Hull', 'Inverness', 'Ipswich', 'Kettering', 'Kingston upon Hull', 'Lancaster', 'Leeds',
  'Leicester', 'Lichfield', 'Lincoln', 'Liverpool', 'London', 'Luton', 'Maidstone',
  'Manchester', 'Mansfield', 'Middlesbrough', 'Milton Keynes', 'Newcastle upon Tyne',
  'Newport', 'Northampton', 'Norwich', 'Nottingham', 'Oldham', 'Oxford', 'Peterborough',
  'Plymouth', 'Poole', 'Portsmouth', 'Preston', 'Reading', 'Redditch', 'Rochdale',
  'Rotherham', 'Salford', 'Salisbury', 'Scarborough', 'Sheffield', 'Shrewsbury', 'Slough',
  'Solihull', 'Southampton', 'Southend-on-Sea', 'Southport', 'St Albans', 'Stafford',
  'Stevenage', 'Stockport', 'Stoke-on-Trent', 'Sunderland', 'Sutton Coldfield', 'Swansea',
  'Swindon', 'Telford', 'Torquay', 'Wakefield', 'Walsall', 'Warrington', 'Watford',
  'Wigan', 'Winchester', 'Woking', 'Wolverhampton', 'Worcester', 'Worthing', 'Wrexham', 'York'
];

export function BusinessContextStep({ workspaceId, value, onChange, onNext, onBack }: BusinessContextStepProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [businessTypeSearch, setBusinessTypeSearch] = useState('');
  const [serviceAreaSearch, setServiceAreaSearch] = useState('');
  const [businessTypeFocused, setBusinessTypeFocused] = useState(false);
  const [serviceAreaFocused, setServiceAreaFocused] = useState(false);

  // Parse service areas from comma-separated string
  const selectedAreas = useMemo(() => {
    if (!value.serviceArea) return [];
    return value.serviceArea.split(',').map(s => s.trim()).filter(Boolean);
  }, [value.serviceArea]);

  // Parse business types from comma-separated string
  const selectedBusinessTypes = useMemo(() => {
    if (!value.businessType) return [];
    return value.businessType.split(',').map(s => s.trim()).filter(Boolean);
  }, [value.businessType]);

  // Filter business types based on search (exclude already selected) - also check labels
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

  // Filter locations based on search - show suggestions but allow any input
  const filteredLocations = useMemo(() => {
    if (!serviceAreaSearch) return [];
    const search = serviceAreaSearch.toLowerCase();
    return UK_LOCATIONS
      .filter(loc => loc.toLowerCase().includes(search) && !selectedAreas.includes(loc))
      .slice(0, 6);
  }, [serviceAreaSearch, selectedAreas]);

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

  const handleSelectLocation = (location: string) => {
    const trimmed = location.trim();
    if (trimmed && !selectedAreas.includes(trimmed)) {
      const newAreas = [...selectedAreas, trimmed];
      onChange({ ...value, serviceArea: newAreas.join(', ') });
    }
    setServiceAreaSearch('');
  };

  const handleLocationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && serviceAreaSearch.trim()) {
      e.preventDefault();
      handleSelectLocation(serviceAreaSearch);
    }
  };

  const handleRemoveLocation = (location: string) => {
    const newAreas = selectedAreas.filter(a => a !== location);
    onChange({ ...value, serviceArea: newAreas.join(', ') });
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
                {/* Show custom entry option if not matching a suggestion */}
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
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedAreas.map((area) => (
                <Badge key={area} variant="secondary" className="gap-1 pr-1">
                  {area}
                  <button
                    type="button"
                    onClick={() => handleRemoveLocation(area)}
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
              placeholder="Type a location and press Enter..."
              value={serviceAreaSearch}
              onChange={(e) => setServiceAreaSearch(e.target.value)}
              onKeyDown={handleLocationKeyDown}
              onFocus={() => setServiceAreaFocused(true)}
              onBlur={() => setTimeout(() => setServiceAreaFocused(false), 150)}
            />
            {serviceAreaFocused && (filteredLocations.length > 0 || (serviceAreaSearch.trim() && !filteredLocations.some(l => l.toLowerCase() === serviceAreaSearch.toLowerCase()))) && (
              <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                {/* Show custom entry option if not in suggestions */}
                {serviceAreaSearch.trim() && !filteredLocations.some(l => l.toLowerCase() === serviceAreaSearch.toLowerCase()) && (
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
                {filteredLocations.map((location) => (
                  <button
                    key={location}
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectLocation(location);
                    }}
                  >
                    {location}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Type any location and press Enter, or select from suggestions
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
              We'll auto-file job applications
            </p>
          </div>
          <Switch
            checked={value.isHiring}
            onCheckedChange={(v) => onChange({ ...value, isHiring: v })}
          />
        </div>

        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
          <div className="space-y-0.5">
            <Label>Do you receive invoices from suppliers?</Label>
            <p className="text-xs text-muted-foreground">
              We'll recognize accounting software emails
            </p>
          </div>
          <Switch
            checked={value.receivesInvoices}
            onCheckedChange={(v) => onChange({ ...value, receivesInvoices: v })}
          />
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button 
          onClick={handleSave} 
          className="flex-1" 
          disabled={isSaving || !value.companyName || selectedBusinessTypes.length === 0}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <ChevronRight className="h-4 w-4 mr-2" />
          )}
          Continue
        </Button>
      </div>
    </div>
  );
}
