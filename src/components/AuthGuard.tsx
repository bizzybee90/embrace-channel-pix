import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";
import { isOnboardingComplete } from "@/lib/onboardingStatus";

// DEV BYPASS: Skip auth during development
const DEV_BYPASS_AUTH = true;

export const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!DEV_BYPASS_AUTH);
  const checkingOnboardingRef = useRef(false);
  const hasCheckedOnboarding = useRef(false);
  const lastCheckedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (DEV_BYPASS_AUTH) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      
      if (!session) {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (DEV_BYPASS_AUTH) return;

    const checkOnboarding = async () => {
      if (!user || checkingOnboardingRef.current || hasCheckedOnboarding.current) return;
      if (lastCheckedUserIdRef.current && lastCheckedUserIdRef.current !== user.id) {
        hasCheckedOnboarding.current = false;
      }
      if (location.pathname === '/onboarding') return;

      checkingOnboardingRef.current = true;
      try {
        const { data: userData, error } = await supabase
          .from('users')
          .select('onboarding_completed, onboarding_step')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('Error checking onboarding status:', error);
          return;
        }

        hasCheckedOnboarding.current = true;
        lastCheckedUserIdRef.current = user.id;

        if (!isOnboardingComplete(userData)) {
          navigate('/onboarding');
        }
      } catch (error) {
        console.error('Error in onboarding check:', error);
      } finally {
        checkingOnboardingRef.current = false;
      }
    };

    checkOnboarding();
  }, [user, navigate, location.pathname]);

  if (DEV_BYPASS_AUTH) {
    return <>{children}</>;
  }

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

  if (!user || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
