import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertCircle, CheckCircle, Loader2, Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface MergeResult {
  identifier: string;
  type: 'phone' | 'email';
  keptCustomerId: string;
  mergedCustomerIds: string[];
  conversationsMoved: number;
}

interface MergeResponse {
  success: boolean;
  totalDuplicatesMerged: number;
  totalConversationsMoved: number;
  details: MergeResult[];
}

export function CustomerMergePanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<MergeResponse | null>(null);

  const handleMerge = async () => {
    try {
      setIsLoading(true);
      setResults(null);

      const { data, error } = await supabase.functions.invoke('merge-duplicate-customers', {
        method: 'POST',
      });

      if (error) throw error;

      setResults(data);
      
      if (data.totalDuplicatesMerged > 0) {
        toast.success(
          `Successfully merged ${data.totalDuplicatesMerged} duplicate customers and moved ${data.totalConversationsMoved} conversations`
        );
      } else {
        toast.info('No duplicate customers found');
      }
    } catch (error) {
      console.error('Error merging customers:', error);
      toast.error('Failed to merge customers');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Customer Deduplication
        </CardTitle>
        <CardDescription>
          Merge duplicate customer records based on phone numbers and email addresses. 
          This will consolidate all conversations under a single customer record.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This operation will:
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Find customers with matching phone numbers or emails</li>
              <li>Keep the oldest customer record for each duplicate group</li>
              <li>Move all conversations to the kept customer record</li>
              <li>Delete the duplicate customer records</li>
            </ul>
          </AlertDescription>
        </Alert>

        <Button 
          onClick={handleMerge} 
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Merging Customers...
            </>
          ) : (
            'Merge Duplicate Customers'
          )}
        </Button>

        {results && results.totalDuplicatesMerged > 0 && (
          <div className="space-y-3">
            <Alert className="border-success">
              <CheckCircle className="h-4 w-4 text-success" />
              <AlertDescription>
                <strong>Merge Complete!</strong>
                <div className="mt-2">
                  <div>Merged {results.totalDuplicatesMerged} duplicate customers</div>
                  <div>Moved {results.totalConversationsMoved} conversations</div>
                </div>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Merge Details:</h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {results.details.map((detail, idx) => (
                  <div key={idx} className="text-sm p-3 bg-muted rounded-md">
                    <div className="font-medium">
                      {detail.type === 'phone' ? '📱' : '📧'} {detail.identifier}
                    </div>
                    <div className="text-muted-foreground mt-1">
                      Merged {detail.mergedCustomerIds.length} duplicates into customer {detail.keptCustomerId.slice(0, 8)}...
                    </div>
                    <div className="text-muted-foreground">
                      Moved {detail.conversationsMoved} conversations
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {results && results.totalDuplicatesMerged === 0 && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              No duplicate customers found. All customer records are unique!
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
