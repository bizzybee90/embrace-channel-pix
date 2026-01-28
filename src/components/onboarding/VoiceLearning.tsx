import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Mic, Loader2, CheckCircle, Quote, AlertCircle, MessageSquare } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface VoiceLearningProps {
  workspaceId: string;
  onComplete: () => void;
}

interface VoiceResult {
  profile_summary?: string;
  pairs_analyzed: number;
  examples_stored: number;
  voice_dna?: {
    openers?: Array<{ phrase: string; frequency: number }>;
    closers?: Array<{ phrase: string; frequency: number }>;
    tone_keywords?: string[];
  };
}

interface ColdStartData {
  greeting: string;
  signoff: string;
  toneWords: string;
  exampleEmail: string;
}

export const VoiceLearning = ({ workspaceId, onComplete }: VoiceLearningProps) => {
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'complete' | 'cold_start'>('idle');
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [coldStartData, setColdStartData] = useState<ColdStartData>({
    greeting: 'Hi',
    signoff: 'Thanks',
    toneWords: '',
    exampleEmail: ''
  });

  const startAnalysis = async () => {
    setStatus('analyzing');
    try {
      const { data, error } = await supabase.functions.invoke('voice-learning', {
        body: { workspace_id: workspaceId }
      });

      if (error) throw error;

      // Check if we need cold start (insufficient data)
      if (!data.success && data.reason === 'insufficient_data') {
        setStatus('cold_start');
        toast.info(`Found ${data.pairs_found} email pairs. Need more data or manual setup.`);
        return;
      }

      if (!data.success) {
        throw new Error(data.error || 'Analysis failed');
      }

      setResult({
        profile_summary: data.profile_summary,
        pairs_analyzed: data.pairs_analyzed,
        examples_stored: data.examples_stored,
        voice_dna: data.voice_dna
      });
      setStatus('complete');
      toast.success('Voice profile created!');

    } catch (e: any) {
      toast.error(e.message || 'Analysis failed');
      setStatus('idle');
    }
  };

  const saveColdStartProfile = async () => {
    if (!coldStartData.toneWords.trim()) {
      toast.error('Please describe your tone');
      return;
    }

    setStatus('analyzing');
    try {
      // Save minimal voice profile for cold start
      const { error } = await supabase.from('voice_profiles').upsert({
        workspace_id: workspaceId,
        voice_dna: {
          openers: [{ phrase: coldStartData.greeting, frequency: 1.0 }],
          closers: [{ phrase: coldStartData.signoff, frequency: 1.0 }],
          tone_keywords: coldStartData.toneWords.split(',').map(t => t.trim()).filter(Boolean),
          tics: [],
          formatting_rules: [],
          avg_response_length: 80,
          emoji_usage: 'rarely'
        },
        playbook: coldStartData.exampleEmail ? [{
          category: 'general',
          golden_example: {
            customer: 'General inquiry',
            owner: coldStartData.exampleEmail
          }
        }] : [],
        greeting_style: coldStartData.greeting,
        signoff_style: coldStartData.signoff,
        tone: coldStartData.toneWords.split(',')[0]?.trim() || 'friendly',
        tone_descriptors: coldStartData.toneWords.split(',').map(t => t.trim()).filter(Boolean),
        emails_analyzed: 0,
        examples_stored: 0,
        updated_at: new Date().toISOString()
      }, { onConflict: 'workspace_id' });

      if (error) throw error;

      setResult({
        profile_summary: `${coldStartData.toneWords} tone with "${coldStartData.greeting}" greeting`,
        pairs_analyzed: 0,
        examples_stored: 0,
        voice_dna: {
          openers: [{ phrase: coldStartData.greeting, frequency: 1.0 }],
          closers: [{ phrase: coldStartData.signoff, frequency: 1.0 }],
          tone_keywords: coldStartData.toneWords.split(',').map(t => t.trim())
        }
      });
      setStatus('complete');
      toast.success('Voice profile saved! BizzyBee will learn more from your emails over time.');

    } catch (e: any) {
      toast.error(e.message || 'Failed to save profile');
      setStatus('cold_start');
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
            {result.profile_summary && (
              <div className="bg-muted p-4 rounded-lg">
                <Quote className="h-4 w-4 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground italic">
                  {result.profile_summary}
                </p>
              </div>
            )}

            {result.voice_dna?.openers && result.voice_dna.openers.length > 0 && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-muted-foreground">Greeting:</span>
                  <p className="mt-1">{result.voice_dna.openers[0]?.phrase || 'Hi'}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Sign-off:</span>
                  <p className="mt-1">{result.voice_dna?.closers?.[0]?.phrase || 'Thanks'}</p>
                </div>
              </div>
            )}

            {result.voice_dna?.tone_keywords && result.voice_dna.tone_keywords.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {result.voice_dna.tone_keywords.map((keyword, i) => (
                  <span key={i} className="px-2 py-1 bg-muted text-primary text-xs rounded-full">
                    {keyword}
                  </span>
                ))}
              </div>
            )}
            
            <p className="text-sm text-center text-muted-foreground">
              {result.pairs_analyzed > 0 
                ? `Analyzed ${result.pairs_analyzed} emails, stored ${result.examples_stored} examples`
                : "BizzyBee will learn more from your emails over time"}
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

  if (status === 'cold_start') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Set Up Your Voice
          </CardTitle>
          <CardDescription>
            We don't have enough emails yet. Tell us how you communicate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted border border-border rounded-lg p-3 flex gap-2">
            <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              Need at least 5 sent emails to learn from. Set up manually for now - BizzyBee will learn more once you start replying.
            </p>
          </div>

          <div className="space-y-2">
            <Label>How do you greet customers?</Label>
            <Select 
              value={coldStartData.greeting} 
              onValueChange={(v) => setColdStartData(prev => ({ ...prev, greeting: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Hi">Hi</SelectItem>
                <SelectItem value="Hiya">Hiya</SelectItem>
                <SelectItem value="Hello">Hello</SelectItem>
                <SelectItem value="Hey">Hey</SelectItem>
                <SelectItem value="Good morning">Good morning</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>How do you sign off?</Label>
            <Select 
              value={coldStartData.signoff} 
              onValueChange={(v) => setColdStartData(prev => ({ ...prev, signoff: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Thanks">Thanks</SelectItem>
                <SelectItem value="Cheers">Cheers</SelectItem>
                <SelectItem value="Best wishes">Best wishes</SelectItem>
                <SelectItem value="Kind regards">Kind regards</SelectItem>
                <SelectItem value="Many thanks">Many thanks</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Describe your tone (comma-separated)</Label>
            <Input 
              placeholder="e.g. friendly, direct, helpful"
              value={coldStartData.toneWords}
              onChange={(e) => setColdStartData(prev => ({ ...prev, toneWords: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Paste an example email you've sent (optional)</Label>
            <Textarea 
              placeholder="Hi! Thanks for getting in touch..."
              value={coldStartData.exampleEmail}
              onChange={(e) => setColdStartData(prev => ({ ...prev, exampleEmail: e.target.value }))}
              rows={4}
            />
          </div>

          <Button onClick={saveColdStartProfile} className="w-full">
            Save Voice Profile
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
                <li>• Real examples to mimic exactly</li>
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
