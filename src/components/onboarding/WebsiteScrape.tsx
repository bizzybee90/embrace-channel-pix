import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Globe, Loader2, CheckCircle, FileText } from 'lucide-react';

interface WebsiteScrapeProps {
  workspaceId: string;
  onComplete: () => void;
}

interface ScrapeResult {
  faqs_extracted: number;
  business_info?: {
    name?: string;
    services?: string[];
    service_area?: string;
    phone?: string;
    email?: string;
  };
}

export const WebsiteScrape = ({ workspaceId, onComplete }: WebsiteScrapeProps) => {
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScrapeResult | null>(null);

  const scrapeWebsite = async () => {
    if (!websiteUrl.trim()) {
      toast.error('Please enter your website URL');
      return;
    }

    // Ensure URL has protocol
    let url = websiteUrl.trim();
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('website-scrape', {
        body: {
          workspace_id: workspaceId,
          website_url: url
        }
      });

      if (error) throw error;

      setResult(data);
      toast.success(`Extracted ${data.faqs_extracted} FAQs from your website!`);

    } catch (e: any) {
      toast.error(e.message || 'Failed to scrape website');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckCircle className="h-12 w-12 text-green-600" />
            <Globe className="h-6 w-6 text-muted-foreground" />
            
            <div className="space-y-2">
              <div className="flex items-center gap-2 justify-center">
                <FileText className="h-4 w-4" />
                <span className="font-medium">{result.faqs_extracted} FAQs extracted</span>
              </div>
              {result.business_info?.name && (
                <p className="text-sm text-muted-foreground">
                  Business: {result.business_info.name}
                </p>
              )}
              {result.business_info?.services && result.business_info.services.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Services: {result.business_info.services.slice(0, 3).join(', ')}
                  {result.business_info.services.length > 3 && '...'}
                </p>
              )}
            </div>

            <p className="text-sm text-muted-foreground max-w-md">
              These FAQs are your "gold standard" - they'll always take priority over competitor content.
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
          <Globe className="h-5 w-5 text-primary" />
          <CardTitle>Your Website</CardTitle>
        </div>
        <CardDescription>
          We'll extract FAQs and business info from your website to create your knowledge base
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="websiteUrl">Website URL</Label>
          <Input
            id="websiteUrl"
            placeholder="www.yourcompany.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
        </div>

        <Button onClick={scrapeWebsite} disabled={loading} className="w-full">
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Analyzing website...
            </>
          ) : (
            <>
              <Globe className="mr-2 h-4 w-4" />
              Analyze My Website
            </>
          )}
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          This usually takes 30-60 seconds
        </p>
      </CardContent>
    </Card>
  );
};
