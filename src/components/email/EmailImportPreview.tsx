import { Button } from '@/components/ui/button';
import { Clock, Sparkles, Mail } from 'lucide-react';

interface EmailImportPreviewProps {
  workspaceId: string;
  importMode?: string;
  onStartImport: () => void;
  onSkip: () => void;
}

export function EmailImportPreview({ importMode, onStartImport, onSkip }: EmailImportPreviewProps) {
  return (
    <div className="space-y-6">
      {/* What happens next */}
      <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 space-y-3">
        <div className="flex items-center gap-2 text-primary font-medium">
          <Sparkles className="h-5 w-5" />
          <span>What happens next</span>
        </div>
        <ul className="text-sm text-muted-foreground space-y-2 ml-7">
          <li>• We'll import your emails and learn your writing style</li>
          <li>• BizzyBee prioritizes your SENT folder for voice learning</li>
          <li>• You can continue using the app while we work</li>
        </ul>
      </div>

      {/* Time estimate - honest range */}
      <div className="p-4 bg-muted/50 rounded-lg border space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <p className="font-medium text-foreground">Import time varies by mailbox size</p>
        </div>
        <ul className="text-sm text-muted-foreground space-y-1 ml-7">
          <li>• <span className="text-foreground">Small</span> (under 5k emails): ~15 minutes</li>
          <li>• <span className="text-foreground">Medium</span> (5k-20k): ~30-60 minutes</li>
          <li>• <span className="text-foreground">Large</span> (20k+): 1-2 hours</li>
        </ul>
      </div>

      {/* Import note */}
      <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg text-xs text-muted-foreground">
        <Mail className="h-4 w-4 shrink-0" />
        <p>Import happens in the background — you'll see real-time progress updates.</p>
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
