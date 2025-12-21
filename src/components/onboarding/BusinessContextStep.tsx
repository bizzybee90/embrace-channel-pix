import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface BusinessContextStepProps {
  workspaceId: string;
  value: {
    businessType: string;
    isHiring: boolean;
    receivesInvoices: boolean;
    emailDomain: string;
  };
  onChange: (value: any) => void;
  onNext: () => void;
  onBack: () => void;
}

const BUSINESS_TYPES = [
  'Window Cleaning',
  'Carpet Cleaning',
  'Pressure Washing',
  'General Cleaning',
  'Property Maintenance',
  'Plumbing',
  'Electrical',
  'Landscaping',
  'Other Trade',
  'Professional Services',
  'Other',
];

export function BusinessContextStep({ workspaceId, value, onChange, onNext, onBack }: BusinessContextStepProps) {
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Check if business_context exists
      const { data: existing } = await supabase
        .from('business_context')
        .select('id')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      const contextData = {
        workspace_id: workspaceId,
        is_hiring: value.isHiring,
        custom_flags: {
          business_type: value.businessType,
          receives_invoices: value.receivesInvoices,
          email_domain: value.emailDomain,
        },
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

      // If receiving invoices, create sender rules for common invoice senders
      if (value.receivesInvoices) {
        const invoiceSenders = ['xero.com', 'quickbooks.com', 'sage.com', 'freshbooks.com'];
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
        const jobPortals = ['indeed.com', 'linkedin.com', 'reed.co.uk', 'totaljobs.com', 'cv-library.co.uk'];
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
          This helps BizzyBee understand what's normal for your inbox
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>What type of business is this?</Label>
          <Select
            value={value.businessType}
            onValueChange={(v) => onChange({ ...value, businessType: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select business type" />
            </SelectTrigger>
            <SelectContent>
              {BUSINESS_TYPES.map((type) => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Your business email domain</Label>
          <Input
            placeholder="e.g., maccleaning.uk"
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
              We'll auto-file job notifications
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
              Normal business invoices, not misdirected ones
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
        <Button onClick={handleSave} className="flex-1" disabled={isSaving}>
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