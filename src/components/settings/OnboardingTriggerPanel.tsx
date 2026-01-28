import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { RotateCcw, Loader2 } from 'lucide-react';

interface OnboardingTriggerPanelProps {
  workspaceId: string;
}

export function OnboardingTriggerPanel({ workspaceId }: OnboardingTriggerPanelProps) {
  const [isResetting, setIsResetting] = useState(false);
  const navigate = useNavigate();

  const handleRerunOnboarding = async () => {
    setIsResetting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Reset onboarding status
      await supabase
        .from('users')
        .update({
          onboarding_completed: false,
          onboarding_step: 'business_context',
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      toast.success('Redirecting to onboarding...');
      navigate('/onboarding');
    } catch (error) {
      console.error('Error resetting onboarding:', error);
      toast.error('Failed to start onboarding');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Re-run the setup wizard to reconfigure your business details, connect new email accounts, or adjust your automation preferences.
      </p>
      <Button 
        onClick={handleRerunOnboarding} 
        disabled={isResetting}
        variant="outline"
      >
        {isResetting ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <RotateCcw className="h-4 w-4 mr-2" />
        )}
        Re-run Setup Wizard
      </Button>
    </div>
  );
}
