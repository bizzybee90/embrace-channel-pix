import { Button } from '@/components/ui/button';
import { Clock, Sparkles, Mail } from 'lucide-react';

interface EmailImportPreviewProps {
  workspaceId: string;
  importMode?: string;
  onStartImport: () => void;
  onSkip: () => void;
}

function getEstimateFromMode(mode?: string): { emails: string; time: string } {
  switch (mode) {
    case 'last_30000':
      return { emails: 'Up to 30,000', time: '~1-2 hours' };
    case 'last_10000':
      return { emails: 'Up to 10,000', time: '~30-45 minutes' };
    case 'last_1000':
      return { emails: 'Up to 1,000', time: '~10-15 minutes' };
    case 'all_history':
      return { emails: 'All available', time: 'Varies by inbox size' };
    default:
      return { emails: 'Your emails', time: '~15-30 minutes' };
  }
}

export function EmailImportPreview({ importMode, onStartImport, onSkip }: EmailImportPreviewProps) {
  const estimate = getEstimateFromMode(importMode);

  return (
    <div className="space-y-6">
      {/* What happens next */}
      <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 space-y-3">
        <div className="flex items-center gap-2 text-primary font-medium">
          <Sparkles className="h-5 w-5" />
          <span>What happens next</span>
        </div>
        <ul className="text-sm text-muted-foreground space-y-2 ml-7">
          <li>• We'll import your <span className="font-medium text-foreground">{estimate.emails}</span> emails</li>
          <li>• BizzyBee learns your writing style from sent emails</li>
          <li>• You can continue using the app while we work</li>
        </ul>
      </div>

      {/* Time estimate */}
      <div className="flex items-center justify-center gap-3 p-4 bg-muted/50 rounded-lg border">
        <Clock className="h-5 w-5 text-muted-foreground" />
        <div className="text-center">
          <p className="font-medium text-foreground">Estimated time: {estimate.time}</p>
          <p className="text-xs text-muted-foreground">We prioritize SENT folder for voice learning</p>
        </div>
      </div>

      {/* Import note */}
      <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg text-xs text-muted-foreground">
        <Mail className="h-4 w-4 shrink-0" />
        <p>Import happens in the background — you'll see progress updates as we go.</p>
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
        ☕ Grab a coffee while BizzyBee gets to know your inbox
      </p>
    </div>
  );
}
