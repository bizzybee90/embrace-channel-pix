import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { ShieldCheck, AlertTriangle, CheckCircle, HelpCircle } from 'lucide-react';

interface CategoryConfidence {
  category: string;
  count: number;
  confidence: 'high' | 'medium' | 'low';
}

interface ConfidenceAssessmentProps {
  workspaceId: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  quote_request: 'Quote Requests',
  booking_request: 'Booking Requests',
  general: 'General Inquiries',
  complaint: 'Complaints',
  cancellation: 'Cancellations',
  positive_feedback: 'Positive Feedback',
};

export function ConfidenceAssessment({ workspaceId }: ConfidenceAssessmentProps) {
  const [categories, setCategories] = useState<CategoryConfidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalExamples, setTotalExamples] = useState(0);

  useEffect(() => {
    async function fetchData() {
      try {
        // Get example counts by category
        const { data, error } = await supabase
          .from('example_responses')
          .select('category')
          .eq('workspace_id', workspaceId);

        if (error) throw error;

        // Aggregate counts
        const counts: Record<string, number> = {};
        (data || []).forEach(row => {
          const cat = row.category || 'general';
          counts[cat] = (counts[cat] || 0) + 1;
        });

        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        setTotalExamples(total);

        // Convert to array with confidence levels
        const categoryArray: CategoryConfidence[] = Object.entries(counts)
          .map(([category, count]): CategoryConfidence => ({
            category,
            count,
            confidence: count >= 10 ? 'high' : count >= 5 ? 'medium' : 'low',
          }))
          .sort((a, b) => b.count - a.count);

        setCategories(categoryArray);
      } catch (err) {
        console.error('Error fetching confidence data:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [workspaceId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            AI Confidence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="h-10 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const highConfidence = categories.filter(c => c.confidence === 'high');
  const mediumConfidence = categories.filter(c => c.confidence === 'medium');
  const lowConfidence = categories.filter(c => c.confidence === 'low');

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          AI Confidence
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Based on {totalExamples} example conversations
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* High confidence */}
        {highConfidence.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium text-green-600 dark:text-green-400">
                Strong confidence
              </span>
            </div>
            <div className="flex flex-wrap gap-2 ml-6">
              {highConfidence.map(cat => (
                <Badge key={cat.category} variant="secondary" className="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  {CATEGORY_LABELS[cat.category] || cat.category} ({cat.count} examples)
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Medium confidence */}
        {mediumConfidence.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-yellow-500" />
              <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                Good confidence
              </span>
            </div>
            <div className="flex flex-wrap gap-2 ml-6">
              {mediumConfidence.map(cat => (
                <Badge key={cat.category} variant="secondary" className="bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                  {CATEGORY_LABELS[cat.category] || cat.category} ({cat.count} examples)
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Low confidence */}
        {lowConfidence.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-medium text-orange-600 dark:text-orange-400">
                Will ask for review
              </span>
            </div>
            <div className="flex flex-wrap gap-2 ml-6">
              {lowConfidence.map(cat => (
                <Badge key={cat.category} variant="secondary" className="bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                  {CATEGORY_LABELS[cat.category] || cat.category} ({cat.count} examples)
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground ml-6">
              The AI will create drafts but ask you to review before sending
            </p>
          </div>
        )}

        {categories.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No example responses stored yet. Connect your email to start learning.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
