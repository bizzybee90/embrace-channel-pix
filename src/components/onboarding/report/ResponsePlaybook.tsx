import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { BookOpen, MessageCircle, Reply } from 'lucide-react';

interface PlaybookEntry {
  category: string;
  frequency: number;
  required_info?: string[];
  typical_structure?: string;
  pricing_logic?: string;
  golden_example?: {
    customer: string;
    owner: string;
  };
}

interface ResponsePlaybookProps {
  workspaceId: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  quote_request: 'Quote Request',
  booking_request: 'Booking Request',
  scheduling_inquiry: 'Scheduling',
  complaint_response: 'Complaint',
  service_termination: 'Cancellation',
  additional_services: 'Additional Services',
  general_inquiry: 'General Inquiry',
};

export function ResponsePlaybook({ workspaceId }: ResponsePlaybookProps) {
  const [playbook, setPlaybook] = useState<PlaybookEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const { data, error } = await supabase
          .from('voice_profiles')
          .select('playbook')
          .eq('workspace_id', workspaceId)
          .single();

        if (error) throw error;

        if (data?.playbook && Array.isArray(data.playbook)) {
          setPlaybook(data.playbook as unknown as PlaybookEntry[]);
        }
      } catch (err) {
        console.error('Error fetching playbook:', err);
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
            <BookOpen className="h-5 w-5" />
            Response Playbook
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2].map(i => (
              <div key={i} className="h-32 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (playbook.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Response Playbook
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Playbook not yet generated. This happens after we analyze your sent emails.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          Response Playbook
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          How you typically respond to different situations
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {playbook.slice(0, 3).map((entry, idx) => (
          <div key={idx} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="font-medium">
                {CATEGORY_LABELS[entry.category] || entry.category}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {Math.round(entry.frequency * 100)}% of inquiries
              </span>
            </div>

            {entry.golden_example && (
              <div className="space-y-2 pt-2">
                {/* Customer message */}
                <div className="flex gap-2">
                  <MessageCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Customer says:</span>
                    <p className="text-sm bg-muted/50 rounded-lg px-3 py-2 italic">
                      "{entry.golden_example.customer.slice(0, 150)}
                      {entry.golden_example.customer.length > 150 ? '...' : ''}"
                    </p>
                  </div>
                </div>

                {/* Owner reply */}
                <div className="flex gap-2">
                  <Reply className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">You typically reply:</span>
                    <p className="text-sm bg-primary/5 border-l-2 border-primary rounded-r-lg px-3 py-2">
                      "{entry.golden_example.owner.slice(0, 200)}
                      {entry.golden_example.owner.length > 200 ? '...' : ''}"
                    </p>
                  </div>
                </div>
              </div>
            )}

            {entry.typical_structure && (
              <p className="text-xs text-muted-foreground pt-1">
                <span className="font-medium">Pattern:</span> {entry.typical_structure}
              </p>
            )}
          </div>
        ))}

        {playbook.length > 3 && (
          <p className="text-xs text-muted-foreground text-center pt-2">
            + {playbook.length - 3} more response patterns learned
          </p>
        )}
      </CardContent>
    </Card>
  );
}
