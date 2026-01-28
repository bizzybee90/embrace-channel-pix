import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Sparkles, RefreshCw, User, BookOpen } from 'lucide-react';

interface VoiceProfileCardProps {
  workspaceId: string;
}

interface VoiceProfile {
  tone: string | null;
  formality_score: number | null;
  greeting_style: string | null;
  signoff_style: string | null;
  tone_descriptors: string[] | null;
  emails_analyzed: number | null;
  last_analyzed_at: string | null;
  warmth_level: number | null;
  directness_level: number | null;
  avg_response_length: number | null;
  voice_dna: {
    openers?: Array<{ phrase: string; frequency: number }>;
    closers?: Array<{ phrase: string; frequency: number }>;
    tics?: string[];
    tone_keywords?: string[];
    formatting_rules?: string[];
    avg_response_length?: number;
    emoji_usage?: string;
  } | null;
  playbook: Array<{
    category: string;
    frequency?: number;
    golden_example?: {
      customer: string;
      owner: string;
    };
  }> | null;
  examples_stored: number | null;
}

export const VoiceProfileCard = ({ workspaceId }: VoiceProfileCardProps) => {
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [showPlaybook, setShowPlaybook] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, [workspaceId]);

  const fetchProfile = async () => {
    try {
      const { data, error } = await supabase
        .from('voice_profiles')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (error) throw error;
      // Cast the data to handle Json types
      setProfile(data as unknown as VoiceProfile);
    } catch (e) {
      console.error('Error fetching profile:', e);
    } finally {
      setLoading(false);
    }
  };

  const analyzeVoice = async (forceRefresh = false) => {
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('voice-learning', {
        body: { 
          workspace_id: workspaceId,
          force_refresh: forceRefresh
        }
      });

      if (error) throw error;

      if (data?.skipped) {
        toast.info(data.reason);
      } else if (data?.reason === 'insufficient_data') {
        toast.info(`Need more emails. Found ${data.pairs_found} conversation pairs.`);
      } else if (data?.success) {
        toast.success(`Voice profile updated! Analyzed ${data.pairs_analyzed} emails, stored ${data.examples_stored} examples.`);
        fetchProfile();
      } else {
        toast.error(data?.error || 'Analysis failed');
      }
    } catch (e: any) {
      toast.error(e.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const voiceDna = profile?.voice_dna;
  const playbook = profile?.playbook;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Your Writing Voice
        </CardTitle>
        <CardDescription>
          BizzyBee learns your style from sent emails to draft replies that sound like you
        </CardDescription>
      </CardHeader>
      <CardContent>
        {profile ? (
          <div className="space-y-4">
            {/* Stats badges */}
            <div className="flex flex-wrap gap-2">
              {profile.tone && <Badge variant="secondary">{profile.tone}</Badge>}
              {profile.emails_analyzed && profile.emails_analyzed > 0 && (
                <Badge variant="outline">
                  {profile.emails_analyzed} emails analyzed
                </Badge>
              )}
              {profile.examples_stored && profile.examples_stored > 0 && (
                <Badge variant="outline" className="bg-muted text-primary border-primary/20">
                  {profile.examples_stored} examples stored
                </Badge>
              )}
            </div>

            {/* Voice DNA display */}
            {voiceDna && (
              <div className="space-y-3">
                {/* Tone keywords */}
                {voiceDna.tone_keywords && voiceDna.tone_keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {voiceDna.tone_keywords.map((keyword, i) => (
                      <span key={i} className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
                        {keyword}
                      </span>
                    ))}
                  </div>
                )}

                {/* Greetings and sign-offs */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-muted-foreground">Greeting:</span>
                    <p className="mt-1">
                      {voiceDna.openers?.[0]?.phrase || profile.greeting_style || 'Not detected'}
                    </p>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">Sign-off:</span>
                    <p className="mt-1">
                      {voiceDna.closers?.[0]?.phrase || profile.signoff_style || 'Not detected'}
                    </p>
                  </div>
                </div>

                {/* Verbal tics */}
                {voiceDna.tics && voiceDna.tics.length > 0 && (
                  <div className="bg-muted rounded-lg p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Your writing habits:</p>
                    <p className="text-sm text-muted-foreground">
                      {voiceDna.tics.slice(0, 3).join(' • ')}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Legacy tone descriptors fallback */}
            {!voiceDna && profile.tone_descriptors && profile.tone_descriptors.length > 0 && (
              <div className="bg-muted rounded-lg p-4">
                <p className="text-sm text-muted-foreground">
                  {profile.tone_descriptors.join(', ')}
                </p>
              </div>
            )}

            {/* Playbook section */}
            {playbook && playbook.length > 0 && (
              <div className="border-t pt-4">
                <button 
                  onClick={() => setShowPlaybook(!showPlaybook)}
                  className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                >
                  <BookOpen className="h-4 w-4" />
                  {showPlaybook ? 'Hide' : 'Show'} Response Playbook ({playbook.length} categories)
                </button>
                
                {showPlaybook && (
                  <div className="mt-3 space-y-3">
                    {playbook.map((category, i) => (
                      <div key={i} className="bg-muted/50 rounded-lg p-3">
                        <p className="text-sm font-medium capitalize">
                          {category.category.replace(/_/g, ' ')}
                          {category.frequency && (
                            <span className="text-muted-foreground font-normal ml-2">
                              ({Math.round(category.frequency * 100)}% of emails)
                            </span>
                          )}
                        </p>
                        {category.golden_example && (
                          <div className="mt-2 text-xs space-y-1">
                            <p className="text-muted-foreground">
                              <span className="font-medium">Customer:</span> "{category.golden_example.customer}"
                            </p>
                            <p className="text-primary">
                              <span className="font-medium">You replied:</span> "{category.golden_example.owner}"
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Button
              variant="outline"
              onClick={() => analyzeVoice(true)}
              disabled={analyzing}
              className="w-full"
            >
              {analyzing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Re-analyze Writing Style
            </Button>
          </div>
        ) : (
          <div className="text-center py-6 space-y-4">
            <p className="text-muted-foreground">
              No voice profile yet. We'll analyze your sent emails to learn your writing style.
            </p>
            <Button onClick={() => analyzeVoice()} disabled={analyzing}>
              {analyzing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Analyze My Writing Style
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
