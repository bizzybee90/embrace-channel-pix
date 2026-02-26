import { HelpCircle, Check, AlertCircle, Bot, Lightbulb } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

export function ReviewExplainer() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1">
          <HelpCircle className="h-3.5 w-3.5" />
          What is this?
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold flex items-center gap-2 mb-2">
              <Bot className="h-4 w-4 text-amber-500" />
              Teaching BizzyBee
            </h4>
            <p className="text-sm text-muted-foreground">
              BizzyBee flagged these emails because it's learning your preferences. 
              Your feedback helps it get smarter over time.
            </p>
          </div>

          <div className="space-y-3 pt-2 border-t">
            <div className="flex gap-2">
              <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">"Looks right"</p>
                <p className="text-xs text-muted-foreground">
                  Confirms BizzyBee's classification was correct. This teaches it to 
                  handle similar emails the same way next time.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">"Needs attention"</p>
                <p className="text-xs text-muted-foreground">
                  BizzyBee isn't confident enough to auto-handle this. You'll still 
                  need to reply from your inbox—this just helps BizzyBee learn.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
            <div className="flex gap-2">
              <Lightbulb className="h-4 w-4 text-amber-600 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                <strong>Tip:</strong> After reviewing ~5 similar emails, BizzyBee 
                learns the pattern and won't ask again!
              </p>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
