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

    const { workspaceId, limit = 50, offset = 0, dryRun = false, skipLLM = true } = await req.json();

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[bulk-retriage] Starting for workspace ${workspaceId}, limit=${limit}, offset=${offset}, dryRun=${dryRun}, skipLLM=${skipLLM}`);

    // Fetch sender rules for this workspace
    const { data: senderRules } = await supabase
      .from('sender_rules')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    console.log(`[bulk-retriage] Found ${senderRules?.length || 0} sender rules`);

    // Fetch conversations for retriage
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
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (convError) {
      console.error('[bulk-retriage] Error fetching conversations:', convError);
      throw convError;
    }

    console.log(`[bulk-retriage] Found ${conversations?.length || 0} conversations to retriage`);

    const results: RetriagedResult[] = [];
    const updates: any[] = [];

    // Get Anthropic API key for AI classification
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

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
      } else if (!skipLLM && ANTHROPIC_API_KEY && messageBody) {
        // Use Anthropic Claude for AI classification
        try {
          const triagePrompt = `Analyze this email and classify it. Reply ONLY with valid JSON, no other text.

SENDER: ${customerEmail || 'unknown'}
SUBJECT: ${subject}
BODY: ${messageBody.slice(0, 2000)}

Classify into ONE bucket:
- auto_handled: Receipts, newsletters, notifications, automated emails, spam (no human action needed)
- quick_win: Simple reply needed, easy customer question
- act_now: Urgent customer issue, complaint, or time-sensitive matter

Reply with ONLY this JSON:
{"bucket":"auto_handled","classification":"receipt_confirmation","requires_reply":false,"reason":"Brief explanation"}

Valid classifications: receipt_confirmation, marketing_newsletter, automated_notification, customer_inquiry, spam_phishing, recruitment_hr`;

          const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-3-5-haiku-20241022',
              max_tokens: 200,
              messages: [
                { role: 'user', content: triagePrompt }
              ],
            }),
          });

          if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            const content = aiData.content?.[0]?.text || '';
            
            // Extract JSON from response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              newBucket = parsed.bucket || newBucket;
              newClassification = parsed.classification || newClassification;
              newRequiresReply = parsed.requires_reply ?? newRequiresReply;
              whyText = parsed.reason || null;
              console.log(`[bulk-retriage] AI classified ${conv.id}: ${newBucket}`);
            }
          } else {
            const errorText = await aiResponse.text();
            console.error(`[bulk-retriage] Anthropic API error: ${aiResponse.status} - ${errorText}`);
          }
        } catch (aiError) {
          console.error(`[bulk-retriage] AI error for ${conv.id}:`, aiError);
        }
      } else if (!skipLLM && !ANTHROPIC_API_KEY) {
        // Fallback pattern matching if no API key
        const lowerBody = messageBody.toLowerCase();
        const lowerSubject = subject.toLowerCase();

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
      skipLLM,
      hasAnthropicKey: !!ANTHROPIC_API_KEY,
      results: dryRun ? results : results.slice(0, 10),
    };

    console.log(`[bulk-retriage] Complete. Processed: ${summary.processed}, Changed: ${summary.changed}, AI: ${!skipLLM && ANTHROPIC_API_KEY ? 'Anthropic Claude' : 'Pattern matching'}`);

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
