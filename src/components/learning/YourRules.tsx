import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useToast } from '@/hooks/use-toast';
import { Pencil, Trash2, Plus, Loader2, BookOpen } from 'lucide-react';

interface SenderRule {
  id: string;
  sender_pattern: string;
  default_classification: string;
  is_active: boolean | null;
}

const formatClassification = (str: string) =>
  str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

export const YourRules = () => {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [rules, setRules] = useState<SenderRule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRules = async () => {
    if (!workspace?.id) return;
    const { data } = await supabase
      .from('sender_rules')
      .select('id, sender_pattern, default_classification, is_active')
      .eq('workspace_id', workspace.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(50);
    setRules(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchRules(); }, [workspace?.id]);

  const deleteRule = async (id: string) => {
    await supabase.from('sender_rules').delete().eq('id', id);
    toast({ title: 'Rule deleted' });
    fetchRules();
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">Your rules</h2>
        </div>
        <span className="text-xs text-muted-foreground">{rules.length} active</span>
      </div>

      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No rules yet. Review emails in the Training queue to start teaching BizzyBee.
        </p>
      ) : (
        <div className="space-y-1">
          {rules.map(rule => (
            <div
              key={rule.id}
              className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors group"
            >
              <p className="text-sm text-foreground">
                Emails from <span className="font-medium">{rule.sender_pattern}</span>
                {' → '}
                <span className="text-muted-foreground">
                  auto-handle as {formatClassification(rule.default_classification || 'unknown')}
                </span>
              </p>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => deleteRule(rule.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
