import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { BusinessContextStep } from './BusinessContextStep';
import { KnowledgeBaseStep } from './KnowledgeBaseStep';
import { SenderRecognitionStep } from './SenderRecognitionStep';
import { InboxLearningStep } from './InboxLearningStep';
import { ReviewLearningStep } from './ReviewLearningStep';
import { AutomationLevelStep } from './AutomationLevelStep';
import { EmailConnectionStep } from './EmailConnectionStep';
import { CompetitorResearchStep } from './CompetitorResearchStep';
import bizzybeelogo from '@/assets/bizzybee-logo.png';
import { CheckCircle2, Mail, BookOpen } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface OnboardingWizardProps {
  workspaceId: string;
  onComplete: () => void;
}

type Step = 'welcome' | 'email' | 'business' | 'knowledge' | 'competitors' | 'senders' | 'triage' | 'automation' | 'review' | 'complete';

// Review step moved AFTER automation - it should be the final step before complete
const STEPS: Step[] = ['welcome', 'email', 'business', 'knowledge', 'competitors', 'senders', 'triage', 'automation', 'review', 'complete'];

export function OnboardingWizard({ workspaceId, onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [businessContext, setBusinessContext] = useState({
    companyName: '',
    businessType: '',
    isHiring: false,
    receivesInvoices: true,
    emailDomain: '',
    websiteUrl: '',
    serviceArea: '',
  });
  const [senderRulesCreated, setSenderRulesCreated] = useState(0);
  const [triageResults, setTriageResults] = useState({ processed: 0, changed: 0 });
  const [knowledgeResults, setKnowledgeResults] = useState({ industryFaqs: 0, websiteFaqs: 0 });
  const [competitorResults, setCompetitorResults] = useState({ sitesScraped: 0, faqsGenerated: 0 });
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);

  // Save progress to database
  const saveProgress = async (step: Step) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('users')
          .update({ onboarding_step: step })
          .eq('id', user.id);
      }
    } catch (error) {
      console.error('Error saving progress:', error);
    }
  };

  // Load saved progress on mount
  useEffect(() => {
    const loadProgress = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase
            .from('users')
            .select('onboarding_step')
            .eq('id', user.id)
            .single();
          
          if (data?.onboarding_step && STEPS.includes(data.onboarding_step as Step)) {
            setCurrentStep(data.onboarding_step as Step);
          }

          // Check if email is already connected
          const { data: emailConfig } = await supabase
            .from('email_provider_configs')
            .select('email_address')
            .eq('workspace_id', workspaceId)
            .limit(1)
            .single();
          
          if (emailConfig?.email_address) {
            setConnectedEmail(emailConfig.email_address);
          }
        }
      } catch (error) {
        console.error('Error loading progress:', error);
      }
    };
    loadProgress();
  }, [workspaceId]);

  const stepIndex = STEPS.indexOf(currentStep);
  const progress = (stepIndex / (STEPS.length - 1)) * 100;

  const handleNext = async () => {
    const nextIndex = stepIndex + 1;
    if (nextIndex < STEPS.length) {
      const nextStep = STEPS[nextIndex];
      setCurrentStep(nextStep);
      await saveProgress(nextStep);
    }
  };

  const handleBack = async () => {
    const prevIndex = stepIndex - 1;
    if (prevIndex >= 0) {
      const prevStep = STEPS[prevIndex];
      setCurrentStep(prevStep);
      await saveProgress(prevStep);
    }
  };

  const totalFaqs = knowledgeResults.industryFaqs + knowledgeResults.websiteFaqs;

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-6">
      <Card className={`w-full max-w-2xl shadow-lg shadow-black/5 border-border/50 ${currentStep === 'welcome' ? 'p-10' : ''}`}>
        <CardHeader className="text-center pb-2">
          {/* Logo - Bold, prominent brand presence */}
          <div className={`flex justify-center ${currentStep === 'welcome' ? 'pt-4 mb-14' : 'mb-8'}`}>
            <img 
              src={bizzybeelogo} 
              alt="BizzyBee" 
              className={currentStep === 'welcome' ? 'h-56 w-auto' : 'h-24 w-auto'}
            />
          </div>
          {currentStep !== 'welcome' && currentStep !== 'complete' && (
            <Progress value={progress} className="h-2 mb-4" />
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {currentStep === 'welcome' && (
            <div className="text-center space-y-10 py-2">
              {/* Headline - Reassuring and confident */}
              <div className="space-y-5">
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
                  Your calm inbox starts here
                </h1>
                {/* Supporting copy - Softer, unified paragraph */}
                <p className="text-muted-foreground/80 max-w-sm mx-auto leading-relaxed">
                  We'll set things up together so BizzyBee learns how you work. It only takes a few minutes.
                </p>
              </div>
              {/* CTA - Intentional, inviting */}
              <Button 
                onClick={handleNext} 
                size="lg" 
                className="px-14 py-7 text-base font-medium rounded-2xl bg-primary hover:bg-primary/90 shadow-md shadow-primary/20 transition-all hover:shadow-lg hover:shadow-primary/25"
              >
                Get started
              </Button>
            </div>
          )}

          {currentStep === 'email' && (
            <EmailConnectionStep
              workspaceId={workspaceId}
              onEmailConnected={(email) => setConnectedEmail(email)}
              onNext={handleNext}
              onBack={handleBack}
            />
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

          {currentStep === 'knowledge' && (
            <KnowledgeBaseStep
              workspaceId={workspaceId}
              businessContext={{
                companyName: businessContext.companyName,
                businessType: businessContext.businessType,
                websiteUrl: businessContext.websiteUrl,
              }}
              onComplete={(results) => {
                setKnowledgeResults(results);
                handleNext();
              }}
              onBack={handleBack}
            />
          )}

          {currentStep === 'competitors' && (
            <CompetitorResearchStep
              workspaceId={workspaceId}
              businessContext={{
                companyName: businessContext.companyName,
                businessType: businessContext.businessType,
                serviceArea: businessContext.serviceArea,
              }}
              onComplete={(results) => {
                setCompetitorResults(results);
                handleNext();
              }}
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
            <InboxLearningStep
              workspaceId={workspaceId}
              onComplete={(results) => {
                setTriageResults({ processed: results.emailsAnalyzed, changed: results.patternsLearned });
                handleNext();
              }}
              onBack={handleBack}
            />
          )}

          {currentStep === 'review' && (
            <ReviewLearningStep
              workspaceId={workspaceId}
              onComplete={handleNext}
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
              
              <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-primary">{senderRulesCreated}</div>
                  <div className="text-xs text-muted-foreground">Rules created</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-600">{triageResults.changed}</div>
                  <div className="text-xs text-muted-foreground">Emails sorted</div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-blue-600">{totalFaqs}</div>
                  <div className="text-xs text-muted-foreground">FAQs ready</div>
                </div>
              </div>

              {connectedEmail && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span>Connected: {connectedEmail}</span>
                </div>
              )}

              {totalFaqs > 0 && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <BookOpen className="h-4 w-4" />
                  <span>
                    {knowledgeResults.websiteFaqs > 0 
                      ? `${knowledgeResults.websiteFaqs} FAQs extracted from your website`
                      : `${knowledgeResults.industryFaqs} industry FAQs loaded`
                    }
                  </span>
                </div>
              )}

              <div className="flex flex-col gap-3">
                <Button onClick={onComplete} size="lg" className="px-8">
                  Start Using BizzyBee
                </Button>
                {totalFaqs > 0 && (
                  <Button 
                    variant="outline" 
                    onClick={async () => {
                      // Mark onboarding complete before navigating
                      const { data: { user } } = await supabase.auth.getUser();
                      if (user) {
                        await supabase
                          .from('users')
                          .update({ 
                            onboarding_completed: true,
                            onboarding_step: 'complete'
                          })
                          .eq('id', user.id);
                      }
                      window.location.href = '/settings?tab=knowledge';
                    }}
                    className="gap-2"
                  >
                    <BookOpen className="h-4 w-4" />
                    View Knowledge Base
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
