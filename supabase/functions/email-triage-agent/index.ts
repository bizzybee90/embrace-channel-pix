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
- Payment confirmations / receipts FROM payment processors (Stripe, PayPal, Square)
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
- Receipts from payment processors (→ AUTO_HANDLED)
- Notifications (→ AUTO_HANDLED)
- Newsletters (→ AUTO_HANDLED)
- FYI emails with no action (→ AUTO_HANDLED)
- "Might be useful later" (→ AUTO_HANDLED)

## "Why This Needs You" - ALWAYS Explain (Required!)

Every email MUST have a clear, human-readable explanation of why it landed in its bucket:
- ACT_NOW: "Customer upset about [specific issue]" or "Payment at risk - [reason]"
- QUICK_WIN: "Simple confirmation needed" or "Yes/no reply will resolve this"
- AUTO_HANDLED: "Stripe payment receipt" or "Marketing newsletter from [sender]"
- WAIT: "Follow up needed on [date] for [specific reason]"

This field must NEVER be empty. It must be actionable and specific.

## CLASSIFICATION RULES - READ CAREFULLY!

### INVOICE CLASSIFICATION (CRITICAL - Common Mistakes!)

⚠️ INVOICES ARE NOT SPAM! An invoice from a supplier/vendor is NEVER spam.

**supplier_invoice** - Invoices/bills TO the business that may need payment:
- Bills from suppliers, vendors, utility companies
- Invoices for services rendered (water delivery, equipment, supplies)
- Any email with invoice amounts, payment terms, due dates
- Example: "Invoice #1234 from Spotless Water - £25.00 due"
- Example: "Water delivery invoice - Oliver Pinnock"
→ Bucket: QUICK_WIN (needs review for payment)

**receipt_confirmation** - Confirmations of payments ALREADY made:
- Payment processor receipts (Stripe, PayPal, Square, GoCardless)
- "Your payment was successful" notifications
- "Payment received" confirmations
- Bank transfer confirmations
→ Bucket: AUTO_HANDLED (no action needed)

**spam_phishing** - Only use for ACTUAL spam:
- Nigerian prince scams
- "You've won a prize" emails
- Phishing attempts with suspicious links
- Unknown senders with no business context
- NEVER for legitimate invoices or business communications
→ Bucket: AUTO_HANDLED

### CUSTOMER INQUIRY CLASSIFICATION (Be Specific!)

Instead of generic "customer_inquiry", prefer these specific categories:

**customer_inquiry** - Use for:
- Questions about services, pricing, availability
- Booking or scheduling requests
- Quote requests
- General "Can you help with X?" questions
→ Be specific in why_this_needs_you: "Quote request for [service]" not just "inquiry"

**customer_complaint** - Use for:
- Dissatisfaction with service
- Something went wrong
- Request for refund or credit
- Negative sentiment detected

**customer_feedback** - Use for:
- Positive reviews or praise
- "Thank you" emails
- Suggestions for improvement (non-complaints)

**payment_confirmation** - Use for:
- Customer saying "I've paid"
- "Payment sent" from customer
- Balance inquiries from customers
→ Different from receipt_confirmation (which is from payment processors)

### MARKETING vs LEGITIMATE BUSINESS

**marketing_newsletter** - Only for:
- Mass marketing emails
- Promotional offers unrelated to your business operations
- "10% off" campaigns
- Blog digests, industry news

**NOT marketing if:**
- It's from a supplier you use
- It contains invoice or payment information
- It's from a customer

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

4. Consider the sender: known customer vs new lead vs supplier vs automated system

5. MISDIRECTED EMAILS: When an email is clearly intended for a different person or company:
   - Use "misdirected" category
   - Set requires_reply = TRUE (polite "wrong email" response needed)
   - Set bucket = "quick_win" (simple template reply)
   - Examples: Debt collection for unknown person, invoices for services you don't provide, legal notices addressed to wrong company
   - This is NOT the same as spam/phishing - misdirected emails are legitimate but sent to the wrong recipient`;

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
              "automated_notification", "receipt_confirmation", "payment_confirmation", "marketing_newsletter",
              "spam_phishing", "recruitment_hr", "internal_system", "informational_only",
              "booking_request", "quote_request", "cancellation_request", "reschedule_request",
              "misdirected"
            ],
            description: "The classification category. Be specific: use booking_request, quote_request, cancellation_request, reschedule_request instead of generic customer_inquiry when applicable. Use 'misdirected' for emails clearly intended for a different person or company."
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
  sender_behaviour?: {
    reply_rate?: number;
    ignored_rate?: number;
    vip_score?: number;
    suggested_bucket?: string;
  };
  pre_triage_hints?: {
    likely_bucket?: string;
    confidence_boost?: number;
  };
}

// Valid buckets and classifications for strict validation
const VALID_BUCKETS = ['act_now', 'quick_win', 'auto_handled', 'wait'] as const;
const VALID_CLASSIFICATIONS = [
  'customer_inquiry', 'customer_complaint', 'customer_feedback',
  'lead_new', 'lead_followup', 'supplier_invoice', 'supplier_urgent', 'partner_request',
  'automated_notification', 'receipt_confirmation', 'payment_confirmation', 'marketing_newsletter',
  'spam_phishing', 'recruitment_hr', 'internal_system', 'informational_only',
  'booking_request', 'quote_request', 'cancellation_request', 'reschedule_request',
  'misdirected'
] as const;
const VALID_RISK_LEVELS = ['financial', 'retention', 'reputation', 'legal', 'none'] as const;
const VALID_URGENCIES = ['high', 'medium', 'low'] as const;
const VALID_SENTIMENTS = ['angry', 'frustrated', 'concerned', 'neutral', 'positive'] as const;

// Strict type guard and normalizer for model output
function normalizeTriageOutput(raw: any): any {
  // Ensure we have a valid object
  if (!raw || typeof raw !== 'object') {
    console.error('[triage] Invalid raw output - not an object:', typeof raw);
    return null;
  }

  // Normalize decision bucket with strict validation
  const rawBucket = raw.decision?.bucket;
  let bucket: string = 'quick_win'; // safe default
  if (typeof rawBucket === 'string' && VALID_BUCKETS.includes(rawBucket as any)) {
    bucket = rawBucket;
  } else {
    console.warn(`[triage] Invalid bucket "${rawBucket}", defaulting to quick_win`);
  }

  // Normalize classification category
  const rawCategory = raw.classification?.category;
  let category: string = 'customer_inquiry'; // safe default
  if (typeof rawCategory === 'string' && VALID_CLASSIFICATIONS.includes(rawCategory as any)) {
    category = rawCategory;
  } else {
    console.warn(`[triage] Invalid classification "${rawCategory}", defaulting to customer_inquiry`);
  }

  // Normalize confidence
  let confidence = 0.5;
  if (typeof raw.decision?.confidence === 'number') {
    confidence = Math.max(0, Math.min(1, raw.decision.confidence));
  }

  // Normalize requires_reply
  let requiresReply = true;
  if (typeof raw.classification?.requires_reply === 'boolean') {
    requiresReply = raw.classification.requires_reply;
  }

  // Normalize risk level
  const rawRiskLevel = raw.risk?.level;
  let riskLevel = 'none';
  if (typeof rawRiskLevel === 'string' && VALID_RISK_LEVELS.includes(rawRiskLevel as any)) {
    riskLevel = rawRiskLevel;
  }

  // Normalize cognitive load
  const cognitiveLoad = raw.risk?.cognitive_load === 'high' ? 'high' : 'low';

  // Normalize urgency
  const rawUrgency = raw.priority?.urgency;
  let urgency = 'medium';
  if (typeof rawUrgency === 'string' && VALID_URGENCIES.includes(rawUrgency as any)) {
    urgency = rawUrgency;
  }

  // Normalize sentiment
  const rawSentiment = raw.sentiment?.tone;
  let sentiment = 'neutral';
  if (typeof rawSentiment === 'string' && VALID_SENTIMENTS.includes(rawSentiment as any)) {
    sentiment = rawSentiment;
  }

  // Normalize why_this_needs_you
  let whyThisNeedsYou = raw.decision?.why_this_needs_you;
  if (typeof whyThisNeedsYou !== 'string' || whyThisNeedsYou.length < 5) {
    whyThisNeedsYou = `${category.replace(/_/g, ' ')} - review needed`;
  }

  // Normalize summary
  let summary = { one_line: '', key_points: [] as string[] };
  if (raw.summary && typeof raw.summary === 'object') {
    summary.one_line = typeof raw.summary.one_line === 'string' ? raw.summary.one_line : '';
    summary.key_points = Array.isArray(raw.summary.key_points) 
      ? raw.summary.key_points.filter((kp: any) => typeof kp === 'string').slice(0, 3)
      : [];
  }

  // Normalize entities
  const entities = raw.entities && typeof raw.entities === 'object' ? raw.entities : {};

  // Return normalized result
  return {
    decision: {
      bucket,
      why_this_needs_you: whyThisNeedsYou,
      confidence,
    },
    risk: {
      level: riskLevel,
      cognitive_load: cognitiveLoad,
    },
    classification: {
      category,
      requires_reply: requiresReply,
    },
    priority: {
      urgency,
      urgency_reason: typeof raw.priority?.urgency_reason === 'string' ? raw.priority.urgency_reason : '',
    },
    sentiment: {
      tone: sentiment,
    },
    entities,
    summary,
    suggested_reply: typeof raw.suggested_reply === 'string' ? raw.suggested_reply : '',
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
  };
}

// LLM Output Validator - catches invalid/conflicting outputs
function validateTriageResult(result: any): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  if (!result?.decision?.bucket) {
    issues.push('Missing decision bucket');
    return { valid: false, issues };
  }

  // Rule 1: AUTO_HANDLED cannot require reply
  if (result.decision.bucket === 'auto_handled' && result.classification?.requires_reply) {
    issues.push('AUTO_HANDLED + requires_reply conflict');
  }
  
  // Rule 2: why_this_needs_you must be specific (not generic)
  const genericPhrases = ['needs a response', 'requires attention', 'action needed', 'needs human'];
  const why = result.decision.why_this_needs_you?.toLowerCase() || '';
  if (genericPhrases.some(p => why.includes(p)) && why.length < 30) {
    issues.push('Generic why_this_needs_you');
  }
  
  // Rule 3: Empty why_this_needs_you is invalid
  if (!result.decision.why_this_needs_you || result.decision.why_this_needs_you.length < 5) {
    issues.push('Empty or too short why_this_needs_you');
  }
  
  // Rule 4: High-risk categories cannot have no risk
  const highRiskCategories = ['supplier_invoice', 'customer_complaint', 'supplier_urgent'];
  if (highRiskCategories.includes(result.classification?.category) && result.risk?.level === 'none') {
    issues.push('High-risk category with no risk assessment');
  }

  // Rule 5: WAIT bucket should be rare - flag if confidence is high
  if (result.decision.bucket === 'wait' && result.decision.confidence > 0.9) {
    issues.push('WAIT with very high confidence - likely should be AUTO_HANDLED');
  }

  // Rule 6: Misdirected emails should be quick_win with requires_reply
  if (result.classification?.category === 'misdirected') {
    if (result.decision.bucket !== 'quick_win') {
      issues.push('Misdirected should be quick_win');
    }
    if (!result.classification?.requires_reply) {
      issues.push('Misdirected should require reply');
    }
  }

  // Rule 7: supplier_invoice should not be spam_phishing
  // This is a guardrail against LLM misclassification
  
  return { valid: issues.length === 0, issues };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const MAX_RETRIES = 1;

  try {
    const request: TriageRequest = await req.json();
    const { email, workspace_id, business_context, sender_rule, sender_behaviour, pre_triage_hints } = request;

    console.log('Decision router processing email from:', email.from_email, 'subject:', email.subject);

    // Fetch business context from database if not provided
    let enrichedBusinessContext: any = business_context || {};
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    if (workspace_id) {
      const { data: dbContext } = await supabaseClient
        .from('business_context')
        .select('*')
        .eq('workspace_id', workspace_id)
        .single();

      if (dbContext) {
        const customFlags = dbContext.custom_flags as Record<string, any> || {};
        enrichedBusinessContext = {
          ...enrichedBusinessContext,
          is_hiring: dbContext.is_hiring || enrichedBusinessContext.is_hiring,
          active_dispute: dbContext.active_stripe_case || enrichedBusinessContext.active_dispute,
          company_name: customFlags.company_name || '',
          email_domain: customFlags.email_domain || '',
          receives_invoices: customFlags.receives_invoices ?? true,
          business_type: customFlags.business_type || '',
        };
        console.log('Loaded business context:', enrichedBusinessContext);
      }
    }

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

    // Build context-aware prompt with company identity
    let contextualPrompt = '';
    
    // Add company identity if available
    if (enrichedBusinessContext.company_name || enrichedBusinessContext.email_domain) {
      contextualPrompt += `\n\nCOMPANY IDENTITY:
- Your company name: ${enrichedBusinessContext.company_name || 'Unknown'}
- Your email domain: ${enrichedBusinessContext.email_domain || 'Unknown'}
- Business type: ${enrichedBusinessContext.business_type || 'Service business'}
- You ${enrichedBusinessContext.receives_invoices ? 'RECEIVE' : 'do NOT receive'} invoices from suppliers

INVOICE CLASSIFICATION RULES (IMPORTANT):
- If an email is an invoice/bill AND it was sent to your email/domain (${enrichedBusinessContext.email_domain || 'your domain'}), assume it is a legitimate invoice TO you unless the invoice explicitly shows a different recipient.
- supplier_invoice = invoices/bills that you (the business) may need to pay (even if the supplier name is different from your company name).
- receipt_confirmation = confirmations/receipts for payments already made or invoices you already SENT to customers.
- misdirected = ONLY when the invoice explicitly names a different recipient company/person in "Bill to / Customer / Account" AND does NOT mention ${enrichedBusinessContext.company_name || 'your company'} anywhere.
- If unsure between supplier_invoice and misdirected, prefer supplier_invoice and set bucket=quick_win (so the owner can quickly verify).`;
    }

    if (enrichedBusinessContext.is_hiring) {
      contextualPrompt += '\n\nCONTEXT: The business is currently hiring. Job applications should go to WAIT bucket unless urgent.';
    }
    if (enrichedBusinessContext.active_dispute) {
      contextualPrompt += '\n\nCONTEXT: There is an active payment dispute. Payment processor emails = ACT_NOW with financial risk.';
    }
    if (enrichedBusinessContext.vip_domains && enrichedBusinessContext.vip_domains.length > 0) {
      const senderDomain = email.from_email.split('@')[1]?.toLowerCase();
      if (enrichedBusinessContext.vip_domains.includes(senderDomain)) {
        contextualPrompt += '\n\nCONTEXT: This sender is from a VIP customer domain. Treat as ACT_NOW with retention risk.';
      }
    }

    // Add sender behaviour priors for personalization
    if (sender_behaviour) {
      const { reply_rate, ignored_rate, vip_score, suggested_bucket } = sender_behaviour;
      contextualPrompt += '\n\nSENDER HISTORY:';
      if (reply_rate !== undefined) {
        contextualPrompt += `\n- This sender's emails are replied to ${Math.round((reply_rate || 0) * 100)}% of the time.`;
        if (reply_rate > 0.8) {
          contextualPrompt += ' (High engagement - consider QUICK_WIN or ACT_NOW)';
        } else if (reply_rate < 0.2) {
          contextualPrompt += ' (Usually ignored - consider AUTO_HANDLED)';
        }
      }
      if (vip_score !== undefined && vip_score > 50) {
        contextualPrompt += `\n- VIP Score: ${vip_score}/100 - treat as important.`;
      }
      if (suggested_bucket) {
        contextualPrompt += `\n- Historical suggestion: ${suggested_bucket}`;
      }
    }

    // Add pre-triage hints if available
    if (pre_triage_hints?.likely_bucket) {
      contextualPrompt += `\n\nPRE-TRIAGE HINT: Pattern matching suggests "${pre_triage_hints.likely_bucket}" bucket. Validate with content analysis.`;
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

    // STRICT NORMALIZATION: Ensure valid output structure before any processing
    let routeResult = normalizeTriageOutput(toolUse.input);
    
    if (!routeResult) {
      console.error('[triage] Failed to normalize output, using safe default');
      return new Response(JSON.stringify({
        decision: {
          bucket: 'quick_win',
          why_this_needs_you: 'Could not parse model output - needs review',
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
          urgency_reason: 'Parse failed - defaulting to medium'
        },
        sentiment: {
          tone: 'neutral'
        },
        entities: {},
        summary: {
          one_line: email.subject,
          key_points: []
        },
        reasoning: 'Normalization failed - requires manual review',
        needs_human_review: true,
        processing_time_ms: Date.now() - startTime
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const processingTime = Date.now() - startTime;

    console.log('Normalized decision routing:', {
      bucket: routeResult.decision.bucket,
      why_this_needs_you: routeResult.decision.why_this_needs_you,
      confidence: routeResult.decision.confidence,
      classification: routeResult.classification.category,
    });

    // ============================================================
    // VALIDATION + AUTO-CORRECTION: Fix conflicting outputs
    // ============================================================
    const validation = validateTriageResult(routeResult);
    
    if (!validation.valid) {
      console.log('[triage] Validation issues:', validation.issues);
      
      // Auto-correct: AUTO_HANDLED + requires_reply conflict
      if (validation.issues.includes('AUTO_HANDLED + requires_reply conflict')) {
        routeResult.decision.bucket = 'quick_win';
        routeResult.decision.why_this_needs_you = routeResult.decision.why_this_needs_you || 'Needs simple reply';
        console.log('[triage] Auto-corrected: AUTO_HANDLED → QUICK_WIN');
      }
      
      // Auto-correct: Misdirected should be quick_win with requires_reply
      if (validation.issues.includes('Misdirected should be quick_win')) {
        routeResult.decision.bucket = 'quick_win';
        console.log('[triage] Auto-corrected: misdirected → quick_win bucket');
      }
      if (validation.issues.includes('Misdirected should require reply')) {
        routeResult.classification.requires_reply = true;
        console.log('[triage] Auto-corrected: misdirected → requires_reply=true');
      }
      
      // Auto-correct: Generic/empty why_this_needs_you
      if (validation.issues.includes('Generic why_this_needs_you') || validation.issues.includes('Empty or too short why_this_needs_you')) {
        const bucket = routeResult.decision.bucket;
        const category = routeResult.classification.category;
        
        const betterWhys: Record<string, string> = {
          'act_now': `Urgent ${category.replace(/_/g, ' ')} - review needed`,
          'quick_win': `Quick ${category.replace(/_/g, ' ')} - template reply likely`,
          'auto_handled': `Automated ${category.replace(/_/g, ' ')} - no action needed`,
          'wait': `Deferred ${category.replace(/_/g, ' ')} - check back later`,
        };
        
        routeResult.decision.why_this_needs_you = betterWhys[bucket] || `${category.replace(/_/g, ' ')} - review`;
        console.log('[triage] Auto-corrected why_this_needs_you:', routeResult.decision.why_this_needs_you);
      }
      
      // Auto-correct: High confidence WAIT should be AUTO_HANDLED
      if (validation.issues.includes('WAIT with very high confidence - likely should be AUTO_HANDLED')) {
        if (!routeResult.classification.requires_reply) {
          routeResult.decision.bucket = 'auto_handled';
          routeResult.decision.why_this_needs_you = 'No action required - informational only';
          console.log('[triage] Auto-corrected: WAIT → AUTO_HANDLED');
        }
      }
    }

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

    // Determine if this needs review (for reconciliation flow)
    const senderDomain = request.email.from_email.split('@')[1]?.toLowerCase();
    const needsReview = 
      // Low-medium confidence (< 85%)
      (routeResult.decision.confidence < 0.85 && routeResult.decision.bucket !== 'auto_handled') ||
      // First-time sender domain (no prior history)
      (!sender_behaviour && !sender_rule) ||
      // Low confidence even for auto_handled
      (routeResult.decision.bucket === 'auto_handled' && routeResult.decision.confidence < 0.9);

    console.log('Final decision:', {
      bucket: routeResult.decision.bucket,
      why_this_needs_you: routeResult.decision.why_this_needs_you,
      confidence: routeResult.decision.confidence,
      risk_level: routeResult.risk?.level,
      category: routeResult.classification?.category,
      needs_review: needsReview,
      processing_time_ms: processingTime,
      validation_issues: validation.issues,
    });

    return new Response(JSON.stringify({
      ...routeResult,
      needs_review: needsReview,
      validation_issues: validation.issues.length > 0 ? validation.issues : undefined,
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
