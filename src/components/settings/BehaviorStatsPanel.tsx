import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  TrendingUp, 
  Loader2,
  Plus,
  Eye,
  Mail,
  Clock,
  Star,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface BehaviorStat {
  id: string;
  sender_domain: string;
  sender_email: string | null;
  total_messages: number;
  replied_count: number;
  ignored_count: number;
  reply_rate: number;
  avg_response_time_minutes: number | null;
  vip_score: number;
  suggested_bucket: string | null;
  last_interaction_at: string | null;
}

export function BehaviorStatsPanel() {
  const { toast } = useToast();
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(true);
  const [creatingRule, setCreatingRule] = useState<string | null>(null);

  const { data: stats, isLoading } = useQuery({
    queryKey: ['behavior-stats', workspace?.id],
    queryFn: async (): Promise<BehaviorStat[]> => {
      if (!workspace?.id) return [];

      const { data, error } = await supabase
        .from('sender_behaviour_stats')
        .select('*')
        .eq('workspace_id', workspace.id)
        .order('vip_score', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data || [];
    },
    enabled: !!workspace?.id,
  });

  const { data: existingRules } = useQuery({
    queryKey: ['sender-rules-patterns', workspace?.id],
    queryFn: async () => {
      if (!workspace?.id) return new Set<string>();

      const { data, error } = await supabase
        .from('sender_rules')
        .select('sender_pattern')
        .eq('workspace_id', workspace.id);

      if (error) throw error;
      return new Set((data || []).map(r => r.sender_pattern.toLowerCase()));
    },
    enabled: !!workspace?.id,
  });

  const handleCreateRule = async (stat: BehaviorStat) => {
    if (!workspace?.id) return;
    
    setCreatingRule(stat.id);

    try {
      const pattern = `@${stat.sender_domain}`;
      const classification = stat.suggested_bucket === 'auto_handled' 
        ? 'automated_notification' 
        : stat.reply_rate > 0.5 
          ? 'customer_inquiry' 
          : 'automated_notification';
      
      const { error } = await supabase
        .from('sender_rules')
        .insert({
          workspace_id: workspace.id,
          sender_pattern: pattern,
          default_classification: classification,
          default_requires_reply: stat.reply_rate > 0.5,
          is_active: true,
        });

      if (error) throw error;

      toast({
        title: 'Rule Created',
        description: `Created rule for ${pattern} → ${classification}`,
      });

      queryClient.invalidateQueries({ queryKey: ['sender-rules'] });
      queryClient.invalidateQueries({ queryKey: ['sender-rules-patterns'] });
    } catch (error) {
      console.error('Error creating rule:', error);
      toast({
        title: 'Error',
        description: 'Failed to create rule',
        variant: 'destructive',
      });
    } finally {
      setCreatingRule(null);
    }
  };

  const getBucketBadge = (bucket: string | null) => {
    switch (bucket) {
      case 'auto_handled':
        return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">Auto-handle</Badge>;
      case 'act_now':
        return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">Needs Reply</Badge>;
      case 'quick_win':
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">Quick Win</Badge>;
      default:
        return <Badge variant="outline" className="text-muted-foreground">Unknown</Badge>;
    }
  };

  const hasRule = (domain: string) => {
    if (!existingRules) return false;
    return existingRules.has(`@${domain.toLowerCase()}`);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const statsWithoutRules = (stats || []).filter(s => !hasRule(s.sender_domain));
  const statsWithRules = (stats || []).filter(s => hasRule(s.sender_domain));

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between cursor-pointer">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Sender Behavior Stats
                  <Badge variant="secondary">{stats?.length || 0} domains</Badge>
                </CardTitle>
                <CardDescription>
                  How you've historically handled emails from each sender domain
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm">
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </CollapsibleTrigger>
        </CardHeader>
        
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Domains without rules - actionable */}
            {statsWithoutRules.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Suggested Rules ({statsWithoutRules.length})
                </h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Based on how you've handled emails from these senders, click to create automatic rules.
                </p>
                <div className="space-y-2">
                  {statsWithoutRules.slice(0, 10).map((stat) => (
                    <div 
                      key={stat.id} 
                      className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-dashed hover:border-primary/50 transition-colors"
                    >
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">@{stat.sender_domain}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {stat.total_messages} emails
                            </span>
                            <span className="flex items-center gap-1">
                              <Eye className="h-3 w-3" />
                              {Math.round((stat.reply_rate || 0) * 100)}% replied
                            </span>
                            {stat.avg_response_time_minutes && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {Math.round(stat.avg_response_time_minutes)}m avg
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Star className="h-3 w-3" />
                              VIP: {Math.round((stat.vip_score || 0) * 100)}
                            </span>
                          </div>
                        </div>
                        {getBucketBadge(stat.suggested_bucket)}
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline"
                        className="ml-4 shrink-0"
                        onClick={() => handleCreateRule(stat)}
                        disabled={creatingRule === stat.id}
                      >
                        {creatingRule === stat.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4 mr-1" />
                        )}
                        Create Rule
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Domains with rules - info only */}
            {statsWithRules.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  Already Covered ({statsWithRules.length})
                </h4>
                <div className="space-y-1">
                  {statsWithRules.slice(0, 5).map((stat) => (
                    <div 
                      key={stat.id} 
                      className="flex items-center justify-between p-2 bg-muted/20 rounded-lg text-sm"
                    >
                      <span className="text-muted-foreground">@{stat.sender_domain}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{stat.total_messages} emails</span>
                        <Badge variant="outline" className="text-xs">Has Rule</Badge>
                      </div>
                    </div>
                  ))}
                  {statsWithRules.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      +{statsWithRules.length - 5} more domains with rules
                    </p>
                  )}
                </div>
              </div>
            )}

            {(!stats || stats.length === 0) && (
              <div className="text-center py-8 text-muted-foreground">
                <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No behavior stats yet</p>
                <p className="text-sm">Click "Compute Stats" in the Learning System panel to analyze your email history</p>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
