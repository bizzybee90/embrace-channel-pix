import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SuggestedRule {
  senderDomain: string;
  totalEmails: number;
  repliedCount: number;
  ignoredCount: number;
  replyRate: number;
  suggestedBucket: 'auto_handled' | 'quick_win' | 'act_now' | 'wait';
  suggestedClassification: string;
  requiresReply: boolean;
  confidence: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'bootstrap-sender-rules';

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { workspaceId, minEmailCount = 5 } = await req.json();

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[${functionName}] Analyzing patterns for workspace ${workspaceId}`);

    // Get existing sender rules to exclude
    const { data: existingRules } = await supabase
      .from('sender_rules')
      .select('sender_pattern')
      .eq('workspace_id', workspaceId);

    const existingPatterns = new Set(existingRules?.map(r => r.sender_pattern.toLowerCase()) || []);

    // Analyze conversations by sender domain
    const { data: conversations } = await supabase
      .from('conversations')
      .select(`
        id,
        decision_bucket,
        status,
        requires_reply,
        customer:customers(email)
      `)
      .eq('workspace_id', workspaceId);

    // Get messages to check for outbound replies
    const { data: messages } = await supabase
      .from('messages')
      .select('conversation_id, direction, actor_type')
      .in('conversation_id', conversations?.map(c => c.id) || []);

    // Group by sender domain
    const domainStats: Record<string, {
      total: number;
      replied: number;
      resolved: number;
      autoHandled: number;
    }> = {};

    const conversationReplies = new Set<string>();
    messages?.forEach(m => {
      if (m.direction === 'outbound' && m.actor_type !== 'ai') {
        conversationReplies.add(m.conversation_id);
      }
    });

    conversations?.forEach(conv => {
      const email = conv.customer?.[0]?.email;
      const domain = email?.split('@')[1];
      if (!domain) return;

      if (!domainStats[domain]) {
        domainStats[domain] = { total: 0, replied: 0, resolved: 0, autoHandled: 0 };
      }

      domainStats[domain].total++;

      if (conversationReplies.has(conv.id)) {
        domainStats[domain].replied++;
      }

      if (conv.status === 'resolved') {
        domainStats[domain].resolved++;
      }

      if (conv.decision_bucket === 'auto_handled') {
        domainStats[domain].autoHandled++;
      }
    });

    // Generate suggestions
    const suggestions: SuggestedRule[] = [];

    for (const [domain, stats] of Object.entries(domainStats)) {
      // Skip if already has a rule
      if (existingPatterns.has(`@${domain.toLowerCase()}`)) continue;
      
      // Skip if not enough emails
      if (stats.total < minEmailCount) continue;

      const replyRate = stats.total > 0 ? (stats.replied / stats.total) * 100 : 0;
      const autoHandledRate = stats.total > 0 ? (stats.autoHandled / stats.total) * 100 : 0;

      let suggestedBucket: 'auto_handled' | 'quick_win' | 'act_now' | 'wait' = 'quick_win';
      let suggestedClassification = 'customer_inquiry';
      let requiresReply = true;
      let confidence = 50;

      // Analyze patterns
      if (replyRate < 10 && stats.total >= 3) {
        // Almost never replied to
        suggestedBucket = 'auto_handled';
        suggestedClassification = 'automated_notification';
        requiresReply = false;
        confidence = Math.min(95, 70 + (stats.total * 2));
      } else if (replyRate < 25) {
        // Rarely replied to
        suggestedBucket = 'wait';
        suggestedClassification = 'fyi_notification';
        requiresReply = false;
        confidence = Math.min(85, 60 + (stats.total * 1.5));
      } else if (replyRate > 80) {
        // Almost always replied to
        suggestedBucket = 'quick_win';
        suggestedClassification = 'customer_inquiry';
        requiresReply = true;
        confidence = Math.min(95, 75 + ((replyRate - 80) / 2));
      } else if (replyRate > 90) {
        // Critical sender
        suggestedBucket = 'act_now';
        suggestedClassification = 'customer_inquiry';
        requiresReply = true;
        confidence = 90;
      }

      // Known patterns boost confidence
      const lowerDomain = domain.toLowerCase();
      if (lowerDomain.includes('stripe') || lowerDomain.includes('paypal') || 
          lowerDomain.includes('gocardless')) {
        suggestedBucket = 'auto_handled';
        suggestedClassification = 'receipt_confirmation';
        requiresReply = false;
        confidence = 95;
      } else if (lowerDomain.includes('indeed') || lowerDomain.includes('linkedin') ||
                 lowerDomain.includes('reed') || lowerDomain.includes('totaljobs')) {
        suggestedBucket = 'auto_handled';
        suggestedClassification = 'recruitment_hr';
        requiresReply = false;
        confidence = 95;
      } else if (lowerDomain.includes('noreply') || lowerDomain.includes('no-reply') ||
                 lowerDomain.includes('notifications')) {
        suggestedBucket = 'auto_handled';
        suggestedClassification = 'automated_notification';
        requiresReply = false;
        confidence = 90;
      }

      suggestions.push({
        senderDomain: domain,
        totalEmails: stats.total,
        repliedCount: stats.replied,
        ignoredCount: stats.total - stats.replied,
        replyRate: Math.round(replyRate),
        suggestedBucket,
        suggestedClassification,
        requiresReply,
        confidence,
      });
    }

    // Sort by confidence and total emails
    suggestions.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.totalEmails - a.totalEmails;
    });

    console.log(`[${functionName}] Generated ${suggestions.length} suggestions`);

    // =========================================================================
    // AUTO-CREATE HIGH-CONFIDENCE RULES (>= 85%)
    // =========================================================================
    const autoCreateRules = suggestions.filter(s => s.confidence >= 85);
    let rulesCreated = 0;

    for (const rule of autoCreateRules) {
      const { error: upsertError } = await supabase
        .from('sender_rules')
        .upsert({
          workspace_id: workspaceId,
          sender_pattern: `@${rule.senderDomain}`,
          default_classification: rule.suggestedClassification,
          override_bucket: rule.suggestedBucket,
          auto_created: true,
          is_active: true,
          confidence_score: rule.confidence,
          email_count: rule.totalEmails,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id,sender_pattern' });

      if (!upsertError) {
        rulesCreated++;
      } else {
        console.error(`[${functionName}] Failed to create rule for ${rule.senderDomain}:`, upsertError);
      }
    }

    console.log(`[${functionName}] Auto-created ${rulesCreated} high-confidence rules`);

    // =========================================================================
    // MARK EMAIL PIPELINE COMPLETE
    // =========================================================================
    await supabase
      .from('email_import_progress')
      .upsert({
        workspace_id: workspaceId,
        current_phase: 'complete',
        playbook_complete: true,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

    // Update email provider config sync status
    await supabase
      .from('email_provider_configs')
      .update({
        sync_status: 'complete',
        sync_stage: 'complete',
        sync_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId);

    // Mark user onboarding as complete
    await supabase
      .from('users')
      .update({
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId);

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Pipeline complete for workspace ${workspaceId} in ${duration}ms`);

    return new Response(JSON.stringify({ 
      success: true,
      suggestions: suggestions.slice(0, 20), // Return top 20 for UI display
      totalAnalyzed: Object.keys(domainStats).length,
      rulesAutoCreated: rulesCreated,
      pipelineComplete: true,
      duration_ms: duration,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error(`[${functionName}] Error:`, error);
    return new Response(JSON.stringify({ error: error?.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});