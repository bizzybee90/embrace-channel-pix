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
    if (location.pathname.startsWith('/onboarding')) {
      // If user is already completed but tries to access onboarding, maybe redirect to dashboard?
      // Or let them revisit? For now, let them revisit if they want, but typically we might block.
      // But if they are NOT complete, they are in the right place.
      return;
    }

    // Check if onboarding is needed
    // We check the explicit boolean flag 'onboarding_completed'
    if (profile.onboarding_completed !== true) {
      console.log("Onboarding incomplete, redirecting to wizard.");
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