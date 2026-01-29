import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { Sparkles, Quote, MessageSquare, Smile } from 'lucide-react';

interface VoiceDNA {
  openers: { phrase: string; frequency: number }[];
  closers: { phrase: string; frequency: number }[];
  tics: string[];
  tone_keywords: string[];
  formatting_rules: string[];
  avg_response_length: number;
  emoji_usage: string;
}

interface VoiceDNASummaryProps {
  workspaceId: string;
}

export function VoiceDNASummary({ workspaceId }: VoiceDNASummaryProps) {
  const [voiceDNA, setVoiceDNA] = useState<VoiceDNA | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailsAnalyzed, setEmailsAnalyzed] = useState(0);

  useEffect(() => {
    async function fetchData() {
      try {
        const { data, error } = await supabase
          .from('voice_profiles')
          .select('voice_dna, emails_analyzed')
          .eq('workspace_id', workspaceId)
          .single();

        if (error) throw error;

        if (data?.voice_dna) {
          setVoiceDNA(data.voice_dna as unknown as VoiceDNA);
          setEmailsAnalyzed(data.emails_analyzed || 0);
        }
      } catch (err) {
        console.error('Error fetching voice DNA:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [workspaceId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Your Voice DNA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!voiceDNA) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Your Voice DNA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Voice profile not yet generated. This happens after we analyze your sent emails.
          </p>
        </CardContent>
      </Card>
    );
  }

  const topOpeners = voiceDNA.openers?.slice(0, 3) || [];
  const topClosers = voiceDNA.closers?.slice(0, 3) || [];
  const toneWords = voiceDNA.tone_keywords?.slice(0, 4) || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Your Voice DNA
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Learned from {emailsAnalyzed} conversation pairs
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Tone */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Smile className="h-4 w-4 text-muted-foreground" />
            Tone
          </div>
          <div className="flex flex-wrap gap-2">
            {toneWords.map((tone, idx) => (
              <Badge key={idx} variant="secondary" className="capitalize">
                {tone}
              </Badge>
            ))}
          </div>
        </div>

        {/* Greetings */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Quote className="h-4 w-4 text-muted-foreground" />
            How you start emails
          </div>
          <div className="space-y-1.5">
            {topOpeners.map((opener, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground w-24 truncate">
                  "{opener.phrase}"
                </span>
                <Progress value={opener.frequency * 100} className="h-2 flex-1" />
                <span className="text-xs text-muted-foreground w-10">
                  {Math.round(opener.frequency * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Sign-offs */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Quote className="h-4 w-4 text-muted-foreground rotate-180" />
            How you end emails
          </div>
          <div className="space-y-1.5">
            {topClosers.map((closer, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground w-24 truncate">
                  "{closer.phrase}"
                </span>
                <Progress value={closer.frequency * 100} className="h-2 flex-1" />
                <span className="text-xs text-muted-foreground w-10">
                  {Math.round(closer.frequency * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Style quirks */}
        {voiceDNA.tics && voiceDNA.tics.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              Your unique style
            </div>
            <ul className="text-sm text-muted-foreground space-y-1 ml-6 list-disc">
              {voiceDNA.tics.slice(0, 4).map((tic, idx) => (
                <li key={idx} className="capitalize">{tic}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center justify-between pt-2 border-t text-sm">
          <span className="text-muted-foreground">Average response length</span>
          <span className="font-medium">{voiceDNA.avg_response_length || '~50'} words</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Emoji usage</span>
          <span className="font-medium capitalize">{voiceDNA.emoji_usage || 'rarely'}</span>
        </div>
      </CardContent>
    </Card>
  );
}
