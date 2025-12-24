import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// DETERMINISTIC GATEKEEPER - Skip LLM for known patterns
// ============================================================

const AUTO_DONE_DOMAINS = [
  // Payment processors (receipts)
  'stripe.com', 'gocardless.com', 'paypal.com', 'square.com',
  'payments.amazon.co.uk', 'pay.amazon.co.uk', 'amazon.co.uk',
  'xero.com', 'quickbooks.intuit.com', 'intuit.com',
  
  // Job boards
  'indeed.com', 'linkedin.com', 'reed.co.uk', 'totaljobs.com',
  'glassdoor.com', 'cv-library.co.uk', 'monster.com',
  
  // Social notifications
  'facebookmail.com', 'twitter.com', 'instagram.com', 'x.com',
  'notifications.google.com', 'youtube.com',
  
  // Newsletters/Marketing
  'substack.com', 'mailchimp.com', 'sendgrid.net', 'mailgun.com',
  'campaign-archive.com', 'list-manage.com',
  
  // Shipping
  'royalmail.com', 'dpd.co.uk', 'hermes.com', 'ups.com', 'fedex.com',
];

const AUTO_DONE_SENDER_PATTERNS = [
  /^noreply@/i,
  /^no-reply@/i,
  /^donotreply@/i,
  /^notifications@/i,
  /^mailer-daemon@/i,
  /^postmaster@/i,
  /^bounce@/i,
  /^automated@/i,
];

const AUTO_DONE_SUBJECT_PATTERNS = [
  /payment.*received/i,
  /payment.*successful/i,
  /your.*receipt/i,
  /transaction.*confirmed/i,
  /order.*confirmation/i,
  /shipping.*notification/i,
  /delivery.*update/i,
  /someone.*applied.*position/i,
  /new.*application.*received/i,
  /weekly.*digest/i,
  /newsletter/i,
];

// Patterns that should escalate to REVIEW even if domain matches
const ESCALATE_SUBJECT_PATTERNS = [
  /payment.*failed/i,
  /transaction.*declined/i,
  /action.*required/i,
  /urgent/i,
  /error/i,
  /problem.*with/i,
  /suspended/i,
  /cancelled/i,
];

// ============================================================
// DECISION ROUTER PROMPT - Chief of Staff Architecture
// ============================================================

const DEFAULT_TRIAGE_PROMPT = `You are the AI Chief of Staff for a service business.
Your goal is **Aggressive Inbox Zero**. You don't just label emails - you make executive decisions.

## THE DECISION LANES

You route emails into LANES (where user sees it) with FLAGS (how to handle it).

### 🔴 TO_REPLY (Urgent) - < 10%
Customer needs a response AND it's time-sensitive:
- Customer is upset, frustrated, or complaining
- Payment issue or financial risk  
- Service disruption or cancellation threat
- Time-sensitive request (today/tomorrow)
- Legal or reputation risk
- VIP domains (always prioritize)

### 🟡 TO_REPLY (Standard) - 20-30%
Customer needs a response, not urgent:
- Quote requests, booking inquiries
- Simple questions needing quick answers
- Scheduling/rescheduling requests
- Straightforward confirmations (template response works)

### 🔵 REVIEW - 10-20%
Needs human eyes but may not need reply:
- LOW CONFIDENCE (< 80%) - uncertain, let human decide
- First-time sender from unknown domain
- Supplier invoices (verify before paying)
- Edge cases requiring human judgment
- Ambiguous requests

### 🟢 DONE - 50-60%
No human attention needed:
- Receipts and payment confirmations (Stripe, PayPal, GoCardless)
- Automated notifications (shipping, system alerts)
- Marketing/newsletters
- Job applications (when not hiring)
- Spam and phishing
- Social media notifications

## HARD RULES (Override Everything)

1. **Receipt vs Invoice Rule**
   - Receipt (money already paid to you) → DONE, reply_required=false
   - Invoice (money YOU owe to supplier) → REVIEW, reply_required=false
   - Invoice dispute → TO_REPLY, urgent=true

2. **THE UNCERTAINTY RULE (CRITICAL!)**
   - Low confidence (< 80%) → lane="review", NOT urgent
   - Uncertainty ≠ Urgency. These are SEPARATE concepts.
   - If you're unsure, put it in REVIEW so the user can teach you.
   - NEVER route low confidence to urgent just because you're uncertain.

3. **The Reply Rule**
   - DONE lane MUST have reply_required=false
   - DONE lane MUST have suggested_reply=null (NEVER suggest replies for DONE)
   - If a reply is genuinely needed, it cannot be DONE

4. **Error/Failure Rule**
   - System notification with "failed/error/down" → REVIEW with urgent=true

## BATCH CLUSTERING (For Bulk Processing)

Assign batch_group for bulk actions:
- BATCH_RECEIPTS: Payment confirmations (Stripe, PayPal, GoCardless)
- BATCH_NEWSLETTERS: Marketing, Substack, webinars, industry news
- BATCH_JOB_APPS: Applications from job boards (Indeed, LinkedIn)
- BATCH_SPAM: Cold sales outreach, SEO offers, phishing
- null: Anything unique requiring individual focus

## EVIDENCE EXTRACTION

For every decision, you MUST cite evidence from the email:
- key_quote: The most important sentence that drove your decision
- intent: What the sender wants (in 5 words or less)

This grounds your decision and helps humans verify quickly.

## "Why This Needs You" - ALWAYS Explain

Every email MUST have a clear, human-readable explanation:
- TO_REPLY (urgent): "Customer upset about [specific issue]"
- TO_REPLY (standard): "Quote request for 3-bed house in Luton"
- REVIEW: "Low confidence (65%) - teach me"
- DONE: "Stripe payment receipt - no action needed"

This field must NEVER be empty. Be specific, not generic.`;

// ============================================================
// DECISION ROUTER TOOL SCHEMA - Lanes + Flags Architecture
// ============================================================

const DECISION_ROUTER_TOOL = {
  name: "route_email",
  description: "Route email to the appropriate lane with flags",
  input_schema: {
    type: "object",
    properties: {
      // New lane-based routing
      lane: {
        type: "string",
        enum: ["to_reply", "review", "done", "snoozed"],
        description: "The routing lane: to_reply (needs response), review (needs human eyes), done (no action), snoozed (explicit future date)"
      },
      flags: {
        type: "object",
        properties: {
          urgent: { type: "boolean", description: "Time-sensitive or angry customer (shows red indicator)" },
          reply_required: { type: "boolean", description: "A reply email is actually needed" },
          vip: { type: "boolean", description: "Sender is from VIP domain" },
          first_time_sender: { type: "boolean", description: "No prior history with this sender" },
          financial: { type: "boolean", description: "Involves money (invoice, payment, refund)" },
          risk_type: { 
            type: "string", 
            enum: ["churn", "complaint", "financial", "legal", "none"],
            description: "Type of risk if ignored"
          }
        },
        required: ["urgent", "reply_required"]
      },
      evidence: {
        type: "object",
        properties: {
          key_quote: { type: "string", description: "Most important sentence from email that drove decision" },
          intent: { type: "string", description: "What the sender wants in 5 words or less" }
        },
        required: ["key_quote", "intent"]
      },
      batch_group: {
        type: "string",
        enum: ["BATCH_RECEIPTS", "BATCH_NEWSLETTERS", "BATCH_JOB_APPS", "BATCH_SPAM"],
        description: "Group for bulk processing, or null for unique items"
      },
      
      // Legacy bucket (for backward compatibility)
      decision: {
        type: "object",
        properties: {
          bucket: {
            type: "string",
            enum: ["act_now", "quick_win", "auto_handled", "wait"],
            description: "Legacy bucket mapping"
          },
          why_this_needs_you: {
            type: "string",
            description: "Human-readable explanation in 15 words or less"
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
            enum: ["financial", "retention", "reputation", "legal", "none"]
          },
          cognitive_load: {
            type: "string",
            enum: ["high", "low"]
          }
        },
        required: ["level", "cognitive_load"]
      },
      classification: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: [
              "customer_inquiry", "customer_complaint", "customer_feedback",
              "lead_new", "lead_followup", "supplier_invoice", "supplier_urgent", "partner_request",
              "automated_notification", "receipt_confirmation", "payment_confirmation", "payment_promise", "marketing_newsletter",
              "spam_phishing", "recruitment_hr", "internal_system", "informational_only",
              "booking_request", "quote_request", "cancellation_request", "reschedule_request",
              "misdirected"
            ]
          },
          requires_reply: { type: "boolean" }
        },
        required: ["category", "requires_reply"]
      },
      priority: {
        type: "object",
        properties: {
          urgency: { type: "string", enum: ["high", "medium", "low"] },
          urgency_reason: { type: "string" }
        },
        required: ["urgency", "urgency_reason"]
      },
      sentiment: {
        type: "object",
        properties: {
          tone: { type: "string", enum: ["angry", "frustrated", "concerned", "neutral", "positive"] }
        },
        required: ["tone"]
      },
      entities: {
        type: "object",
        properties: {
          customer_name: { type: "string" },
          phone_number: { type: "string" },
          address: { type: "string" },
          date_mentioned: { type: "string" },
          order_id: { type: "string" },
          amount: { type: "string" },
          service_type: { type: "string" }
        }
      },
      summary: {
        type: "object",
        properties: {
          one_line: { type: "string", description: "One-line summary (max 100 chars)" },
          key_points: { type: "array", items: { type: "string" }, description: "Key points (max 3)" }
        },
        required: ["one_line", "key_points"]
      },
      suggested_reply: {
        type: "string",
        description: "ONLY for lane=to_reply: A suggested reply. MUST be null/empty for lane=done or lane=review."
      },
      reasoning: { type: "string" }
    },
    required: ["lane", "flags", "evidence", "decision", "risk", "classification", "priority", "sentiment", "summary", "reasoning"]
  }
};

// ============================================================
// TYPES
// ============================================================

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
    default_lane?: string;
    skip_llm?: boolean;
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

// Valid enums for strict validation
const VALID_LANES = ['to_reply', 'review', 'done', 'snoozed'] as const;
const VALID_BUCKETS = ['act_now', 'quick_win', 'auto_handled', 'wait'] as const;
const VALID_CLASSIFICATIONS = [
  'customer_inquiry', 'customer_complaint', 'customer_feedback',
  'lead_new', 'lead_followup', 'supplier_invoice', 'supplier_urgent', 'partner_request',
  'automated_notification', 'receipt_confirmation', 'payment_confirmation', 'payment_promise', 'marketing_newsletter',
  'spam_phishing', 'recruitment_hr', 'internal_system', 'informational_only',
  'booking_request', 'quote_request', 'cancellation_request', 'reschedule_request',
  'misdirected'
] as const;
const VALID_RISK_LEVELS = ['financial', 'retention', 'reputation', 'legal', 'none'] as const;
const VALID_BATCH_GROUPS = ['BATCH_RECEIPTS', 'BATCH_NEWSLETTERS', 'BATCH_JOB_APPS', 'BATCH_SPAM'] as const;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function extractEmailString(emailValue: unknown): string {
  if (typeof emailValue === 'string') return emailValue;
  if (emailValue && typeof emailValue === 'object') {
    const obj = emailValue as Record<string, unknown>;
    return String(obj.email || obj.address || obj.value || 'unknown@unknown.com');
  }
  return 'unknown@unknown.com';
}

function getSenderDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() || '';
}

// Map lanes to legacy buckets for backward compatibility
function laneToBucket(lane: string, urgent: boolean): string {
  switch (lane) {
    case 'to_reply': return urgent ? 'act_now' : 'quick_win';
    case 'review': return 'quick_win'; // Review shows in review queue
    case 'done': return 'auto_handled';
    case 'snoozed': return 'wait';
    default: return 'quick_win';
  }
}

// Map legacy buckets to lanes
function bucketToLane(bucket: string): { lane: string; urgent: boolean } {
  switch (bucket) {
    case 'act_now': return { lane: 'to_reply', urgent: true };
    case 'quick_win': return { lane: 'to_reply', urgent: false };
    case 'auto_handled': return { lane: 'done', urgent: false };
    case 'wait': return { lane: 'review', urgent: false };
    default: return { lane: 'review', urgent: false };
  }
}

// ============================================================
// DETERMINISTIC GATEKEEPER CHECK
// ============================================================

interface GatekeeperResult {
  skip_llm: boolean;
  lane: string;
  bucket: string;
  batch_group: string | null;
  classification: string;
  why: string;
  confidence: number;
}

function checkGatekeeper(fromEmail: string, subject: string): GatekeeperResult | null {
  const senderDomain = getSenderDomain(fromEmail);
  const fromLower = fromEmail.toLowerCase();
  
  // Check for escalation patterns first (override auto-done)
  if (ESCALATE_SUBJECT_PATTERNS.some(p => p.test(subject))) {
    console.log(`[gatekeeper] Escalation pattern matched in subject: ${subject}`);
    return {
      skip_llm: false, // Let LLM handle escalations
      lane: 'review',
      bucket: 'quick_win',
      batch_group: null,
      classification: 'automated_notification',
      why: 'System alert - may need attention',
      confidence: 0.7
    };
  }
  
  // Check auto-done domains
  if (AUTO_DONE_DOMAINS.includes(senderDomain)) {
    console.log(`[gatekeeper] Auto-done domain match: ${senderDomain}`);
    
    // Determine batch group based on domain
    let batchGroup = null;
    let classification = 'automated_notification';
    
    if (['stripe.com', 'gocardless.com', 'paypal.com', 'square.com'].includes(senderDomain)) {
      batchGroup = 'BATCH_RECEIPTS';
      classification = 'receipt_confirmation';
    } else if (['indeed.com', 'linkedin.com', 'reed.co.uk', 'totaljobs.com', 'glassdoor.com'].includes(senderDomain)) {
      batchGroup = 'BATCH_JOB_APPS';
      classification = 'recruitment_hr';
    } else if (['substack.com', 'mailchimp.com', 'sendgrid.net'].includes(senderDomain)) {
      batchGroup = 'BATCH_NEWSLETTERS';
      classification = 'marketing_newsletter';
    }
    
    return {
      skip_llm: true,
      lane: 'done',
      bucket: 'auto_handled',
      batch_group: batchGroup,
      classification,
      why: `Known ${senderDomain} notification - no action needed`,
      confidence: 0.99
    };
  }
  
  // Check auto-done sender patterns
  if (AUTO_DONE_SENDER_PATTERNS.some(p => p.test(fromLower))) {
    console.log(`[gatekeeper] Auto-done sender pattern match: ${fromEmail}`);
    return {
      skip_llm: true,
      lane: 'done',
      bucket: 'auto_handled',
      batch_group: null,
      classification: 'automated_notification',
      why: 'Automated sender - no action needed',
      confidence: 0.95
    };
  }
  
  // Check auto-done subject patterns
  if (AUTO_DONE_SUBJECT_PATTERNS.some(p => p.test(subject))) {
    console.log(`[gatekeeper] Auto-done subject pattern match: ${subject}`);
    
    let batchGroup = null;
    let classification = 'automated_notification';
    
    if (/receipt|payment.*received|transaction.*confirmed/i.test(subject)) {
      batchGroup = 'BATCH_RECEIPTS';
      classification = 'receipt_confirmation';
    } else if (/newsletter|digest/i.test(subject)) {
      batchGroup = 'BATCH_NEWSLETTERS';
      classification = 'marketing_newsletter';
    } else if (/applied|application/i.test(subject)) {
      batchGroup = 'BATCH_JOB_APPS';
      classification = 'recruitment_hr';
    }
    
    return {
      skip_llm: true,
      lane: 'done',
      bucket: 'auto_handled',
      batch_group: batchGroup,
      classification,
      why: 'Automated notification pattern - no action needed',
      confidence: 0.92
    };
  }
  
  return null; // No gatekeeper match, proceed to LLM
}

// ============================================================
// NORMALIZE AND VALIDATE LLM OUTPUT
// ============================================================

function normalizeTriageOutput(raw: any): any {
  if (!raw || typeof raw !== 'object') {
    console.error('[triage] Invalid raw output - not an object');
    return null;
  }

  // Normalize lane (new)
  let lane = 'review';
  if (typeof raw.lane === 'string' && VALID_LANES.includes(raw.lane as any)) {
    lane = raw.lane;
  } else if (raw.decision?.bucket) {
    // Derive from legacy bucket
    const mapped = bucketToLane(raw.decision.bucket);
    lane = mapped.lane;
  }

  // Normalize flags (new)
  const flags = {
    urgent: raw.flags?.urgent === true || raw.decision?.bucket === 'act_now',
    reply_required: raw.flags?.reply_required ?? raw.classification?.requires_reply ?? true,
    vip: raw.flags?.vip === true,
    first_time_sender: raw.flags?.first_time_sender === true,
    financial: raw.flags?.financial === true,
    risk_type: raw.flags?.risk_type || raw.risk?.level || 'none',
  };

  // Normalize evidence (new)
  const evidence = {
    key_quote: typeof raw.evidence?.key_quote === 'string' ? raw.evidence.key_quote : '',
    intent: typeof raw.evidence?.intent === 'string' ? raw.evidence.intent : '',
  };

  // Normalize batch_group (new)
  let batchGroup = null;
  if (typeof raw.batch_group === 'string' && VALID_BATCH_GROUPS.includes(raw.batch_group as any)) {
    batchGroup = raw.batch_group;
  }

  // Normalize legacy bucket
  let bucket = 'quick_win';
  if (typeof raw.decision?.bucket === 'string' && VALID_BUCKETS.includes(raw.decision.bucket as any)) {
    bucket = raw.decision.bucket;
  } else {
    // Derive from lane
    bucket = laneToBucket(lane, flags.urgent);
  }

  // Normalize classification
  let category = 'customer_inquiry';
  if (typeof raw.classification?.category === 'string' && VALID_CLASSIFICATIONS.includes(raw.classification.category as any)) {
    category = raw.classification.category;
  }

  // Normalize confidence
  let confidence = 0.5;
  if (typeof raw.decision?.confidence === 'number') {
    confidence = Math.max(0, Math.min(1, raw.decision.confidence));
  }

  // Normalize requires_reply
  let requiresReply = flags.reply_required;
  if (typeof raw.classification?.requires_reply === 'boolean') {
    requiresReply = raw.classification.requires_reply;
  }

  // Normalize risk level
  let riskLevel = 'none';
  if (typeof raw.risk?.level === 'string' && VALID_RISK_LEVELS.includes(raw.risk.level as any)) {
    riskLevel = raw.risk.level;
  }

  const cognitiveLoad = raw.risk?.cognitive_load === 'high' ? 'high' : 'low';

  // Normalize urgency
  const validUrgencies = ['high', 'medium', 'low'];
  let urgency = 'medium';
  if (typeof raw.priority?.urgency === 'string' && validUrgencies.includes(raw.priority.urgency)) {
    urgency = raw.priority.urgency;
  }

  // Normalize sentiment
  const validSentiments = ['angry', 'frustrated', 'concerned', 'neutral', 'positive'];
  let sentiment = 'neutral';
  if (typeof raw.sentiment?.tone === 'string' && validSentiments.includes(raw.sentiment.tone)) {
    sentiment = raw.sentiment.tone;
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

  const entities = raw.entities && typeof raw.entities === 'object' ? raw.entities : {};

  return {
    lane,
    flags,
    evidence,
    batch_group: batchGroup,
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

function validateTriageResult(result: any): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  if (!result?.lane) {
    issues.push('Missing lane');
  }

  // Rule 1: DONE lane cannot require reply
  if (result.lane === 'done' && result.flags?.reply_required) {
    issues.push('DONE + reply_required conflict');
  }

  // Rule 2: DONE lane cannot have suggested_reply
  if (result.lane === 'done' && result.suggested_reply && result.suggested_reply.length > 0) {
    issues.push('DONE + suggested_reply conflict');
  }

  // Rule 3: AUTO_HANDLED cannot require reply (legacy)
  if (result.decision?.bucket === 'auto_handled' && result.classification?.requires_reply) {
    issues.push('AUTO_HANDLED + requires_reply conflict');
  }

  // Rule 4: why_this_needs_you must be specific
  const genericPhrases = ['needs a response', 'requires attention', 'action needed', 'needs human'];
  const why = result.decision?.why_this_needs_you?.toLowerCase() || '';
  if (genericPhrases.some(p => why.includes(p)) && why.length < 30) {
    issues.push('Generic why_this_needs_you');
  }

  // Rule 5: Empty why_this_needs_you is invalid
  if (!result.decision?.why_this_needs_you || result.decision.why_this_needs_you.length < 5) {
    issues.push('Empty or too short why_this_needs_you');
  }

  // Rule 6: Misdirected should be to_reply with reply_required
  if (result.classification?.category === 'misdirected') {
    if (result.lane !== 'to_reply') {
      issues.push('Misdirected should be to_reply');
    }
    if (!result.flags?.reply_required) {
      issues.push('Misdirected should require reply');
    }
  }

  return { valid: issues.length === 0, issues };
}

// ============================================================
// PROMPT LOADING
// ============================================================

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
        console.log('[triage] Using workspace-specific prompt');
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
      console.log('[triage] Using global default prompt');
      return { prompt: globalPrompt.prompt, model: globalPrompt.model || 'claude-3-5-haiku-20241022' };
    }
  } catch (error) {
    console.error('[triage] Error fetching prompt:', error);
  }

  console.log('[triage] Using hardcoded fallback prompt');
  return { prompt: DEFAULT_TRIAGE_PROMPT, model: 'claude-3-5-haiku-20241022' };
}

// ============================================================
// BUSINESS CONTEXT INJECTION
// ============================================================

async function buildBusinessContext(supabase: any, workspaceId: string, existingContext: any): Promise<string> {
  let contextPrompt = '';
  
  try {
    // Fetch workspace settings
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('business_type, core_services, vip_domains, hiring_mode, name')
      .eq('id', workspaceId)
      .single();
    
    if (workspace) {
      contextPrompt += `\n\n## BUSINESS CONTEXT (Injected)`;
      if (workspace.name) contextPrompt += `\nBusiness: ${workspace.name}`;
      if (workspace.business_type) contextPrompt += `\nType: ${workspace.business_type}`;
      if (workspace.core_services?.length) contextPrompt += `\nServices: ${workspace.core_services.join(', ')}`;
      if (workspace.hiring_mode) contextPrompt += `\n⚠️ Currently hiring - job applications → REVIEW`;
      if (workspace.vip_domains?.length) contextPrompt += `\nVIP Domains: ${workspace.vip_domains.join(', ')}`;
    }
    
    // Fetch business facts for additional context
    const { data: facts } = await supabase
      .from('business_facts')
      .select('category, fact_key, fact_value')
      .eq('workspace_id', workspaceId)
      .limit(20);
    
    if (facts?.length) {
      const services = facts.filter((f: any) => f.category === 'services').map((f: any) => f.fact_value);
      const coverage = facts.filter((f: any) => f.category === 'coverage').map((f: any) => f.fact_value);
      
      if (services.length) contextPrompt += `\nOffered services: ${services.join(', ')}`;
      if (coverage.length) contextPrompt += `\nService areas: ${coverage.join(', ')}`;
    }
    
    // Add existing context overrides
    if (existingContext?.is_hiring) {
      contextPrompt += '\n⚠️ Currently hiring - job applications may need attention';
    }
    if (existingContext?.active_dispute) {
      contextPrompt += '\n⚠️ Active payment dispute - payment processor emails = urgent';
    }
    
  } catch (error) {
    console.error('[triage] Error building business context:', error);
  }
  
  return contextPrompt;
}

// ============================================================
// MAIN HANDLER
// ============================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const request: TriageRequest = await req.json();
    const { email, workspace_id, business_context, sender_rule, sender_behaviour, pre_triage_hints } = request;

    const fromEmailString = extractEmailString(email.from_email);
    const senderDomain = getSenderDomain(fromEmailString);

    console.log(`[triage] Processing: ${fromEmailString} | Subject: ${email.subject}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ============================================================
    // STEP 1: Check sender rule (deterministic override)
    // ============================================================
    if (sender_rule?.skip_llm) {
      const lane = sender_rule.default_lane || (sender_rule.default_requires_reply ? 'to_reply' : 'done');
      const bucket = sender_rule.default_requires_reply ? 'quick_win' : 'auto_handled';
      
      console.log(`[triage] Sender rule skip_llm: ${lane}`);
      
      return new Response(JSON.stringify({
        lane,
        flags: { urgent: false, reply_required: sender_rule.default_requires_reply, financial: false, risk_type: 'none' },
        evidence: { key_quote: 'Matched sender rule', intent: 'Known pattern' },
        batch_group: null,
        decision: {
          bucket,
          why_this_needs_you: `Sender rule: ${sender_rule.default_classification}`,
          confidence: 0.99
        },
        risk: { level: 'none', cognitive_load: 'low' },
        classification: {
          category: sender_rule.override_classification || sender_rule.default_classification,
          requires_reply: sender_rule.default_requires_reply
        },
        priority: { urgency: 'low', urgency_reason: 'Sender rule applied' },
        sentiment: { tone: 'neutral' },
        entities: {},
        summary: { one_line: `${senderDomain} - sender rule applied`, key_points: [] },
        suggested_reply: null,
        reasoning: 'Deterministic sender rule match',
        applied_rule: true,
        processing_time_ms: Date.now() - startTime
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ============================================================
    // STEP 2: Deterministic gatekeeper (skip LLM for known patterns)
    // ============================================================
    const gatekeeperResult = checkGatekeeper(fromEmailString, email.subject);
    
    if (gatekeeperResult?.skip_llm) {
      console.log(`[triage] Gatekeeper match: ${gatekeeperResult.why}`);
      
      return new Response(JSON.stringify({
        lane: gatekeeperResult.lane,
        flags: { 
          urgent: false, 
          reply_required: false, 
          financial: gatekeeperResult.classification === 'receipt_confirmation',
          risk_type: 'none'
        },
        evidence: { key_quote: `From ${senderDomain}`, intent: 'Automated notification' },
        batch_group: gatekeeperResult.batch_group,
        decision: {
          bucket: gatekeeperResult.bucket,
          why_this_needs_you: gatekeeperResult.why,
          confidence: gatekeeperResult.confidence
        },
        risk: { level: 'none', cognitive_load: 'low' },
        classification: {
          category: gatekeeperResult.classification,
          requires_reply: false
        },
        priority: { urgency: 'low', urgency_reason: 'Automated system' },
        sentiment: { tone: 'neutral' },
        entities: {},
        summary: { one_line: gatekeeperResult.why, key_points: [] },
        suggested_reply: null, // HARD RULE: DONE never has suggested_reply
        reasoning: 'Deterministic gatekeeper match',
        gatekeeper_match: true,
        processing_time_ms: Date.now() - startTime
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ============================================================
    // STEP 3: Build context and call LLM
    // ============================================================
    const businessContextPrompt = await buildBusinessContext(supabase, workspace_id, business_context);
    
    // Add sender behaviour context
    let senderContextPrompt = '';
    if (sender_behaviour) {
      senderContextPrompt = '\n\n## SENDER HISTORY';
      if (sender_behaviour.reply_rate !== undefined) {
        senderContextPrompt += `\n- Reply rate: ${Math.round((sender_behaviour.reply_rate || 0) * 100)}%`;
        if (sender_behaviour.reply_rate > 0.8) senderContextPrompt += ' (high engagement)';
        else if (sender_behaviour.reply_rate < 0.2) senderContextPrompt += ' (usually ignored)';
      }
      if (sender_behaviour.vip_score && sender_behaviour.vip_score > 50) {
        senderContextPrompt += `\n- VIP Score: ${sender_behaviour.vip_score}/100`;
      }
    }

    // Add VIP domain check
    if (business_context?.vip_domains?.includes(senderDomain)) {
      senderContextPrompt += '\n⚠️ VIP DOMAIN - prioritize this sender';
    }

    const { prompt: triagePrompt, model: triageModel } = await getTriagePrompt(supabase, workspace_id);

    const emailContent = `
FROM: ${email.from_name} <${fromEmailString}>
TO: ${email.to_email || 'Unknown'}
SUBJECT: ${email.subject}

BODY:
${email.body.substring(0, 5000)}
`;

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    console.log('[triage] Calling Claude...');

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
        system: triagePrompt + businessContextPrompt + senderContextPrompt,
        tools: [DECISION_ROUTER_TOOL],
        tool_choice: { type: 'tool', name: 'route_email' },
        messages: [{ role: 'user', content: `Route this email:\n\n${emailContent}` }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[triage] Claude API error:', response.status, errorText);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const result = await response.json();
    const toolUse = result.content?.find((c: any) => c.type === 'tool_use');
    
    if (!toolUse || toolUse.name !== 'route_email') {
      console.error('[triage] No valid tool use in response');
      // Safe default: REVIEW when uncertain
      return new Response(JSON.stringify({
        lane: 'review',
        flags: { urgent: false, reply_required: true, risk_type: 'none' },
        evidence: { key_quote: '', intent: 'Unknown' },
        batch_group: null,
        decision: { bucket: 'quick_win', why_this_needs_you: 'Could not auto-classify - needs review', confidence: 0.3 },
        risk: { level: 'none', cognitive_load: 'high' },
        classification: { category: 'customer_inquiry', requires_reply: true },
        priority: { urgency: 'medium', urgency_reason: 'Classification failed' },
        sentiment: { tone: 'neutral' },
        entities: {},
        summary: { one_line: email.subject, key_points: [] },
        reasoning: 'Classification failed - requires manual review',
        needs_human_review: true,
        processing_time_ms: Date.now() - startTime
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ============================================================
    // STEP 4: Normalize and validate output
    // ============================================================
    let routeResult = normalizeTriageOutput(toolUse.input);
    
    if (!routeResult) {
      console.error('[triage] Failed to normalize output');
      return new Response(JSON.stringify({
        lane: 'review',
        flags: { urgent: false, reply_required: true, risk_type: 'none' },
        evidence: { key_quote: '', intent: '' },
        batch_group: null,
        decision: { bucket: 'quick_win', why_this_needs_you: 'Parse error - needs review', confidence: 0.3 },
        risk: { level: 'none', cognitive_load: 'high' },
        classification: { category: 'customer_inquiry', requires_reply: true },
        priority: { urgency: 'medium', urgency_reason: 'Parse failed' },
        sentiment: { tone: 'neutral' },
        entities: {},
        summary: { one_line: email.subject, key_points: [] },
        reasoning: 'Normalization failed',
        needs_human_review: true,
        processing_time_ms: Date.now() - startTime
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const validation = validateTriageResult(routeResult);
    
    // ============================================================
    // STEP 5: Apply auto-corrections
    // ============================================================
    if (!validation.valid) {
      console.log('[triage] Validation issues:', validation.issues);
      
      // DONE + reply_required conflict
      if (validation.issues.includes('DONE + reply_required conflict')) {
        routeResult.lane = 'to_reply';
        routeResult.decision.bucket = 'quick_win';
        routeResult.flags.reply_required = true;
        console.log('[triage] Corrected: DONE → TO_REPLY (reply needed)');
      }
      
      // DONE + suggested_reply conflict
      if (validation.issues.includes('DONE + suggested_reply conflict')) {
        routeResult.suggested_reply = null;
        console.log('[triage] Corrected: Cleared suggested_reply for DONE');
      }
      
      // AUTO_HANDLED + requires_reply conflict
      if (validation.issues.includes('AUTO_HANDLED + requires_reply conflict')) {
        routeResult.decision.bucket = 'quick_win';
        routeResult.lane = 'to_reply';
        console.log('[triage] Corrected: AUTO_HANDLED → QUICK_WIN');
      }
      
      // Misdirected corrections
      if (validation.issues.includes('Misdirected should be to_reply')) {
        routeResult.lane = 'to_reply';
        routeResult.decision.bucket = 'quick_win';
      }
      if (validation.issues.includes('Misdirected should require reply')) {
        routeResult.flags.reply_required = true;
        routeResult.classification.requires_reply = true;
      }
      
      // Generic why_this_needs_you
      if (validation.issues.includes('Generic why_this_needs_you') || validation.issues.includes('Empty or too short why_this_needs_you')) {
        const lane = routeResult.lane;
        const category = routeResult.classification.category;
        const betterWhys: Record<string, string> = {
          'to_reply': `${category.replace(/_/g, ' ')} - reply needed`,
          'review': `${category.replace(/_/g, ' ')} - needs review`,
          'done': `${category.replace(/_/g, ' ')} - no action needed`,
          'snoozed': `${category.replace(/_/g, ' ')} - follow up later`,
        };
        routeResult.decision.why_this_needs_you = betterWhys[lane] || `${category.replace(/_/g, ' ')}`;
      }
    }

    // ============================================================
    // STEP 6: Apply confidence-based routing (THE FIX!)
    // ============================================================
    const confidence = routeResult.decision.confidence;
    
    // LOW CONFIDENCE → REVIEW (NOT ACT_NOW!)
    // This is the critical fix from the architectural recommendations
    if (confidence < 0.80) {
      console.log(`[triage] Low confidence (${Math.round(confidence * 100)}%) → REVIEW (not urgent)`);
      routeResult.lane = 'review';
      routeResult.flags.urgent = false; // NOT urgent, just uncertain
      routeResult.flags.first_time_sender = true;
      routeResult.decision.bucket = 'quick_win'; // Shows in review queue
      routeResult.decision.why_this_needs_you = `Low confidence (${Math.round(confidence * 100)}%) - teach me`;
    }
    
    // HARD RULE: DONE lane never has suggested_reply
    if (routeResult.lane === 'done' || routeResult.decision.bucket === 'auto_handled') {
      routeResult.suggested_reply = null;
      routeResult.flags.reply_required = false;
      routeResult.classification.requires_reply = false;
    }

    // Determine if this needs review
    const needsReview = 
      routeResult.lane === 'review' ||
      (routeResult.decision.confidence < 0.85 && routeResult.lane !== 'done') ||
      (!sender_behaviour && !sender_rule); // First-time sender

    console.log('[triage] Final decision:', {
      lane: routeResult.lane,
      bucket: routeResult.decision.bucket,
      confidence: routeResult.decision.confidence,
      why: routeResult.decision.why_this_needs_you,
      batch_group: routeResult.batch_group,
      needs_review: needsReview,
    });

    return new Response(JSON.stringify({
      ...routeResult,
      needs_review: needsReview,
      validation_issues: validation.issues.length > 0 ? validation.issues : undefined,
      processing_time_ms: Date.now() - startTime
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[triage] Error:', error);
    
    // Safe default: REVIEW (not ACT_NOW) on error
    return new Response(JSON.stringify({
      lane: 'review',
      flags: { urgent: false, reply_required: true, risk_type: 'none' },
      evidence: { key_quote: '', intent: '' },
      batch_group: null,
      decision: { bucket: 'quick_win', why_this_needs_you: 'System error - needs review', confidence: 0 },
      risk: { level: 'none', cognitive_load: 'high' },
      classification: { category: 'customer_inquiry', requires_reply: true },
      priority: { urgency: 'medium', urgency_reason: 'Error during classification' },
      sentiment: { tone: 'neutral' },
      entities: {},
      summary: { one_line: 'Classification failed', key_points: [] },
      reasoning: `Error: ${errorMessage}`,
      needs_human_review: true,
      error: errorMessage,
      processing_time_ms: Date.now()
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
