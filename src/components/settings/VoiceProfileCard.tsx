import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Sparkles, RefreshCw, User } from 'lucide-react';

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
}

export const VoiceProfileCard = ({ workspaceId }: VoiceProfileCardProps) => {
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

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
      setProfile(data);
    } catch (e) {
      console.error('Error fetching profile:', e);
    } finally {
      setLoading(false);
    }
  };

  const analyzeVoice = async (forceRefresh = false) => {
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('voice-learn', {
        body: { 
          workspace_id: workspaceId,
          force_refresh: forceRefresh
        }
      });

      if (error) throw error;

      if (data?.skipped) {
        toast.info(data.reason);
      } else {
        toast.success('Voice profile updated!');
        fetchProfile();
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
            <div className="flex flex-wrap gap-2">
              {profile.tone && <Badge variant="secondary">{profile.tone}</Badge>}
              {profile.formality_score && (
                <Badge variant="outline">
                  Formality: {profile.formality_score}/10
                </Badge>
              )}
              {profile.emails_analyzed && (
                <Badge variant="outline">
                  {profile.emails_analyzed} emails analyzed
                </Badge>
              )}
            </div>

            {profile.tone_descriptors && profile.tone_descriptors.length > 0 && (
              <div className="bg-muted rounded-lg p-4">
                <p className="text-sm text-muted-foreground">
                  {profile.tone_descriptors.join(', ')}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium text-muted-foreground">Greeting:</span>
                <p className="mt-1">{profile.greeting_style || 'Not detected'}</p>
              </div>
              <div>
                <span className="font-medium text-muted-foreground">Sign-off:</span>
                <p className="mt-1">{profile.signoff_style || 'Not detected'}</p>
              </div>
            </div>

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
