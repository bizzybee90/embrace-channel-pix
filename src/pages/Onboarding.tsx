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
    let isMounted = true;

    const checkOnboardingStatus = async () => {
      try {
        console.log('[Onboarding] Starting check...');
        
        // Wait for session to be ready
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session?.user) {
          console.log('[Onboarding] No session, redirecting to auth');
          navigate('/auth');
          return;
        }

        const user = session.user;
        console.log('[Onboarding] User found:', user.id);

        // Get user's workspace and onboarding status
        const { data: userData, error } = await supabase
          .from('users')
          .select('workspace_id, onboarding_completed')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('[Onboarding] Error fetching user:', error);
          navigate('/auth');
          return;
        }

        console.log('[Onboarding] User data:', userData);

        // If already onboarded, go to home
        if (userData?.onboarding_completed) {
          console.log('[Onboarding] Already completed, going home');
          navigate('/');
          return;
        }

        // If no workspace, we need to create one
        if (!userData?.workspace_id) {
          console.log('[Onboarding] No workspace, creating one...');
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
            console.error('[Onboarding] Error creating workspace:', wsError);
            if (isMounted) {
              setLoading(false);
              setInitialCheckDone(true);
            }
            return;
          }

          // Update user with workspace
          await supabase
            .from('users')
            .update({ workspace_id: workspace.id })
            .eq('id', user.id);

          console.log('[Onboarding] Workspace created:', workspace.id);
          if (isMounted) {
            setWorkspaceId(workspace.id);
          }
        } else {
          console.log('[Onboarding] Using existing workspace:', userData.workspace_id);
          if (isMounted) {
            setWorkspaceId(userData.workspace_id);
          }
        }
      } catch (error) {
        console.error('[Onboarding] Error in check:', error);
      } finally {
        if (isMounted) {
          setLoading(false);
          setInitialCheckDone(true);
        }
      }
    };

    checkOnboardingStatus();

    return () => {
      isMounted = false;
    };
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
