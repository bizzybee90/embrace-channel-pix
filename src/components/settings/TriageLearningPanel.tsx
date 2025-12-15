import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Brain, ArrowRight, Zap, Loader2 } from 'lucide-react';

interface CorrectionGroup {
  sender_domain: string;
  original_classification: string;
  new_classification: string;
  count: number;
}

export function TriageLearningPanel() {
  const { toast } = useToast();
  const [corrections, setCorrections] = useState<CorrectionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingRule, setCreatingRule] = useState<string | null>(null);

  useEffect(() => {
    fetchCorrections();
  }, []);

  const fetchCorrections = async () => {
    try {
      // Get corrections grouped by sender domain and classification change
      const { data, error } = await supabase
        .from('triage_corrections')
        .select('sender_domain, original_classification, new_classification')
        .not('sender_domain', 'is', null);

      if (error) throw error;

      // Group and count
      const grouped: Record<string, CorrectionGroup> = {};
      (data || []).forEach((c) => {
        const key = `${c.sender_domain}|${c.original_classification}|${c.new_classification}`;
        if (!grouped[key]) {
          grouped[key] = {
            sender_domain: c.sender_domain!,
            original_classification: c.original_classification || 'unknown',
            new_classification: c.new_classification || 'unknown',
            count: 0,
          };
        }
        grouped[key].count++;
      });

      // Sort by count descending
      const sorted = Object.values(grouped)
        .filter(g => g.count >= 2) // Only show patterns with 2+ corrections
        .sort((a, b) => b.count - a.count);

      setCorrections(sorted);
    } catch (error) {
      console.error('Error fetching corrections:', error);
    } finally {
      setLoading(false);
    }
  };

  const createRuleFromPattern = async (pattern: CorrectionGroup) => {
    setCreatingRule(pattern.sender_domain);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user?.id)
        .single();

      // Check if rule already exists
      const { data: existingRule } = await supabase
        .from('sender_rules')
        .select('id')
        .eq('sender_pattern', `@${pattern.sender_domain}`)
        .single();

      if (existingRule) {
        toast({ 
          title: 'Rule already exists', 
          description: `A rule for @${pattern.sender_domain} already exists`,
        });
        return;
      }

      // Determine if it requires reply based on the correction pattern
      const requiresReply = pattern.new_classification === 'customer_inquiry';

      const { error } = await supabase
        .from('sender_rules')
        .insert({
          workspace_id: userData?.workspace_id,
          sender_pattern: `@${pattern.sender_domain}`,
          default_classification: pattern.new_classification,
          default_requires_reply: requiresReply,
          is_active: true,
        });

      if (error) throw error;

      toast({ 
        title: 'Rule created',
        description: `Emails from @${pattern.sender_domain} will now be classified as ${pattern.new_classification}`,
      });
      
      // Remove from list
      setCorrections(corrections.filter(c => c.sender_domain !== pattern.sender_domain));
    } catch (error) {
      console.error('Error creating rule:', error);
      toast({ 
        title: 'Failed to create rule', 
        variant: 'destructive' 
      });
    } finally {
      setCreatingRule(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          AI Learning Suggestions
        </CardTitle>
        <CardDescription>
          Based on your corrections, the AI has identified patterns that could become rules.
          Click "Create Rule" to automate future classifications.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {corrections.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No patterns detected yet. Keep correcting misclassified emails and suggestions will appear here.
          </p>
        ) : (
          <div className="space-y-3">
            {corrections.map((pattern) => (
              <div
                key={`${pattern.sender_domain}-${pattern.new_classification}`}
                className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <p className="font-mono text-sm">@{pattern.sender_domain}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-xs">
                        {pattern.original_classification.replace('_', ' ')}
                      </Badge>
                      <ArrowRight className="h-3 w-3" />
                      <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">
                        {pattern.new_classification.replace('_', ' ')}
                      </Badge>
                      <span className="ml-2">
                        ({pattern.count} corrections)
                      </span>
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => createRuleFromPattern(pattern)}
                  disabled={creatingRule === pattern.sender_domain}
                >
                  {creatingRule === pattern.sender_domain ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-1" />
                      Create Rule
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
