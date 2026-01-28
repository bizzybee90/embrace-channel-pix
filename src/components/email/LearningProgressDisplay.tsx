import { CheckCircle2, Loader2, Brain, Search, Database } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useLearningProgress, formatTimeRemaining } from '@/hooks/useLearningProgress';
import { formatDistanceToNowStrict } from 'date-fns';

interface LearningProgressDisplayProps {
  workspaceId: string;
  emailsImported: number;
}

const phaseIcons = {
  pairing: Search,
  voice_dna: Brain,
  embeddings: Database,
  complete: CheckCircle2
};

export function LearningProgressDisplay({ workspaceId, emailsImported }: LearningProgressDisplayProps) {
  const progress = useLearningProgress(workspaceId);
  
  if (!progress) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Starting analysis...</span>
      </div>
    );
  }

  const { currentPhase, phaseIndex, totalPhases, estimatedSecondsRemaining, isComplete, lastUpdatedAt } = progress;
  const overallProgress = isComplete ? 100 : Math.round((phaseIndex / totalPhases) * 100);
  const PhaseIcon = phaseIcons[currentPhase.id];

  const lastUpdatedText = lastUpdatedAt
    ? `${formatDistanceToNowStrict(new Date(lastUpdatedAt), { addSuffix: true })}`
    : null;
  const isStale = lastUpdatedAt
    ? Date.now() - new Date(lastUpdatedAt).getTime() > 5 * 60 * 1000
    : false;

  const displayLabel = !isComplete && isStale ? 'Waiting for analysis to resume' : currentPhase.label;
  const displayDescription = !isComplete && isStale
    ? 'No backend progress has been reported recently. We’ll keep checking automatically.'
    : currentPhase.description;

  return (
    <div className="space-y-4">
      {/* Success badge for emails imported */}
      <div className="flex items-center gap-2 text-xs text-success">
        <CheckCircle2 className="h-4 w-4" />
        <span>{emailsImported.toLocaleString()} emails imported successfully</span>
      </div>

      {/* Current phase indicator */}
      <div className="bg-muted/50 rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${isComplete ? 'bg-success/20' : 'bg-primary/20'}`}>
            {isComplete ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <PhaseIcon className="h-5 w-5 text-primary animate-pulse" />
            )}
          </div>
          <div className="flex-1">
            <p className="font-medium text-sm">{displayLabel}</p>
            <p className="text-xs text-muted-foreground">{displayDescription}</p>
          </div>
          {!isComplete && !isStale && estimatedSecondsRemaining && (
            <span className="text-xs text-muted-foreground">
              {formatTimeRemaining(estimatedSecondsRemaining)}
            </span>
          )}
        </div>

        {lastUpdatedText && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Last updated {lastUpdatedText}</span>
            {isStale && <span className="text-destructive">No progress recently</span>}
          </div>
        )}

        {/* Phase progress */}
        {!isComplete && (
          <div className="space-y-1">
            <Progress value={overallProgress} className="h-1.5" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Phase {phaseIndex + 1} of {totalPhases}</span>
              <span>{overallProgress}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Phase steps */}
      <div className="grid grid-cols-3 gap-2">
        {['pairing', 'voice_dna', 'embeddings'].map((phase, idx) => {
          const isActive = phaseIndex === idx;
          const isDone = phaseIndex > idx || isComplete;
          const Icon = phaseIcons[phase as keyof typeof phaseIcons];
          
          return (
            <div 
              key={phase}
              className={`flex flex-col items-center gap-1 p-2 rounded-lg text-center ${
                isDone ? 'bg-success/10 text-success' :
                isActive ? 'bg-primary/10 text-primary' :
                'bg-muted/30 text-muted-foreground'
              }`}
            >
              {isDone ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : isActive ? (
                <Icon className="h-4 w-4 animate-pulse" />
              ) : (
                <Icon className="h-4 w-4 opacity-50" />
              )}
              <span className="text-[10px] font-medium leading-tight">
                {idx === 0 ? 'Pair' : idx === 1 ? 'Voice' : 'Memory'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Single background note */}
      <p className="text-xs text-center text-muted-foreground">
        {isComplete 
          ? 'Your voice profile is ready!'
          : 'You can continue onboarding while this runs.'}
      </p>
    </div>
  );
}
