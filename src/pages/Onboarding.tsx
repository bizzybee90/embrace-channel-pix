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
import bizzybeelogo from '@/assets/bizzybee-logo.png';

const navigate = useNavigate();
const { user } = useAuth();
// ...
return (
  <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50/50 p-4">
    <div className="w-full max-w-2xl space-y-8">
      {/* Branding */}
      <div className="flex flex-col items-center justify-center space-y-4">
        <img
          src={bizzybeelogo}
          alt="BizzyBee"
          className="h-20 w-auto object-contain drop-shadow-sm hover:scale-105 transition-transform duration-300"
        />
      </div>

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
