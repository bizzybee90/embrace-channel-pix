import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, Loader2, Check, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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
  const [businessTypeOpen, setBusinessTypeOpen] = useState(false);
  const [businessTypeSearch, setBusinessTypeSearch] = useState('');

  // Filter business types based on search
  const filteredBusinessTypes = useMemo(() => {
    if (!businessTypeSearch) return BUSINESS_TYPES;
    const search = businessTypeSearch.toLowerCase();
    return BUSINESS_TYPES.filter(type => 
      type.label.toLowerCase().includes(search) || 
      type.value.toLowerCase().includes(search)
    );
  }, [businessTypeSearch]);

  const handleSave = async () => {
    if (!value.companyName || !value.businessType) {
      toast.error('Please enter your company name and select a business type');
      return;
    }

    setIsSaving(true);
    try {
      // Check if business_context exists
      const { data: existing } = await supabase
        .from('business_context')
        .select('id')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      // Save to proper columns instead of custom_flags
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

      // Update workspace name
      await supabase
        .from('workspaces')
        .update({ name: value.companyName })
        .eq('id', workspaceId);

      // If receiving invoices, create sender rules for common invoice senders
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

      // If hiring, create rules for job portals
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

  const selectedBusinessType = BUSINESS_TYPES.find(t => t.value === value.businessType);

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
          <Popover open={businessTypeOpen} onOpenChange={setBusinessTypeOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={businessTypeOpen}
                className="w-full justify-between font-normal"
              >
                {selectedBusinessType?.label || "Search or select business type..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0" align="start">
              <Command>
                <CommandInput 
                  placeholder="Type to search..." 
                  value={businessTypeSearch}
                  onValueChange={setBusinessTypeSearch}
                />
                <CommandList>
                  <CommandEmpty>
                    {businessTypeSearch ? (
                      <CommandItem
                        onSelect={() => {
                          const customValue = businessTypeSearch.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                          onChange({ ...value, businessType: customValue });
                          setBusinessTypeOpen(false);
                          setBusinessTypeSearch('');
                        }}
                      >
                        <Check className="mr-2 h-4 w-4 opacity-0" />
                        Use "{businessTypeSearch}"
                      </CommandItem>
                    ) : (
                      "No business type found."
                    )}
                  </CommandEmpty>
                  <CommandGroup>
                    {filteredBusinessTypes.map((type) => (
                      <CommandItem
                        key={type.value}
                        value={type.label}
                        onSelect={() => {
                          onChange({ ...value, businessType: type.value });
                          setBusinessTypeOpen(false);
                          setBusinessTypeSearch('');
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            value.businessType === type.value ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {type.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <p className="text-xs text-muted-foreground">
            Helps load industry-specific knowledge
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
          <Label>Service area (optional)</Label>
          <Input
            placeholder="e.g., Leeds, Wakefield, Bradford"
            value={value.serviceArea || ''}
            onChange={(e) => onChange({ ...value, serviceArea: e.target.value })}
          />
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
          disabled={isSaving || !value.companyName || !value.businessType}
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
