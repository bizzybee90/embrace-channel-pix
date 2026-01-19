import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CheckCircle2 } from 'lucide-react';

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleComplete = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Mark onboarding as complete in Firestore
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        onboarding_step: 99, // signals complete
        onboarding_completed: true,
        workspace_id: `workspace-${user.uid.slice(0, 8)}` // placeholder workspace
      });

      // Force reload or just navigate? 
      // The useAuth hook listens to changes, but onSnapshot might be needed for real-time updates.
      // For now, simple navigation. If AuthGuard checks profile, it might lag if we don't update local state.
      // However, useAuth fetches profile on auth state change. It doesn't listen to profile changes real-time in the current impl 
      // (it uses getDoc, not onSnapshot).
      // So we might need to reload the page to refresh the profile in AuthContext, 
      // or we accept that the user might get kicked back if the context isn't updated.
      // Let's force a reload for safety in this "Rescue" phase.
      window.location.href = '/';

    } catch (error) {
      console.error('Error completing onboarding:', error);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">Welcome to BizzyBee!</CardTitle>
          <CardDescription>
            Let's get your workspace ready.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-blue-50 p-4 rounded-md text-blue-800 text-sm">
            <p className="font-semibold">Hello, {profile?.name || user?.email}!</p>
            <p>This is a simplified onboarding step to verify your account setup.</p>
          </div>

          <Button
            className="w-full h-12 text-lg"
            onClick={handleComplete}
            disabled={loading}
          >
            {loading ? "Setting up..." : "Complete Setup & Go to Dashboard"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
