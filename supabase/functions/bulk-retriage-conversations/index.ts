import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RetriagedResult {
  id: string;
  originalBucket: string;
  newBucket: string;
  ruleApplied: string | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { workspaceId, limit = 50, dryRun = false, skipLLM = true } = await req.json();

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[bulk-retriage] Starting for workspace ${workspaceId}, limit=${limit}, dryRun=${dryRun}, skipLLM=${skipLLM}`);

    // Fetch sender rules for this workspace
    const { data: senderRules } = await supabase
      .from('sender_rules')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    console.log(`[bulk-retriage] Found ${senderRules?.length || 0} sender rules`);

    // Fetch conversations needing retriage (no email_classification or decision_bucket is default)
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        title,
        decision_bucket,
        email_classification,
        requires_reply,
        customer:customers(email, name),
        messages(body, direction)
      `)
      .eq('workspace_id', workspaceId)
      .or('email_classification.is.null,decision_bucket.eq.quick_win')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (convError) {
      console.error('[bulk-retriage] Error fetching conversations:', convError);
      throw convError;
    }

    console.log(`[bulk-retriage] Found ${conversations?.length || 0} conversations to retriage`);

    const results: RetriagedResult[] = [];
    const updates: any[] = [];

    for (const conv of conversations || []) {
      const customerEmail = conv.customer?.[0]?.email;
      const senderDomain = customerEmail?.split('@')[1];
      const inboundMessage = conv.messages?.find((m: any) => m.direction === 'inbound');
      const messageBody = inboundMessage?.body || '';
      const subject = conv.title || '';

      let matched = false;
      let matchedRule = null;

      // Check sender rules first
      if (senderRules && senderDomain) {
        for (const rule of senderRules) {
          const pattern = rule.sender_pattern.toLowerCase();
          const email = customerEmail?.toLowerCase() || '';
          const domain = senderDomain.toLowerCase();

          // Match patterns like @stripe.com, noreply@, etc.
          if (pattern.startsWith('@') && domain === pattern.slice(1)) {
            matched = true;
            matchedRule = rule;
            break;
          } else if (email.includes(pattern) || domain.includes(pattern)) {
            matched = true;
            matchedRule = rule;
            break;
          }
        }
      }

      // Determine new bucket based on rule or patterns
      let newBucket = conv.decision_bucket;
      let newClassification = conv.email_classification;
      let newRequiresReply = conv.requires_reply;
      let whyText = null;

      if (matched && matchedRule) {
        // Apply sender rule
        newClassification = matchedRule.default_classification;
        newRequiresReply = matchedRule.default_requires_reply;
        
        // Map classification to bucket
        if (!newRequiresReply || newClassification === 'automated_notification' || 
            newClassification === 'receipt_confirmation' || newClassification === 'recruitment_hr') {
          newBucket = 'auto_handled';
          whyText = `Auto-handled: Matches rule for ${matchedRule.sender_pattern}`;
        } else if (newClassification === 'customer_inquiry') {
          newBucket = 'quick_win';
          whyText = 'Customer inquiry needs a reply';
        }
      } else if (!skipLLM) {
        // TODO: Call email-triage-agent for full LLM analysis
        // For now, use pattern matching
        const lowerBody = messageBody.toLowerCase();
        const lowerSubject = subject.toLowerCase();

        // Pattern matching for common cases
        if (lowerSubject.includes('payment') || lowerSubject.includes('receipt') || 
            lowerSubject.includes('invoice paid') || lowerBody.includes('payment successful')) {
          newBucket = 'auto_handled';
          newClassification = 'receipt_confirmation';
          newRequiresReply = false;
          whyText = 'Payment/receipt notification - no action needed';
        } else if (lowerSubject.includes('application') || lowerBody.includes('applied for') ||
                   senderDomain === 'indeed.com' || senderDomain === 'linkedin.com') {
          newBucket = 'auto_handled';
          newClassification = 'recruitment_hr';
          newRequiresReply = false;
          whyText = 'Job application notification - filed for reference';
        } else if (lowerBody.includes('unsubscribe') || lowerSubject.includes('newsletter')) {
          newBucket = 'auto_handled';
          newClassification = 'marketing_newsletter';
          newRequiresReply = false;
          whyText = 'Marketing/newsletter - auto-filed';
        }
      }

      if (newBucket !== conv.decision_bucket || newClassification !== conv.email_classification) {
        results.push({
          id: conv.id,
          originalBucket: conv.decision_bucket || 'unknown',
          newBucket,
          ruleApplied: matchedRule?.sender_pattern || null,
        });

        if (!dryRun) {
          updates.push({
            id: conv.id,
            decision_bucket: newBucket,
            email_classification: newClassification,
            requires_reply: newRequiresReply,
            why_this_needs_you: whyText,
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    // Apply updates in batch
    if (!dryRun && updates.length > 0) {
      console.log(`[bulk-retriage] Applying ${updates.length} updates`);
      
      for (const update of updates) {
        const { error } = await supabase
          .from('conversations')
          .update({
            decision_bucket: update.decision_bucket,
            email_classification: update.email_classification,
            requires_reply: update.requires_reply,
            why_this_needs_you: update.why_this_needs_you,
            updated_at: update.updated_at,
          })
          .eq('id', update.id);

        if (error) {
          console.error(`[bulk-retriage] Error updating ${update.id}:`, error);
        }
      }
    }

    const summary = {
      processed: conversations?.length || 0,
      changed: results.length,
      dryRun,
      results: dryRun ? results : results.slice(0, 10), // Only return first 10 in non-dry-run
    };

    console.log(`[bulk-retriage] Complete. Processed: ${summary.processed}, Changed: ${summary.changed}`);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[bulk-retriage] Error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});