import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Brain, Loader2, CheckCircle } from 'lucide-react';

interface EmailClassifyProps {
  workspaceId: string;
  onComplete: () => void;
}

export const EmailClassify = ({ workspaceId, onComplete }: EmailClassifyProps) => {
  const [status, setStatus] = useState<'idle' | 'classifying' | 'complete'>('idle');
  const [progress, setProgress] = useState({ classified: 0, total: 0 });

  useEffect(() => {
    // Get initial count of unclassified emails
    const getCount = async () => {
      const { count } = await supabase
        .from('raw_emails')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId);
      
      setProgress(prev => ({ ...prev, total: count || 0 }));
    };
    getCount();
  }, [workspaceId]);

  const startClassification = async () => {
    setStatus('classifying');

    try {
      let hasMore = true;
      let totalClassified = 0;

      while (hasMore) {
        const { data, error } = await supabase.functions.invoke('email-classify', {
          body: { workspace_id: workspaceId }
        });

        if (error) throw error;

        totalClassified += data.classified;
        setProgress(prev => ({ ...prev, classified: totalClassified }));

        hasMore = data.has_more;

        // Small delay between batches to avoid rate limits
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      setStatus('complete');
      toast.success(`Classified ${totalClassified} emails`);

    } catch (e: any) {
      toast.error(e.message || 'Classification failed');
      setStatus('idle');
    }
  };

  if (status === 'complete') {
    return (
      <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckCircle className="h-12 w-12 text-green-600" />
            <p className="text-lg font-medium text-green-800 dark:text-green-200">
              Classification Complete!
            </p>
            <p className="text-sm text-green-600 dark:text-green-400">
              Analyzed {progress.classified} emails
            </p>
            <Button onClick={onComplete} className="mt-2">
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <CardTitle>Classify Your Emails</CardTitle>
        </div>
        <CardDescription>
          AI will analyze your emails to understand the types of inquiries you receive
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'idle' && (
          <>
            <p className="text-sm text-muted-foreground">
              Ready to classify {progress.total} emails
            </p>
            <Button onClick={startClassification} className="w-full">
              <Brain className="mr-2 h-4 w-4" />
              Start Classification
            </Button>
          </>
        )}

        {status === 'classifying' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Classifying emails...
            </div>
            <Progress 
              value={progress.total > 0 ? (progress.classified / progress.total) * 100 : 0} 
              className="h-2" 
            />
            <p className="text-sm text-muted-foreground text-center">
              {progress.classified} / {progress.total} emails
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
