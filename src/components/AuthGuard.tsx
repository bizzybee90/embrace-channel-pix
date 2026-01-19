import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";

export const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, loading } = useAuth();
  const hasCheckedOnboarding = useRef(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  // Check onboarding status
  useEffect(() => {
    // Wait for everything to be ready
    if (loading || !user || !profile) return;

    // Prevent redirect loops
    if (location.pathname.startsWith('/onboarding')) return;

    // Check if onboarding is needed
    // Assuming '0' means not started or complete.
    // If onboarding_step is missing or less than "complete" (e.g. 5 steps), redirect.
    // For now, let's say step 0 means "Needs Onboarding".
    // Or if `onboarding_completed` flag exists?
    // The previous prompt suggested `profile?.onboarding_step === 0`.

    // Safety check: Don't redirect if we already checked to avoid fighting navigation
    if (hasCheckedOnboarding.current) return;

    if (profile.onboarding_step === 0 || profile.onboarding_step === undefined) {
      console.log("Redirecting to onboarding due to step:", profile.onboarding_step);
      navigate('/onboarding');
      hasCheckedOnboarding.current = true;
    }

  }, [user, profile, loading, navigate, location.pathname]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your workspace...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect via effect
  }

  return <>{children}</>;
};