import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { BusinessContextStep } from './BusinessContextStep';
import { SenderRecognitionStep } from './SenderRecognitionStep';
import { InitialTriageStep } from './InitialTriageStep';
import { AutomationLevelStep } from './AutomationLevelStep';
import beeLogo from '@/assets/bee-logo.png';
import { CheckCircle2 } from 'lucide-react';

interface OnboardingWizardProps {
  workspaceId: string;
  onComplete: () => void;
}

type Step = 'welcome' | 'business' | 'senders' | 'triage' | 'automation' | 'complete';

const STEPS: Step[] = ['welcome', 'business', 'senders', 'triage', 'automation', 'complete'];

export function OnboardingWizard({ workspaceId, onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [businessContext, setBusinessContext] = useState({
    businessType: '',
    isHiring: false,
    receivesInvoices: true,
    emailDomain: '',
  });
  const [senderRulesCreated, setSenderRulesCreated] = useState(0);
  const [triageResults, setTriageResults] = useState({ processed: 0, changed: 0 });

  const stepIndex = STEPS.indexOf(currentStep);
  const progress = (stepIndex / (STEPS.length - 1)) * 100;

  const handleNext = () => {
    const nextIndex = stepIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex]);
    }
  };

  const handleBack = () => {
    const prevIndex = stepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex]);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <img src={beeLogo} alt="BizzyBee" className="h-16 w-16 rounded-2xl" />
          </div>
          {currentStep !== 'welcome' && currentStep !== 'complete' && (
            <Progress value={progress} className="h-2 mb-4" />
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {currentStep === 'welcome' && (
            <div className="text-center space-y-6 py-8">
              <div className="space-y-2">
                <CardTitle className="text-2xl">Welcome to BizzyBee</CardTitle>
                <CardDescription className="text-base">
                  Let's set things up so BizzyBee learns how YOU handle your inbox.
                  <br />This takes about 3 minutes.
                </CardDescription>
              </div>
              <Button onClick={handleNext} size="lg" className="px-8">
                Let's Go
              </Button>
            </div>
          )}

          {currentStep === 'business' && (
            <BusinessContextStep
              workspaceId={workspaceId}
              value={businessContext}
              onChange={setBusinessContext}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentStep === 'senders' && (
            <SenderRecognitionStep
              workspaceId={workspaceId}
              onRulesCreated={(count) => setSenderRulesCreated(count)}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentStep === 'triage' && (
            <InitialTriageStep
              workspaceId={workspaceId}
              onComplete={(results) => {
                setTriageResults(results);
                handleNext();
              }}
              onBack={handleBack}
            />
          )}

          {currentStep === 'automation' && (
            <AutomationLevelStep
              workspaceId={workspaceId}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentStep === 'complete' && (
            <div className="text-center space-y-6 py-8">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <div className="space-y-2">
                <CardTitle className="text-2xl">You're All Set!</CardTitle>
                <CardDescription className="text-base">
                  BizzyBee is now configured for your inbox.
                </CardDescription>
              </div>
              
              <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto">
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-primary">{senderRulesCreated}</div>
                  <div className="text-sm text-muted-foreground">Rules created</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-600">{triageResults.changed}</div>
                  <div className="text-sm text-muted-foreground">Emails sorted</div>
                </div>
              </div>

              <Button onClick={onComplete} size="lg" className="px-8">
                Start Using BizzyBee
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}