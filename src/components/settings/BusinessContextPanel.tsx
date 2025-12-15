import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Briefcase, CreditCard, Shield, Plus, X, Loader2 } from 'lucide-react';

interface BusinessContext {
  id?: string;
  workspace_id?: string;
  is_hiring: boolean;
  active_stripe_case: boolean;
  active_insurance_claim: boolean;
  custom_flags: Record<string, boolean>;
}

export function BusinessContextPanel() {
  const { toast } = useToast();
  const [context, setContext] = useState<BusinessContext>({
    is_hiring: false,
    active_stripe_case: false,
    active_insurance_claim: false,
    custom_flags: {},
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newFlagName, setNewFlagName] = useState('');

  useEffect(() => {
    fetchContext();
  }, []);

  const fetchContext = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user.id)
        .single();

      if (!userData?.workspace_id) return;

      const { data, error } = await supabase
        .from('business_context')
        .select('*')
        .eq('workspace_id', userData.workspace_id)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setContext({
          id: data.id,
          workspace_id: data.workspace_id,
          is_hiring: data.is_hiring || false,
          active_stripe_case: data.active_stripe_case || false,
          active_insurance_claim: data.active_insurance_claim || false,
          custom_flags: (data.custom_flags as Record<string, boolean>) || {},
        });
      }
    } catch (error) {
      console.error('Error fetching business context:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveContext = async (updates: Partial<BusinessContext>) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user.id)
        .single();

      if (!userData?.workspace_id) throw new Error('No workspace');

      const newContext = { ...context, ...updates };
      setContext(newContext);

      const { error } = await supabase
        .from('business_context')
        .upsert({
          workspace_id: userData.workspace_id,
          is_hiring: newContext.is_hiring,
          active_stripe_case: newContext.active_stripe_case,
          active_insurance_claim: newContext.active_insurance_claim,
          custom_flags: newContext.custom_flags,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'workspace_id',
        });

      if (error) throw error;

      toast({ title: 'Business context updated' });
    } catch (error) {
      console.error('Error saving business context:', error);
      toast({ 
        title: 'Failed to save', 
        description: 'Please try again',
        variant: 'destructive' 
      });
    } finally {
      setSaving(false);
    }
  };

  const addCustomFlag = () => {
    if (!newFlagName.trim()) return;
    const key = newFlagName.trim().toLowerCase().replace(/\s+/g, '_');
    saveContext({
      custom_flags: { ...context.custom_flags, [key]: false },
    });
    setNewFlagName('');
  };

  const removeCustomFlag = (key: string) => {
    const newFlags = { ...context.custom_flags };
    delete newFlags[key];
    saveContext({ custom_flags: newFlags });
  };

  const toggleCustomFlag = (key: string) => {
    saveContext({
      custom_flags: { ...context.custom_flags, [key]: !context.custom_flags[key] },
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Briefcase className="h-5 w-5" />
          Business Context
        </CardTitle>
        <CardDescription>
          Tell the AI about your current business situation to improve email triage accuracy.
          When enabled, relevant emails will be flagged for action instead of auto-triaged.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Built-in Flags */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="is-hiring" className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-purple-500" />
                We're Hiring
              </Label>
              <p className="text-xs text-muted-foreground">
                Indeed and LinkedIn job applications will go to Action Required
              </p>
            </div>
            <Switch
              id="is-hiring"
              checked={context.is_hiring}
              onCheckedChange={(checked) => saveContext({ is_hiring: checked })}
              disabled={saving}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="stripe-case" className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-indigo-500" />
                Active Stripe Case
              </Label>
              <p className="text-xs text-muted-foreground">
                Stripe support emails will go to Action Required
              </p>
            </div>
            <Switch
              id="stripe-case"
              checked={context.active_stripe_case}
              onCheckedChange={(checked) => saveContext({ active_stripe_case: checked })}
              disabled={saving}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="insurance-claim" className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-500" />
                Active Insurance Claim
              </Label>
              <p className="text-xs text-muted-foreground">
                Insurance-related emails will go to Action Required
              </p>
            </div>
            <Switch
              id="insurance-claim"
              checked={context.active_insurance_claim}
              onCheckedChange={(checked) => saveContext({ active_insurance_claim: checked })}
              disabled={saving}
            />
          </div>
        </div>

        {/* Custom Flags */}
        <div className="border-t pt-4">
          <Label className="text-sm font-medium">Custom Flags</Label>
          <p className="text-xs text-muted-foreground mb-3">
            Add your own business context flags for specific situations
          </p>
          
          {Object.entries(context.custom_flags).length > 0 && (
            <div className="space-y-2 mb-4">
              {Object.entries(context.custom_flags).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                  <Label htmlFor={`custom-${key}`} className="text-sm capitalize">
                    {key.replace(/_/g, ' ')}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`custom-${key}`}
                      checked={value}
                      onCheckedChange={() => toggleCustomFlag(key)}
                      disabled={saving}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCustomFlag(key)}
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Input
              placeholder="New flag name (e.g., 'pending lawsuit')"
              value={newFlagName}
              onChange={(e) => setNewFlagName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomFlag()}
              className="text-sm"
            />
            <Button variant="outline" size="sm" onClick={addCustomFlag}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
