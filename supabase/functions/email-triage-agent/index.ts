import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Decision Router Prompt - Routes to ACTION, not categories
const DEFAULT_TRIAGE_PROMPT = `You are an AI Operations Manager for a service business (window cleaning, home services, etc.). Your job is NOT to classify emails - it's to DECIDE what action the business owner should take.

## CRITICAL: You Are a Decision Router, Not a Classifier

For every email, you must answer ONE question:
"What should the business owner DO about this?"

## Distribution Guidance (IMPORTANT!)
In a typical inbox, your decisions should roughly follow this distribution:
- ACT_NOW: 5-10% (urgent, risky - use sparingly)
- QUICK_WIN: 15-25% (fast to clear)
- AUTO_HANDLED: 50-70% (noise, hidden from user - THIS IS THE DEFAULT SINK)
- WAIT: 5-10% (RARE - only for specific deferred human action)

⚠️ If more than 30% of messages go to WAIT, you are being too conservative.
⚠️ AUTO_HANDLED should be your DEFAULT for anything the user won't act on.

## Decision Buckets (Pick ONE)

### 🔴 ACT_NOW - Needs immediate human attention (5-10% of emails)
Use when:
- Customer is upset, frustrated, or complaining
- Payment issue or financial risk
- Service disruption or cancellation threat
- Time-sensitive request (today/tomorrow)
- Legal or reputation risk
- Your confidence is below 70%

### 🟡 QUICK_WIN - Can be handled in under 30 seconds (15-25% of emails)
Use when:
- Simple yes/no reply needed
- Straightforward confirmation
- Template response will work
- No complex thinking required
- Your confidence is above 85%

### 🟢 AUTO_HANDLED - No human action EVER needed (50-70% of emails - DEFAULT!)
This is your DEFAULT bucket for noise. Use when:
- Marketing emails and newsletters (even from known senders)
- Automated notifications (receipts, confirmations, alerts, job alerts)
- Spam or phishing attempts
- System notifications
- Payment confirmations / receipts
- Shipping notifications
- Social media notifications
- Calendar invites that don't need response
- The user will NEVER look at this again
- Your confidence is above 90%

⚠️ KEY RULE: If the user will NEVER come back to this email → AUTO_HANDLED, not WAIT

### 🔵 WAIT - Human action needed LATER (5-10% of emails - USE SPARINGLY!)
⚠️ WAIT is RARE. Only use when ALL of these are true:
- The user WILL return to this later (not just "might be useful")
- There is a SPECIFIC future action the user needs to take
- It's not safe to auto-complete
- Examples: "Follow up next week", "Check if payment cleared in 3 days", "Review quote before sending"

❌ DO NOT use WAIT for:
- Receipts (→ AUTO_HANDLED)
- Notifications (→ AUTO_HANDLED)
- Newsletters (→ AUTO_HANDLED)
- FYI emails with no action (→ AUTO_HANDLED)
- "Might be useful later" (→ AUTO_HANDLED)

## "Why This Needs You" - ALWAYS Explain (Required!)

Every email MUST have a clear, human-readable explanation of why it landed in its bucket:
- ACT_NOW: "Customer upset about [specific issue]" or "Payment at risk - [reason]"
- QUICK_WIN: "Simple confirmation needed" or "Yes/no reply will resolve this"
- AUTO_HANDLED: "Automated receipt - no action needed" or "Marketing newsletter"
- WAIT: "Follow up needed on [date] for [specific reason]"

This field must NEVER be empty. It must be actionable and specific.

## Risk Assessment

Evaluate potential harm if this email is ignored:
- financial: Could cost money (unpaid invoice, cancelled booking, refund demand)
- retention: Could lose this customer (complaint, dissatisfaction)
- reputation: Could damage business image (public review threat, social media)
- legal: Could have legal implications (formal complaint, regulatory)
- none: No significant risk

## Cognitive Load Assessment

How much thinking does this require?
- high: Requires careful consideration, context, or complex response
- low: Straightforward, template response works, minimal thinking

## Important Context

1. This is a SERVICE BUSINESS that RECEIVES invoices from suppliers (not just sends them)
   - Invoices TO the business = supplier_invoice (may need payment)
   - Invoices FROM the business = ignore (already sent)

2. When in doubt between WAIT and AUTO_HANDLED → choose AUTO_HANDLED
   - WAIT should be RARE (only when there's a specific future action)
   - AUTO_HANDLED is for everything the user will never revisit

3. Look for emotional signals: frustration, urgency, threats, or praise

4. Consider the sender: known customer vs new lead vs supplier vs automated system`;

async function getTriagePrompt(supabase: any, workspaceId?: string): Promise<{ prompt: string; model: string }> {
  try {
    if (workspaceId) {
      const { data: wsPrompt } = await supabase
        .from('system_prompts')
        .select('prompt, model')
        .eq('agent_type', 'triage')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true)
        .eq('is_default', true)
        .single();
      
      if (wsPrompt?.prompt) {
        console.log('Using workspace-specific triage prompt');
        return { prompt: wsPrompt.prompt, model: wsPrompt.model || 'claude-3-5-haiku-20241022' };
      }
    }

    const { data: globalPrompt } = await supabase
      .from('system_prompts')
      .select('prompt, model')
      .eq('agent_type', 'triage')
      .is('workspace_id', null)
      .eq('is_active', true)
      .eq('is_default', true)
      .single();

    if (globalPrompt?.prompt) {
      console.log('Using global default triage prompt');
      return { prompt: globalPrompt.prompt, model: globalPrompt.model || 'claude-3-5-haiku-20241022' };
    }
  } catch (error) {
    console.error('Error fetching triage prompt:', error);
  }

  console.log('Using hardcoded fallback triage prompt');
  return { prompt: DEFAULT_TRIAGE_PROMPT, model: 'claude-3-5-haiku-20241022' };
}

// Decision Router Tool - Focus on ACTION, not classification
const DECISION_ROUTER_TOOL = {
  name: "route_email",
  description: "Decide what action the business owner should take on this email",
  input_schema: {
    type: "object",
    properties: {
      decision: {
        type: "object",
        properties: {
          bucket: {
            type: "string",
            enum: ["act_now", "quick_win", "auto_handled", "wait"],
            description: "The decision bucket: act_now (urgent), quick_win (fast to clear), auto_handled (no human needed), wait (defer)"
          },
          why_this_needs_you: {
            type: "string",
            description: "Human-readable explanation in 10 words or less. E.g., 'Customer upset about late delivery' or 'Automated receipt - no action needed'"
          },
          confidence: {
            type: "number",
            description: "Confidence score from 0 to 1"
          }
        },
        required: ["bucket", "why_this_needs_you", "confidence"]
      },
      risk: {
        type: "object",
        properties: {
          level: {
            type: "string",
            enum: ["financial", "retention", "reputation", "legal", "none"],
            description: "Type of risk if this email is ignored"
          },
          cognitive_load: {
            type: "string",
            enum: ["high", "low"],
            description: "Whether this requires significant thinking (high) or is simple (low)"
          }
        },
        required: ["level", "cognitive_load"]
      },
      classification: {
        type: "object",
        description: "Secondary classification metadata (for analytics)",
        properties: {
          category: {
            type: "string",
            enum: [
              "customer_inquiry", "customer_complaint", "customer_feedback",
              "lead_new", "lead_followup", "supplier_invoice", "supplier_urgent", "partner_request",
              "automated_notification", "receipt_confirmation", "marketing_newsletter",
              "spam_phishing", "recruitment_hr", "internal_system", "informational_only"
            ],
            description: "The classification category (secondary to decision bucket)"
          },
          requires_reply: {
            type: "boolean",
            description: "Whether this email requires a human response"
          }
        },
        required: ["category", "requires_reply"]
      },
      priority: {
        type: "object",
        properties: {
          urgency: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Urgency level"
          },
          urgency_reason: {
            type: "string",
            description: "Brief explanation for the urgency level"
          }
        },
        required: ["urgency", "urgency_reason"]
      },
      sentiment: {
        type: "object",
        properties: {
          tone: {
            type: "string",
            enum: ["angry", "frustrated", "concerned", "neutral", "positive"],
            description: "Customer sentiment tone"
          }
        },
        required: ["tone"]
      },
      entities: {
        type: "object",
        properties: {
          customer_name: { type: "string", description: "Extracted customer name" },
          phone_number: { type: "string", description: "Extracted phone number" },
          address: { type: "string", description: "Extracted address or postcode" },
          date_mentioned: { type: "string", description: "Any dates mentioned" },
          order_id: { type: "string", description: "Order or booking reference" },
          amount: { type: "string", description: "Monetary amounts mentioned" },
          service_type: { type: "string", description: "Service being inquired about" }
        }
      },
      summary: {
        type: "object",
        properties: {
          one_line: {
            type: "string",
            description: "One-line summary (max 100 chars)"
          },
          key_points: {
            type: "array",
            items: { type: "string" },
            description: "Key points (max 3)"
          }
        },
        required: ["one_line", "key_points"]
      },
      suggested_reply: {
        type: "string",
        description: "For QUICK_WIN only: A suggested reply that could resolve this in seconds. Leave empty for other buckets."
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of the decision"
      }
    },
    required: ["decision", "risk", "classification", "priority", "sentiment", "summary", "reasoning"]
  }
};

interface TriageRequest {
  email: {
    from_email: string;
    from_name: string;
    subject: string;
    body: string;
    to_email?: string;
  };
  workspace_id: string;
  business_context?: {
    is_hiring?: boolean;
    active_dispute?: boolean;
    vip_domains?: string[];
  };
  sender_rule?: {
    default_classification: string;
    default_requires_reply: boolean;
    override_classification?: string;
    override_requires_reply?: boolean;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const request: TriageRequest = await req.json();
    const { email, workspace_id, business_context, sender_rule } = request;

    console.log('Decision router processing email from:', email.from_email, 'subject:', email.subject);

    // If sender rule exists, apply it directly with decision bucket mapping
    if (sender_rule) {
      const classification = sender_rule.override_classification || sender_rule.default_classification;
      const requires_reply = sender_rule.override_requires_reply ?? sender_rule.default_requires_reply;
      
      // Map classification to decision bucket
      const bucket = requires_reply ? 'quick_win' : 'auto_handled';
      const why_this_needs_you = requires_reply 
        ? 'Matched sender rule - review needed' 
        : 'Matched sender rule - no action needed';
      
      console.log('Applying sender rule:', classification, 'bucket:', bucket);
      
      return new Response(JSON.stringify({
        decision: {
          bucket,
          why_this_needs_you,
          confidence: 0.99
        },
        risk: {
          level: 'none',
          cognitive_load: 'low'
        },
        classification: {
          category: classification,
          requires_reply: requires_reply
        },
        priority: {
          urgency: requires_reply ? 'medium' : 'low',
          urgency_reason: 'Classified by sender rule'
        },
        sentiment: {
          tone: 'neutral'
        },
        entities: {},
        summary: {
          one_line: `Email from ${email.from_email} - classified by sender rule`,
          key_points: ['Matched sender rule pattern']
        },
        reasoning: `Classified by sender rule as ${classification}`,
        applied_rule: true,
        processing_time_ms: Date.now() - startTime
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Build context-aware prompt
    let contextualPrompt = '';
    if (business_context) {
      if (business_context.is_hiring) {
        contextualPrompt += '\n\nCONTEXT: The business is currently hiring. Job applications should go to WAIT bucket unless urgent.';
      }
      if (business_context.active_dispute) {
        contextualPrompt += '\n\nCONTEXT: There is an active payment dispute. Payment processor emails = ACT_NOW with financial risk.';
      }
      if (business_context.vip_domains && business_context.vip_domains.length > 0) {
        const senderDomain = email.from_email.split('@')[1]?.toLowerCase();
        if (business_context.vip_domains.includes(senderDomain)) {
          contextualPrompt += '\n\nCONTEXT: This sender is from a VIP customer domain. Treat as ACT_NOW with retention risk.';
        }
      }
    }

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { prompt: triagePrompt, model: triageModel } = await getTriagePrompt(supabase, workspace_id);

    const emailContent = `
FROM: ${email.from_name} <${email.from_email}>
TO: ${email.to_email || 'Unknown'}
SUBJECT: ${email.subject}

BODY:
${email.body.substring(0, 5000)}
`;

    console.log('Calling Claude with decision router tool...');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: triageModel,
        max_tokens: 1024,
        system: triagePrompt + contextualPrompt,
        tools: [DECISION_ROUTER_TOOL],
        tool_choice: { type: 'tool', name: 'route_email' },
        messages: [
          {
            role: 'user',
            content: `Route this email to the appropriate decision bucket:\n\n${emailContent}`
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', response.status, errorText);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('Claude decision response received');

    const toolUse = result.content?.find((c: any) => c.type === 'tool_use');
    if (!toolUse || toolUse.name !== 'route_email') {
      console.error('No valid tool use in response');
      // Safe default: ACT_NOW when uncertain
      return new Response(JSON.stringify({
        decision: {
          bucket: 'act_now',
          why_this_needs_you: 'Could not auto-classify - needs review',
          confidence: 0.3
        },
        risk: {
          level: 'none',
          cognitive_load: 'high'
        },
        classification: {
          category: 'customer_inquiry',
          requires_reply: true
        },
        priority: {
          urgency: 'medium',
          urgency_reason: 'Could not classify - defaulting to medium'
        },
        sentiment: {
          tone: 'neutral'
        },
        entities: {},
        summary: {
          one_line: email.subject,
          key_points: []
        },
        reasoning: 'Classification failed - requires manual review',
        needs_human_review: true,
        processing_time_ms: Date.now() - startTime
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const routeResult = toolUse.input;
    const processingTime = Date.now() - startTime;

    console.log('Decision routing complete:', {
      bucket: routeResult.decision.bucket,
      why_this_needs_you: routeResult.decision.why_this_needs_you,
      confidence: routeResult.decision.confidence,
      risk_level: routeResult.risk.level,
      category: routeResult.classification.category,
      processing_time_ms: processingTime
    });

    // Apply confidence-based overrides
    const confidence = routeResult.decision.confidence;
    
    // Low confidence = force to ACT_NOW for safety
    if (confidence < 0.7 && routeResult.decision.bucket !== 'act_now') {
      console.log('Low confidence override: moving to act_now');
      routeResult.decision.bucket = 'act_now';
      routeResult.decision.why_this_needs_you = `Low confidence (${Math.round(confidence * 100)}%) - needs review`;
      routeResult.risk.cognitive_load = 'high';
    }
    
    // Very high confidence auto_handled can stay
    // Medium confidence quick_win should have suggested reply
    if (routeResult.decision.bucket === 'quick_win' && !routeResult.suggested_reply) {
      routeResult.decision.bucket = 'act_now';
      routeResult.decision.why_this_needs_you = 'No quick reply available - needs attention';
    }

    return new Response(JSON.stringify({
      ...routeResult,
      processing_time_ms: processingTime
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in email-triage-agent:', error);
    
    // Safe default on error: ACT_NOW
    return new Response(JSON.stringify({
      decision: {
        bucket: 'act_now',
        why_this_needs_you: 'System error - needs manual review',
        confidence: 0
      },
      risk: {
        level: 'none',
        cognitive_load: 'high'
      },
      classification: {
        category: 'customer_inquiry',
        requires_reply: true
      },
      priority: {
        urgency: 'high',
        urgency_reason: 'Classification error - requires immediate review'
      },
      sentiment: {
        tone: 'neutral'
      },
      entities: {},
      summary: {
        one_line: 'Classification failed',
        key_points: []
      },
      reasoning: `Error during classification: ${errorMessage}`,
      needs_human_review: true,
      error: errorMessage,
      processing_time_ms: Date.now()
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
