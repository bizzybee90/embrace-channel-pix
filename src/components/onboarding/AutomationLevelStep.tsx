import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, Loader2, Shield, Scale, Zap } from 'lucide-react';
import { toast } from 'sonner';

interface AutomationLevelStepProps {
  workspaceId: string;
  onNext: () => void;
  onBack: () => void;
}

type AutomationLevel = 'safe' | 'balanced' | 'auto';

const levels: { value: AutomationLevel; icon: React.ReactNode; label: string; description: string }[] = [
  {
    value: 'safe',
    icon: <Shield className="h-6 w-6 text-blue-500" />,
    label: 'Safe Mode',
    description: 'Everything goes to Review first. You approve before BizzyBee acts.',
  },
  {
    value: 'balanced',
    icon: <Scale className="h-6 w-6 text-amber-500" />,
    label: 'Balanced (Recommended)',
    description: 'High-confidence items auto-handled. Low-confidence goes to Review.',
  },
  {
    value: 'auto',
    icon: <Zap className="h-6 w-6 text-green-500" />,
    label: 'Fully Automatic',
    description: 'BizzyBee handles everything. Only urgent items interrupt you.',
  },
];

export function AutomationLevelStep({ workspaceId, onNext, onBack }: AutomationLevelStepProps) {
  const [selected, setSelected] = useState<AutomationLevel>('balanced');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Save automation level preference to user settings
      await supabase
        .from('users')
        .update({
          interface_mode: selected === 'safe' ? 'review_first' : selected === 'auto' ? 'auto' : 'focus',
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      // Update business context with automation preference
      const { data: existing } = await supabase
        .from('business_context')
        .select('id, custom_flags')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('business_context')
          .update({
            custom_flags: {
              ...(existing.custom_flags as object || {}),
              automation_level: selected,
              onboarding_completed: true,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        await supabase.from('business_context').insert({
          workspace_id: workspaceId,
          custom_flags: {
            automation_level: selected,
            onboarding_completed: true,
          },
        });
      }

      onNext();
    } catch (error) {
      console.error('Error saving automation level:', error);
      toast.error('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">Choose your automation level</h2>
        <p className="text-sm text-muted-foreground">
          You can change this anytime in Settings
        </p>
      </div>

      <RadioGroup
        value={selected}
        onValueChange={(v) => setSelected(v as AutomationLevel)}
        className="space-y-3"
      >
        {levels.map((level) => (
          <Card
            key={level.value}
            className={`p-4 cursor-pointer transition-colors ${
              selected === level.value 
                ? 'border-primary bg-primary/5' 
                : 'hover:bg-muted/50'
            }`}
            onClick={() => setSelected(level.value)}
          >
            <div className="flex items-start gap-4">
              <RadioGroupItem value={level.value} id={level.value} className="mt-1" />
              <div className="flex-1">
                <Label htmlFor={level.value} className="flex items-center gap-2 cursor-pointer">
                  {level.icon}
                  <span className="font-medium">{level.label}</span>
                </Label>
                <p className="text-sm text-muted-foreground mt-1">{level.description}</p>
              </div>
            </div>
          </Card>
        ))}
      </RadioGroup>

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
          Finish Setup
        </Button>
      </div>
    </div>
  );
}