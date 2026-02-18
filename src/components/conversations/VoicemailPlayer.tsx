import { useState, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Play, Pause, Mic, Loader2, FileText, Copy, Check, Phone, AlertTriangle } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface VoicemailPlayerProps {
  workspaceId: string;
  messageId?: string;
  audioUrl: string;
  customerName?: string;
  onSuggestedResponse?: (response: string) => void;
}

interface VoicemailAnalysis {
  summary?: string;
  sentiment?: string;
  urgency?: string;
  purpose?: string;
  extracted_info?: {
    names_mentioned?: string[];
    phone_numbers?: string[];
    dates_times?: string[];
    amounts?: string[];
    key_details?: string[];
  };
  action_required?: string;
}

interface VoicemailResult {
  transcript: string;
  duration_seconds?: number;
  analysis?: VoicemailAnalysis;
  suggested_response?: string;
}

export const VoicemailPlayer = ({
  workspaceId,
  messageId,
  audioUrl,
  customerName,
  onSuggestedResponse
}: VoicemailPlayerProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [result, setResult] = useState<VoicemailResult | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const togglePlay = () => {
    if (audioRef.current) {
      if (playing) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setPlaying(!playing);
    }
  };

  const transcribe = async () => {
    setTranscribing(true);
    try {
      // audio-process edge function removed
      toast.info('Audio processing migrated to n8n');
      return;
    } finally {
      setTranscribing(false);
    }
  };

  const useSuggestion = () => {
    if (result?.suggested_response && onSuggestedResponse) {
      onSuggestedResponse(result.suggested_response);
      toast.success('Response added to draft');
    }
  };

  const copyToClipboard = async () => {
    if (result?.suggested_response) {
      await navigator.clipboard.writeText(result.suggested_response);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getSentimentColor = (sentiment?: string) => {
    switch (sentiment) {
      case 'positive': return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'negative': return 'bg-red-500/10 text-red-600 border-red-500/20';
      case 'urgent': return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getUrgencyVariant = (urgency?: string) => {
    switch (urgency) {
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      default: return 'outline';
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        {/* Audio Player */}
        <div className="flex items-center gap-3 mb-3">
          <Button 
            variant="outline" 
            size="icon"
            className="h-10 w-10 rounded-full shrink-0"
            onClick={togglePlay}
          >
            {playing ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 ml-0.5" />
            )}
          </Button>
          
          <div className="flex-1 min-w-0">
            <audio
              ref={audioRef}
              src={audioUrl}
              onEnded={() => setPlaying(false)}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              className="w-full"
              controls
            />
            <div className="flex items-center gap-2 mt-1">
              <Mic className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Voicemail</span>
              {result?.duration_seconds && (
                <span className="text-xs text-muted-foreground">
                  • {formatDuration(result.duration_seconds)}
                </span>
              )}
            </div>
          </div>

          {!result && (
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={transcribe}
              disabled={transcribing}
            >
              {transcribing ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <FileText className="h-3 w-3 mr-1" />
              )}
              Transcribe
            </Button>
          )}
        </div>

        {/* Transcript & Analysis */}
        {result && (
          <div className="space-y-3 pt-3 border-t">
            {/* Summary & Badges */}
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {result.analysis?.summary || 'Voicemail transcribed'}
              </p>
              <div className="flex flex-wrap gap-2">
                {result.analysis?.sentiment && (
                  <Badge 
                    variant="outline" 
                    className={getSentimentColor(result.analysis.sentiment)}
                  >
                    {result.analysis.sentiment}
                  </Badge>
                )}
                {result.analysis?.urgency === 'high' && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Urgent
                  </Badge>
                )}
                {result.analysis?.purpose && (
                  <Badge variant="secondary">
                    {result.analysis.purpose.replace('_', ' ')}
                  </Badge>
                )}
              </div>
            </div>

            {/* Full Transcript */}
            <Collapsible open={transcriptOpen} onOpenChange={setTranscriptOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
                  <FileText className="h-3 w-3 mr-2" />
                  {transcriptOpen ? 'Hide' : 'View'} full transcript
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 p-3 bg-muted/50 rounded-md text-sm">
                  {result.transcript}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Key Info */}
            {result.analysis?.extracted_info?.key_details && 
             result.analysis.extracted_info.key_details.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Key info: </span>
                {result.analysis.extracted_info.key_details.join(', ')}
              </div>
            )}

            {/* Phone Numbers */}
            {result.analysis?.extracted_info?.phone_numbers && 
             result.analysis.extracted_info.phone_numbers.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <Phone className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">
                  Callback: {result.analysis.extracted_info.phone_numbers.join(', ')}
                </span>
              </div>
            )}

            {/* Action Required */}
            {result.analysis?.action_required && (
              <div className="p-2 bg-primary/5 rounded-md border border-primary/10">
                <p className="text-xs font-medium text-primary">Action needed:</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {result.analysis.action_required}
                </p>
              </div>
            )}

            {/* Use Suggestion */}
            {result.suggested_response && (
              <div className="flex gap-2 pt-2">
                {onSuggestedResponse && (
                  <Button 
                    variant="default" 
                    size="sm" 
                    onClick={useSuggestion}
                    className="flex-1"
                  >
                    Use Suggested Response
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={copyToClipboard}
                >
                  {copied ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
