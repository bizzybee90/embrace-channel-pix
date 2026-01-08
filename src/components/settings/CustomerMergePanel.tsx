import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertCircle, CheckCircle, Loader2, Users, MessagesSquare } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

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
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [customerResults, setCustomerResults] = useState<MergeResponse | null>(null);
  const [conversationResults, setConversationResults] = useState<any | null>(null);

  const handleMergeCustomers = async () => {
    // Function removed - duplicate prevention now handled by DB constraints
    toast.info('Duplicate prevention is now automatic via database constraints');
  };

  const handleMergeConversations = async () => {
    // Function removed - duplicate prevention now handled by DB constraints
    toast.info('Duplicate prevention is now automatic via database constraints');
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Merge Duplicate Customers
          </CardTitle>
          <CardDescription>
            Consolidate duplicate customer records based on phone numbers and email addresses.
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
          onClick={handleMergeCustomers} 
          disabled={isLoadingCustomers}
          className="w-full"
        >
          {isLoadingCustomers ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Merging Customers...
            </>
          ) : (
            'Merge Duplicate Customers'
          )}
        </Button>

        {customerResults && customerResults.totalDuplicatesMerged > 0 && (
          <div className="space-y-3">
            <Alert className="border-success">
              <CheckCircle className="h-4 w-4 text-success" />
              <AlertDescription>
                <strong>Merge Complete!</strong>
                <div className="mt-2">
                  <div>Merged {customerResults.totalDuplicatesMerged} duplicate customers</div>
                  <div>Moved {customerResults.totalConversationsMoved} conversations</div>
                </div>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Merge Details:</h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {customerResults.details.map((detail, idx) => (
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

        {customerResults && customerResults.totalDuplicatesMerged === 0 && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              No duplicate customers found. All customer records are unique!
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessagesSquare className="h-5 w-5" />
            Merge Duplicate Conversations
          </CardTitle>
          <CardDescription>
            Consolidate multiple open conversations from the same customer on the same channel into one conversation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This operation will:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Find conversations with the same customer and channel</li>
                <li>Keep the oldest conversation for each group</li>
                <li>Move all messages to the kept conversation</li>
                <li>Delete the duplicate conversation records</li>
              </ul>
            </AlertDescription>
          </Alert>

          <Button 
            onClick={handleMergeConversations} 
            disabled={isLoadingConversations}
            className="w-full"
          >
            {isLoadingConversations ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Merging Conversations...
              </>
            ) : (
              'Merge Duplicate Conversations'
            )}
          </Button>

          {conversationResults && conversationResults.totalConversationsMerged > 0 && (
            <div className="space-y-3">
              <Alert className="border-success">
                <CheckCircle className="h-4 w-4 text-success" />
                <AlertDescription>
                  <strong>Merge Complete!</strong>
                  <div className="mt-2">
                    <div>Merged {conversationResults.totalConversationsMerged} duplicate conversations</div>
                    <div>Moved {conversationResults.totalMessagesMoved} messages</div>
                  </div>
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <h4 className="text-sm font-medium">Merge Details:</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {conversationResults.details.map((detail: any, idx: number) => (
                    <div key={idx} className="text-sm p-3 bg-muted rounded-md">
                      <div className="font-medium">
                        Customer: {detail.customerId.slice(0, 8)}... • {detail.channel}
                      </div>
                      <div className="text-muted-foreground mt-1">
                        Merged {detail.mergedConversationIds.length} conversations into {detail.keptConversationId.slice(0, 8)}...
                      </div>
                      <div className="text-muted-foreground">
                        Moved {detail.messagesMoved} messages
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {conversationResults && conversationResults.totalConversationsMerged === 0 && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                No duplicate conversations found. All conversations are unique!
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
