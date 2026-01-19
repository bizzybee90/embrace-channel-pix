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

  // Check onboarding status ONCE after user is loaded
  useEffect(() => {
    if (loading || !user || !profile || hasCheckedOnboarding.current) return;

    // Skip onboarding check if already on onboarding page
    if (location.pathname === '/onboarding') return;

    // Check profile.onboarding_completed based on new Firestore schema/logic
    // If we assume the profile in context is up to date:
    if (profile.onboarding_completed === false) {
      navigate('/onboarding');
    }

    hasCheckedOnboarding.current = true;
  }, [user, profile, loading, navigate, location.pathname]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect via effect
  }

  return <>{children}</>;
};