import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

export default function Onboarding() {
  const navigate = useNavigate();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialCheckDone, setInitialCheckDone] = useState(false);

  useEffect(() => {
    const checkOnboardingStatus = async () => {
      try {
        // Wait for session to be ready
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session?.user) {
          navigate('/auth');
          return;
        }

        const user = session.user;

        // Get user's workspace and onboarding status
        const { data: userData, error } = await supabase
          .from('users')
          .select('workspace_id, onboarding_completed')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('Error fetching user:', error);
          navigate('/auth');
          return;
        }

        // If already onboarded, go to home
        if (userData?.onboarding_completed) {
          navigate('/');
          return;
        }

        // If no workspace, we need to create one
        if (!userData?.workspace_id) {
          // Create a default workspace for the user
          const { data: workspace, error: wsError } = await supabase
            .from('workspaces')
            .insert({
              name: 'My Workspace',
              slug: `workspace-${user.id.slice(0, 8)}`,
            })
            .select()
            .single();

          if (wsError) {
            console.error('Error creating workspace:', wsError);
            setLoading(false);
            setInitialCheckDone(true);
            return;
          }

          // Update user with workspace
          await supabase
            .from('users')
            .update({ workspace_id: workspace.id })
            .eq('id', user.id);

          setWorkspaceId(workspace.id);
        } else {
          setWorkspaceId(userData.workspace_id);
        }
      } catch (error) {
        console.error('Error in onboarding check:', error);
      } finally {
        setLoading(false);
        setInitialCheckDone(true);
      }
    };

    checkOnboardingStatus();
  }, [navigate]);

  const handleComplete = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Mark onboarding as complete
        await supabase
          .from('users')
          .update({ 
            onboarding_completed: true,
            onboarding_step: 'complete'
          })
          .eq('id', user.id);
      }
      navigate('/');
    } catch (error) {
      console.error('Error completing onboarding:', error);
      navigate('/');
    }
  };

  // Show loading spinner while checking auth/onboarding status
  if (loading || !initialCheckDone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Loading onboarding...</p>
        </div>
      </div>
    );
  }

  // Show workspace setup if still waiting for workspace
  if (!workspaceId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Setting up your workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <OnboardingWizard 
      workspaceId={workspaceId} 
      onComplete={handleComplete} 
    />
  );
}
