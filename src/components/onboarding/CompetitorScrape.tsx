import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { FileSearch, Loader2, CheckCircle } from 'lucide-react';

interface CompetitorScrapeProps {
  workspaceId: string;
  onComplete: () => void;
}

export const CompetitorScrape = ({ workspaceId, onComplete }: CompetitorScrapeProps) => {
  const [status, setStatus] = useState<'idle' | 'scraping' | 'complete'>('idle');
  const [result, setResult] = useState<{
    competitors_scraped: number;
    faqs_extracted: number;
  } | null>(null);

  const startScraping = async () => {
    setStatus('scraping');
    try {
      const { data, error } = await supabase.functions.invoke('trigger-n8n-workflow', {
        body: { workspace_id: workspaceId, workflow_type: 'faq_generation' }
      });

      if (error) throw error;

      setResult(data);
      setStatus('complete');
      toast.success(`Extracted ${data.faqs_extracted} FAQs from competitors`);

    } catch (e: any) {
      toast.error(e.message || 'Scraping failed');
      setStatus('idle');
    }
  };

  if (status === 'complete' && result) {
    return (
      <Card className="max-w-lg mx-auto">
        <CardContent className="pt-6 text-center space-y-6">
          <div className="flex items-center justify-center gap-2 text-primary">
            <CheckCircle className="h-8 w-8" />
            <h3 className="text-xl font-semibold">Competitor Analysis Complete!</h3>
          </div>
          
          <div className="space-y-2 text-left bg-muted/50 rounded-lg p-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{result.competitors_scraped}</span> competitor websites analyzed
            </p>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{result.faqs_extracted}</span> FAQs extracted and tailored
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            These FAQs have been customized for your business. Your own website content always takes priority.
          </p>

          <Button onClick={onComplete} className="w-full">
            Continue
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="flex items-center justify-center gap-2">
          <FileSearch className="h-6 w-6" />
          Analyze Competitors
        </CardTitle>
        <CardDescription>
          We'll extract FAQs from competitor websites and tailor them for your business
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {status === 'idle' && (
          <Button onClick={startScraping} className="w-full">
            <FileSearch className="h-4 w-4 mr-2" />
            Start Competitor Analysis
          </Button>
        )}

        {status === 'scraping' && (
          <div className="text-center space-y-4 py-8">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
            <p className="text-lg font-medium">Analyzing competitor websites...</p>
            <p className="text-sm text-muted-foreground">
              This may take 2-3 minutes
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
