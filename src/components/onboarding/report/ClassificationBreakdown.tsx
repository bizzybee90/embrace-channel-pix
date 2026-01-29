import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { ChevronDown, ChevronUp, Mail, CheckCircle2 } from 'lucide-react';

interface CategoryData {
  category: string;
  count: number;
  percentage: number;
  samples: { subject: string; sender: string }[];
}

interface ClassificationBreakdownProps {
  workspaceId: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  quote_request: 'Quote Requests',
  booking_request: 'Booking Requests',
  general_inquiry: 'General Inquiries',
  complaint: 'Complaints',
  notification: 'Notifications',
  newsletter: 'Newsletters',
  spam: 'Spam',
  payment_billing: 'Payment & Billing',
  job_application: 'Job Applications',
};

const CATEGORY_COLORS: Record<string, string> = {
  quote_request: 'bg-emerald-500',
  booking_request: 'bg-blue-500',
  general_inquiry: 'bg-violet-500',
  complaint: 'bg-amber-500',
  notification: 'bg-slate-400',
  newsletter: 'bg-pink-400',
  spam: 'bg-red-400',
  payment_billing: 'bg-teal-500',
  job_application: 'bg-indigo-500',
};

export function ClassificationBreakdown({ workspaceId }: ClassificationBreakdownProps) {
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [totalEmails, setTotalEmails] = useState(0);

  useEffect(() => {
    async function fetchData() {
      try {
        // Get category counts
        const { data: countData, error } = await supabase
          .from('email_import_queue')
          .select('category')
          .eq('workspace_id', workspaceId)
          .not('category', 'is', null);

        if (error) throw error;

        // Aggregate counts
        const counts: Record<string, number> = {};
        (countData || []).forEach(row => {
          const cat = row.category || 'unknown';
          counts[cat] = (counts[cat] || 0) + 1;
        });

        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        setTotalEmails(total);

        // Convert to array and sort
        const categoryArray: CategoryData[] = Object.entries(counts)
          .map(([category, count]) => ({
            category,
            count,
            percentage: total > 0 ? (count / total) * 100 : 0,
            samples: [],
          }))
          .sort((a, b) => b.count - a.count);

        setCategories(categoryArray);
      } catch (err) {
        console.error('Error fetching classification data:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [workspaceId]);

  const loadSamples = async (category: string) => {
    if (expandedCategory === category) {
      setExpandedCategory(null);
      return;
    }

    const { data } = await supabase
      .from('email_import_queue')
      .select('subject, from_email')
      .eq('workspace_id', workspaceId)
      .eq('category', category)
      .limit(3);

    setCategories(prev =>
      prev.map(c =>
        c.category === category
          ? { ...c, samples: (data || []).map(d => ({ subject: d.subject || '(No subject)', sender: d.from_email || 'Unknown' })) }
          : c
      )
    );
    setExpandedCategory(category);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Classification
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-8 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          Email Classification
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {totalEmails.toLocaleString()} emails analyzed and sorted into categories
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {categories.slice(0, 7).map(cat => (
          <Collapsible key={cat.category} open={expandedCategory === cat.category}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between h-auto py-2 px-3 hover:bg-muted/50"
                onClick={() => loadSamples(cat.category)}
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className={`w-3 h-3 rounded-full ${CATEGORY_COLORS[cat.category] || 'bg-gray-400'}`} />
                  <span className="font-medium text-sm">
                    {CATEGORY_LABELS[cat.category] || cat.category}
                  </span>
                  <Badge variant="secondary" className="ml-auto mr-2 text-xs">
                    {cat.count.toLocaleString()} ({cat.percentage.toFixed(1)}%)
                  </Badge>
                </div>
                {expandedCategory === cat.category ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-6 pl-3 border-l-2 border-muted space-y-2 py-2">
                {cat.samples.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Loading samples...</p>
                ) : (
                  cat.samples.map((sample, idx) => (
                    <div key={idx} className="text-xs space-y-0.5">
                      <p className="font-medium text-foreground truncate">{sample.subject}</p>
                      <p className="text-muted-foreground">From: {sample.sender}</p>
                    </div>
                  ))
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}

        <div className="pt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span>All emails categorized automatically</span>
        </div>
      </CardContent>
    </Card>
  );
}
