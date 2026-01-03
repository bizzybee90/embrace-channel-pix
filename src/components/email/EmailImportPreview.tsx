import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Inbox, Send, Clock, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface MailboxStats {
  rawCounts: {
    inbox: number;
    sent: number;
    total: number;
  };
  estimatedCounts: {
    inbox: number;
    sent: number;
    total: number;
  };
  timeEstimate: {
    importClassifyMinutes: number;
    learningMinutes: number;
    totalMinutes: number;
  };
  connectedEmail: string;
  provider: string;
}

interface EmailImportPreviewProps {
  workspaceId: string;
  onStartImport: () => void;
  onSkip: () => void;
}

function formatTime(minutes: number): string {
  if (minutes < 1) return 'Less than a minute';
  if (minutes === 1) return '1 minute';
  if (minutes < 60) return `${minutes} minutes`;
  
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  
  if (remainingMins === 0) {
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  
  return `${hours}h ${remainingMins}m`;
}

export function EmailImportPreview({ workspaceId, onStartImport, onSkip }: EmailImportPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<MailboxStats | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        setLoading(true);
        setError(null);
        
        const { data, error: fnError } = await supabase.functions.invoke('get-mailbox-stats', {
          body: { workspaceId }
        });

        if (fnError) throw fnError;
        if (data.error) throw new Error(data.error);
        
        setStats(data);
      } catch (err: any) {
        console.error('[EmailImportPreview] Error:', err);
        setError(err.message || 'Failed to fetch mailbox statistics');
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [workspaceId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Analyzing your mailbox...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg border border-destructive/30 text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onSkip} className="flex-1">
            Skip for now
          </Button>
          <Button onClick={onStartImport} className="flex-1">
            Try Import Anyway
          </Button>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      {/* Email counts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col items-center p-4 bg-muted/50 rounded-lg border">
          <Inbox className="h-8 w-8 text-blue-500 mb-2" />
          <span className="text-2xl font-bold">{stats.estimatedCounts.inbox.toLocaleString()}</span>
          <span className="text-sm text-muted-foreground">Inbox emails</span>
        </div>
        <div className="flex flex-col items-center p-4 bg-muted/50 rounded-lg border">
          <Send className="h-8 w-8 text-green-500 mb-2" />
          <span className="text-2xl font-bold">{stats.estimatedCounts.sent.toLocaleString()}</span>
          <span className="text-sm text-muted-foreground">Sent emails</span>
        </div>
      </div>

      {/* Time estimate */}
      <div className="flex items-center justify-center gap-3 p-4 bg-primary/5 rounded-lg border border-primary/20">
        <Clock className="h-6 w-6 text-primary" />
        <div className="text-center">
          <p className="font-medium text-foreground">
            Estimated time: {formatTime(stats.timeEstimate.totalMinutes)}
          </p>
          <p className="text-sm text-muted-foreground">
            {stats.estimatedCounts.total.toLocaleString()} emails to process (last 6 months)
          </p>
        </div>
      </div>

      {/* Breakdown */}
      <div className="text-xs text-muted-foreground text-center space-y-1">
        <p>
          <span className="font-medium">SENT folder first</span> — for better voice learning
        </p>
        <p>
          Import: ~{stats.timeEstimate.importClassifyMinutes}min • 
          Learn: ~{stats.timeEstimate.learningMinutes}min
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button variant="outline" onClick={onSkip} className="flex-1">
          Skip for now
        </Button>
        <Button onClick={onStartImport} className="flex-1">
          Start Import
        </Button>
      </div>

      <p className="text-xs text-center text-muted-foreground italic">
        ☕ You can continue using the app while we import in the background
      </p>
    </div>
  );
}
