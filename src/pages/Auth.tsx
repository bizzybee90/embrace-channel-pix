import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield } from "lucide-react";

const Auth = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    // Check if already authenticated
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate("/");
      }
    });

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session) {
          navigate("/");
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
          },
        });

        if (error) throw error;

        toast({
          title: "Success!",
          description: "Account created. You can now sign in.",
        });
        setIsSignUp(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        toast({
          title: "Welcome back!",
          description: "Successfully signed in.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setLoading(true);
    
    try {
      // Try to sign in with demo account first
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: "demo@agent.local",
        password: "demo123456",
      });

      if (signInError) {
        // If demo account doesn't exist, create it
        const { error: signUpError } = await supabase.auth.signUp({
          email: "demo@agent.local",
          password: "demo123456",
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              name: "Demo Agent"
            }
          },
        });

        if (signUpError) throw signUpError;

        // Try signing in again
        const { data: retryData, error: retryError } = await supabase.auth.signInWithPassword({
          email: "demo@agent.local",
          password: "demo123456",
        });

        if (retryError) throw retryError;
      }

      // After successful login, set up demo workspace and data
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setTimeout(async () => {
          try {
            await setupDemoData(user.id);
          } catch (error) {
            console.error('Error setting up demo data:', error);
          }
        }, 0);
      }

      toast({
        title: "Demo mode activated",
        description: "Signed in as demo agent with test data",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to access demo account",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const setupDemoData = async (userId: string) => {
    // Check if user already has a workspace
    const { data: userData } = await supabase
      .from('users')
      .select('workspace_id')
      .eq('id', userId)
      .single();

    let workspaceId = userData?.workspace_id;

    // Create workspace if it doesn't exist
    if (!workspaceId) {
      const { data: workspace, error: workspaceError } = await supabase
        .from('workspaces')
        .insert({
          name: 'Demo Workspace',
          slug: `demo-${userId.substring(0, 8)}`,
          timezone: 'America/New_York',
          business_hours_start: '09:00',
          business_hours_end: '17:00',
          business_days: [1, 2, 3, 4, 5]
        })
        .select()
        .single();

      if (workspaceError) throw workspaceError;
      workspaceId = workspace.id;

      // Update user's workspace_id
      await supabase
        .from('users')
        .update({ workspace_id: workspaceId })
        .eq('id', userId);
    }

    // Check if demo data already exists
    const { data: existingConversations } = await supabase
      .from('conversations')
      .select('id')
      .eq('workspace_id', workspaceId)
      .limit(1);

    if (existingConversations && existingConversations.length > 0) {
      return; // Demo data already exists
    }

    // Create demo customers
    const { data: customers, error: customersError } = await supabase
      .from('customers')
      .insert([
        {
          workspace_id: workspaceId,
          name: 'Sarah Johnson',
          email: 'sarah.j@example.com',
          phone: '+1-555-0123',
          tier: 'premium',
          preferred_channel: 'email'
        },
        {
          workspace_id: workspaceId,
          name: 'Mike Chen',
          email: 'mike.chen@example.com',
          phone: '+1-555-0456',
          tier: 'regular',
          preferred_channel: 'webchat'
        },
        {
          workspace_id: workspaceId,
          name: 'Emma Williams',
          email: 'emma.w@example.com',
          phone: '+1-555-0789',
          tier: 'vip',
          preferred_channel: 'phone'
        }
      ])
      .select();

    if (customersError) throw customersError;

    // Create demo conversations
    const now = new Date();
    const conversations = [
      {
        workspace_id: workspaceId,
        customer_id: customers[0].id,
        title: 'Billing Issue - Premium Account',
        channel: 'email',
        status: 'new',
        priority: 'high',
        category: 'billing',
        ai_sentiment: 'frustrated',
        ai_confidence: 0.87,
        ai_reason_for_escalation: 'Customer reports unauthorized charges on premium account',
        summary_for_human: 'Premium customer Sarah Johnson is concerned about unexpected charges',
        sla_status: 'safe',
        sla_target_minutes: 120,
        sla_due_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()
      },
      {
        workspace_id: workspaceId,
        customer_id: customers[1].id,
        title: 'Feature Request - API Integration',
        channel: 'webchat',
        status: 'new',
        priority: 'medium',
        category: 'technical',
        ai_sentiment: 'curious',
        ai_confidence: 0.92,
        ai_reason_for_escalation: 'Complex API integration question requiring technical expertise',
        summary_for_human: 'Mike Chen asking about custom API integration capabilities',
        sla_status: 'safe',
        sla_target_minutes: 240,
        sla_due_at: new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString()
      },
      {
        workspace_id: workspaceId,
        customer_id: customers[2].id,
        title: 'VIP - Urgent Account Access',
        channel: 'phone',
        status: 'new',
        priority: 'critical',
        category: 'account',
        ai_sentiment: 'urgent',
        ai_confidence: 0.95,
        ai_reason_for_escalation: 'VIP customer unable to access account, potential security issue',
        summary_for_human: 'VIP customer Emma Williams locked out of account',
        sla_status: 'at_risk',
        sla_target_minutes: 60,
        sla_due_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString()
      }
    ];

    const { data: createdConversations, error: conversationsError } = await supabase
      .from('conversations')
      .insert(conversations)
      .select();

    if (conversationsError) throw conversationsError;

    // Create demo messages for each conversation
    const messages = [
      {
        conversation_id: createdConversations[0].id,
        body: "I noticed some unusual charges on my premium account this month. I was charged twice for the same service. Can someone please look into this urgently?",
        channel: 'email',
        direction: 'inbound',
        actor_type: 'customer',
        actor_name: 'Sarah Johnson'
      },
      {
        conversation_id: createdConversations[1].id,
        body: "Hi, I'm building a custom integration with your API. I need to understand if your webhook system supports retry logic for failed deliveries. The documentation doesn't cover this scenario.",
        channel: 'webchat',
        direction: 'inbound',
        actor_type: 'customer',
        actor_name: 'Mike Chen'
      },
      {
        conversation_id: createdConversations[2].id,
        body: "This is extremely urgent. I cannot access my account and I have a critical presentation in 2 hours. I've tried resetting my password three times but I'm not receiving the reset emails. Please help immediately!",
        channel: 'phone',
        direction: 'inbound',
        actor_type: 'customer',
        actor_name: 'Emma Williams'
      }
    ];

    await supabase
      .from('messages')
      .insert(messages);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">
            {isSignUp ? "Create Agent Account" : "Agent Sign In"}
          </CardTitle>
          <CardDescription>
            {isSignUp
              ? "Create your account to access the escalation dashboard"
              : "Sign in to access the customer service escalation dashboard"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAuth} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="agent@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isSignUp ? "Creating account..." : "Signing in..."}
                </>
              ) : (
                <>{isSignUp ? "Create Account" : "Sign In"}</>
              )}
            </Button>
          </form>
          
          <div className="mt-4">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>
            
            <Button 
              type="button"
              variant="outline" 
              className="w-full mt-4" 
              onClick={handleDemoLogin}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Accessing demo...
                </>
              ) : (
                "Quick Demo Login"
              )}
            </Button>
          </div>
          
          <div className="mt-4 text-center text-sm">
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-primary hover:underline"
              disabled={loading}
            >
              {isSignUp
                ? "Already have an account? Sign in"
                : "Don't have an account? Sign up"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;