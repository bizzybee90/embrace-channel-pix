import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Progress } from '@/components/ui/progress';
import { 
  Mail, 
  MessageSquare, 
  Brain, 
  CheckCircle, 
  Loader2,
  Clock
} from 'lucide-react';

interface ImportProgress {
  current_phase: string;
  emails_received: number;
  emails_classified: number;
  conversations_found: number;
  conversations_with_replies: number;
  pairs_analyzed: number;
  voice_profile_complete: boolean;
  playbook_complete: boolean;
  started_at: string;
  phase1_completed_at: string | null;
  phase2_completed_at: string | null;
  phase3_completed_at: string | null;
  estimated_total_emails: number | null;
}

interface EmailImportProgressProps {
  workspaceId: string;
  onComplete?: () => void;
}

export function EmailImportProgress({ workspaceId, onComplete }: EmailImportProgressProps) {
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  useEffect(() => {
    // Initial fetch
    fetchProgress();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('email-import-progress')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'email_import_progress',
          filter: `workspace_id=eq.${workspaceId}`
        },
        (payload) => {
          const newProgress = payload.new as ImportProgress;
          setProgress(newProgress);
          if (newProgress.current_phase === 'complete' && onComplete) {
            onComplete();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, onComplete]);

  const fetchProgress = async () => {
    const { data } = await supabase
      .from('email_import_progress')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single();
    
    if (data) {
      setProgress(data as unknown as ImportProgress);
      if (data.current_phase === 'complete' && onComplete) {
        onComplete();
      }
    }
  };

  if (!progress) return null;

  // Calculate overall progress percentage
  const getOverallProgress = () => {
    switch (progress.current_phase) {
      case 'connecting': return 5;
      case 'importing': return 15;
      case 'classifying': 
        if (progress.emails_received === 0) return 20;
        return 20 + (progress.emails_classified / progress.emails_received) * 40;
      case 'analyzing': return 65;
      case 'learning': return 80;
      case 'complete': return 100;
      default: return 0;
    }
  };

  // Calculate time remaining estimate using: totalEmails / 500 + 15 min for classification/learning
  const getTimeRemaining = () => {
    if (progress.current_phase === 'complete') return null;
    
    const totalEmails = progress.estimated_total_emails || progress.emails_received;
    if (totalEmails === 0) return 'Calculating...';
    
    // 500 emails/min import + 15 min for classification/learning
    const totalEstimatedMinutes = Math.ceil(totalEmails / 500) + 15;
    
    // Calculate how far along we are
    let completedMinutes = 0;
    if (progress.emails_received > 0) {
      completedMinutes = Math.ceil(progress.emails_received / 500);
    }
    if (progress.current_phase === 'classifying') {
      completedMinutes += Math.ceil((progress.emails_classified / Math.max(progress.emails_received, 1)) * 5);
    }
    if (progress.current_phase === 'analyzing') {
      completedMinutes = totalEstimatedMinutes - 10;
    }
    if (progress.current_phase === 'learning') {
      completedMinutes = totalEstimatedMinutes - 5;
    }
    
    const minutesRemaining = Math.max(1, totalEstimatedMinutes - completedMinutes);
    
    if (minutesRemaining >= 60) {
      const hours = Math.floor(minutesRemaining / 60);
      const mins = minutesRemaining % 60;
      return `~${hours}h ${mins}m remaining`;
    }
    
    return `~${minutesRemaining} min remaining`;
  };
  
  // Get import count display
  const getImportCountDisplay = () => {
    const totalEmails = progress.estimated_total_emails || 0;
    const received = progress.emails_received || 0;
    
    if (totalEmails > 0 && received > 0) {
      return `${received.toLocaleString()} of ~${totalEmails.toLocaleString()} emails`;
    }
    if (received > 0) {
      return `${received.toLocaleString()} emails received`;
    }
    return 'Starting import...';
  };

  const phases = [
    {
      id: 'import',
      label: 'Import Emails',
      description: getImportCountDisplay(),
      status: progress.emails_received > 0 ? 'complete' : 
              progress.current_phase === 'importing' ? 'active' : 'pending',
      icon: Mail
    },
    {
      id: 'classify',
      label: 'Classify Emails',
      description: `${progress.emails_classified.toLocaleString()} / ${progress.emails_received.toLocaleString()} classified`,
      status: progress.current_phase === 'classifying' ? 'active' :
              progress.emails_classified === progress.emails_received && progress.emails_received > 0 ? 'complete' : 'pending',
      icon: MessageSquare
    },
    {
      id: 'analyze',
      label: 'Analyze Conversations',
      description: progress.conversations_with_replies > 0 
        ? `${progress.conversations_with_replies} conversations with replies`
        : 'Matching replies to emails',
      status: progress.current_phase === 'analyzing' ? 'active' :
              progress.phase2_completed_at ? 'complete' : 'pending',
      icon: Brain
    },
    {
      id: 'learn',
      label: 'Learn Your Style',
      description: progress.voice_profile_complete 
        ? 'Voice profile complete!'
        : `Analyzing ${progress.pairs_analyzed} conversation pairs`,
      status: progress.current_phase === 'learning' ? 'active' :
              progress.phase3_completed_at ? 'complete' : 'pending',
      icon: Brain
    }
  ];

  return (
    <div className="space-y-6 p-6 bg-card rounded-lg border">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            {progress.current_phase === 'complete' 
              ? 'Import Complete!' 
              : 'Importing Your Emails'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {progress.current_phase === 'complete'
              ? 'BizzyBee now understands how you communicate'
              : 'BizzyBee is learning from your email history'}
          </p>
        </div>
        {getTimeRemaining() && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            {getTimeRemaining()}
          </div>
        )}
      </div>

      {/* Overall Progress Bar */}
      <div className="space-y-2">
        <Progress value={getOverallProgress()} className="h-2" />
        <p className="text-sm text-muted-foreground text-right">
          {Math.round(getOverallProgress())}% complete
        </p>
      </div>

      {/* Phase Steps */}
      <div className="space-y-4">
        {phases.map((phase) => (
          <div 
            key={phase.id}
            className={`flex items-start gap-4 p-3 rounded-lg transition-colors ${
              phase.status === 'active' ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800' :
              phase.status === 'complete' ? 'bg-green-50 dark:bg-green-950/30' : 'bg-muted/50'
            }`}
          >
            <div className={`p-2 rounded-full ${
              phase.status === 'active' ? 'bg-amber-100 dark:bg-amber-900' :
              phase.status === 'complete' ? 'bg-green-100 dark:bg-green-900' : 'bg-muted'
            }`}>
              {phase.status === 'active' ? (
                <Loader2 className="w-5 h-5 text-amber-600 dark:text-amber-400 animate-spin" />
              ) : phase.status === 'complete' ? (
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              ) : (
                <phase.icon className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1">
              <p className={`font-medium ${
                phase.status === 'active' ? 'text-amber-900 dark:text-amber-200' :
                phase.status === 'complete' ? 'text-green-900 dark:text-green-200' : 'text-muted-foreground'
              }`}>
                {phase.label}
              </p>
              <p className={`text-sm ${
                phase.status === 'active' ? 'text-amber-700 dark:text-amber-400' :
                phase.status === 'complete' ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground/70'
              }`}>
                {phase.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Completion Summary */}
      {progress.current_phase === 'complete' && (
        <div className="mt-6 p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-800">
          <h4 className="font-medium text-green-900 dark:text-green-200 mb-2">What BizzyBee Learned</h4>
          <ul className="space-y-1 text-sm text-green-800 dark:text-green-300">
            <li>✓ Analyzed {progress.emails_classified.toLocaleString()} emails</li>
            <li>✓ Found {progress.conversations_with_replies} conversations with replies</li>
            <li>✓ Learned your communication style</li>
            <li>✓ Created response playbook for common scenarios</li>
          </ul>
        </div>
      )}
    </div>
  );
}
