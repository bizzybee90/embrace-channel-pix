import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Mic, Loader2, CheckCircle, Quote } from 'lucide-react';

interface VoiceLearningProps {
  workspaceId: string;
  onComplete: () => void;
}

interface VoiceResult {
  profile_summary: string;
  emails_analyzed: number;
}

export const VoiceLearning = ({ workspaceId, onComplete }: VoiceLearningProps) => {
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'complete'>('idle');
  const [result, setResult] = useState<VoiceResult | null>(null);

  const startAnalysis = async () => {
    setStatus('analyzing');
    try {
      const { data, error } = await supabase.functions.invoke('voice-learn', {
        body: { workspace_id: workspaceId }
      });

      if (error) throw error;

      setResult(data);
      setStatus('complete');
      toast.success('Voice profile created!');

    } catch (e: any) {
      toast.error(e.message || 'Analysis failed');
      setStatus('idle');
    }
  };

  if (status === 'complete' && result) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="pt-6">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-4">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold">Voice Profile Created!</h3>
          </div>
          
          <div className="space-y-4">
            <div className="bg-muted p-4 rounded-lg">
              <Quote className="h-4 w-4 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground italic">
                {result.profile_summary}
              </p>
            </div>
            
            <p className="text-sm text-center text-muted-foreground">
              Analyzed {result.emails_analyzed} sent emails
            </p>
          </div>

          <p className="text-sm text-muted-foreground text-center mt-4 mb-4">
            BizzyBee will now write emails that sound exactly like you.
          </p>

          <Button onClick={onComplete} className="w-full">
            Continue
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-primary" />
          Learn Your Voice
        </CardTitle>
        <CardDescription>
          AI will analyze your sent emails to understand exactly how you write
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'idle' && (
          <>
            <div className="bg-muted/50 p-4 rounded-lg">
              <p className="text-sm font-medium mb-2">What we'll learn:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Your greeting style ("Hi there," vs "Hello,")</li>
                <li>• How you sign off ("Cheers," vs "Best,")</li>
                <li>• Your tone (friendly, professional, casual)</li>
                <li>• Phrases you commonly use</li>
                <li>• How you handle different situations</li>
              </ul>
            </div>
            <Button onClick={startAnalysis} className="w-full">
              <Mic className="h-4 w-4 mr-2" />
              Analyze My Writing Style
            </Button>
          </>
        )}

        {status === 'analyzing' && (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Analyzing your emails...</p>
            <p className="text-xs text-muted-foreground mt-1">
              This may take 1-2 minutes
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
