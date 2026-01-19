import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CheckCircle2, ChevronRight, Building, MapPin, Mail, Sparkles } from 'lucide-react';
import { BusinessProfileStep } from '@/components/onboarding/BusinessProfileStep';
import { LocationStep } from '@/components/onboarding/LocationStep';
import { EmailConnectionStep } from '@/components/onboarding/EmailConnectionStep';
import { VoiceAnalysisStep } from '@/components/onboarding/VoiceAnalysisStep';

const STEPS = [
  { id: 'profile', title: 'Business Profile', icon: Building, description: 'Tell us about your company' },
  { id: 'location', title: 'Location', icon: MapPin, description: 'Where do you operate?' },
  { id: 'email', title: 'Connect Email', icon: Mail, description: 'Link your Gmail account' },
  { id: 'voice', title: 'AI Training', icon: Sparkles, description: 'Learn your communication style' },
  { id: 'complete', title: 'All Set!', icon: CheckCircle2, description: 'Ready to go' }
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);

  // Calculate progress percentage
  const progress = ((currentStep) / (STEPS.length - 1)) * 100;

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleComplete = async () => {
    if (!user) return;
    setIsCompleting(true);
    try {
      // Mark onboarding as complete in Firestore
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        onboarding_step: STEPS.length,
        onboarding_completed: true,
      });

      // Redirect to dashboard
      // Force reload to ensure all guards leverage the new profile state
      window.location.href = '/';
    } catch (error) {
      console.error('Error completing onboarding:', error);
      setIsCompleting(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <BusinessProfileStep onNext={handleNext} />;
      case 1:
        return <LocationStep onNext={handleNext} onBack={handleBack} />;
      case 2:
        return <EmailConnectionStep onNext={handleNext} onBack={handleBack} />;
      case 3:
        return <VoiceAnalysisStep onNext={handleNext} onBack={handleBack} />;
      case 4:
        return (
          <div className="text-center space-y-6 py-8 animate-in fade-in zoom-in duration-500">
            <div className="mx-auto w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="w-12 h-12 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold">You're all set!</h2>
            <p className="text-muted-foreground">
              Your workspace is ready. BizzyBee is now active and monitoring your authorized channels.
            </p>
            <Button size="lg" className="w-full" onClick={handleComplete} disabled={isCompleting}>
              {isCompleting ? "Finishing Up..." : "Go to Dashboard"}
              {!isCompleting && <ChevronRight className="ml-2 w-4 h-4" />}
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50/50 p-4">
      <div className="w-full max-w-2xl space-y-8">
        {/* Progress Header */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm font-medium text-muted-foreground px-1">
            <span>Step {currentStep + 1} of {STEPS.length}</span>
            <span>{Math.round(progress)}% Complete</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <Card className="shadow-xl bg-white/80 backdrop-blur-sm border-t-4 border-t-primary">
          <CardHeader className="border-b bg-gray-50/50 pb-6">
            <div className="flex items-center gap-4">
              <div className="bg-primary/10 p-3 rounded-xl">
                {(() => {
                  const Icon = STEPS[currentStep].icon;
                  return <Icon className="w-6 h-6 text-primary" />;
                })()}
              </div>
              <div>
                <CardTitle className="text-xl">{STEPS[currentStep].title}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {STEPS[currentStep].description}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-8 min-h-[400px]">
            {renderStep()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
