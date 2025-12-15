import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Default fallback prompt
const DEFAULT_TRIAGE_PROMPT = `You are an expert email triage agent for service businesses. Your job is to instantly classify, prioritize, and extract key information from incoming emails. You must be fast, accurate, and consistent.

## Classification Taxonomy

Classify every email into ONE of these categories:

### REQUIRES_REPLY = true (Action Required)
| Category | Description |
|----------|-------------|
| customer_inquiry | Direct questions or requests from customers (quote requests, service questions, booking inquiries) |
| customer_complaint | Expressions of dissatisfaction or issues (quality complaints, missed appointments, billing disputes) |
| customer_feedback | Reviews, testimonials, or general feedback ("Great job today!", survey responses) |
| lead_new | Potential new customer expressing interest ("I found you on Google, do you cover my area?") |
| lead_followup | Follow-up from previous quote or conversation ("I got your quote, I'd like to proceed") |
| supplier_urgent | Supplier comms requiring response (invoice queries, delivery issues, account problems) |
| partner_request | Business partnership or collaboration requests (referral partners, B2B inquiries) |

### REQUIRES_REPLY = false (Auto-Triage)
| Category | Description |
|----------|-------------|
| automated_notification | System-generated alerts (voicemail transcripts, missed call alerts, system notifications) |
| receipt_confirmation | Transaction confirmations (payment received, booking confirmed, order shipped) |
| marketing_newsletter | Promotional content (supplier newsletters, promotional offers, industry news) |
| spam_phishing | Suspicious or malicious (phishing attempts, obvious spam, scams) |
| recruitment_hr | Job applications (Indeed applications, LinkedIn messages, CV submissions) |
| internal_system | Internal system emails (password resets, calendar invites, software notifications) |
| informational_only | FYI emails requiring no action (policy updates, terms changes, announcements) |

## Remember
1. When in doubt, set requires_reply: true - safer to over-escalate than miss a customer
2. High urgency + negative sentiment = immediate human attention
3. Always provide reasoning for audit trail
4. Never hallucinate entity values - only extract what's explicitly stated`;

async function getTriagePrompt(supabase: any, workspaceId?: string): Promise<{ prompt: string; model: string }> {
  try {
    // Try workspace-specific prompt first
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

    // Fall back to global default prompt
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

const TRIAGE_TOOL = {
  name: "classify_email",
  description: "Classify and extract information from an incoming email",
  input_schema: {
    type: "object",
    properties: {
      classification: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: [
              "customer_inquiry", "customer_complaint", "customer_feedback",
              "lead_new", "lead_followup", "supplier_urgent", "partner_request",
              "automated_notification", "receipt_confirmation", "marketing_newsletter",
              "spam_phishing", "recruitment_hr", "internal_system", "informational_only"
            ],
            description: "The classification category for this email"
          },
          requires_reply: {
            type: "boolean",
            description: "Whether this email requires a human response"
          },
          confidence: {
            type: "number",
            description: "Confidence score from 0 to 1"
          }
        },
        required: ["category", "requires_reply", "confidence"]
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
          },
          tone_signals: {
            type: "array",
            items: { type: "string" },
            description: "Specific phrases or signals indicating the tone"
          }
        },
        required: ["tone", "tone_signals"]
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
            description: "One-line summary of the email (max 100 chars)"
          },
          key_points: {
            type: "array",
            items: { type: "string" },
            description: "Key points from the email (max 3)"
          }
        },
        required: ["one_line", "key_points"]
      },
      suggested_actions: {
        type: "array",
        items: { type: "string" },
        description: "Recommended actions for handling this email (max 3)"
      },
      thread_context: {
        type: "object",
        properties: {
          is_reply: { type: "boolean", description: "Whether this appears to be a reply" },
          reply_to_subject: { type: "string", description: "Original subject if a reply" },
          estimated_thread_length: { type: "number", description: "Estimated emails in thread" }
        }
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of the classification decision"
      },
      needs_human_review: {
        type: "boolean",
        description: "Whether this needs human review due to low confidence or ambiguity"
      }
    },
    required: ["classification", "priority", "sentiment", "entities", "summary", "suggested_actions", "reasoning"]
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

    console.log('Triage agent processing email from:', email.from_email, 'subject:', email.subject);

    // If sender rule exists and has an override, apply it directly
    if (sender_rule) {
      const classification = sender_rule.override_classification || sender_rule.default_classification;
      const requires_reply = sender_rule.override_requires_reply ?? sender_rule.default_requires_reply;
      
      console.log('Applying sender rule:', classification, 'requires_reply:', requires_reply);
      
      return new Response(JSON.stringify({
        classification: {
          category: classification,
          requires_reply: requires_reply,
          confidence: 0.99
        },
        priority: {
          urgency: requires_reply ? 'medium' : 'low',
          urgency_reason: 'Classified by sender rule'
        },
        sentiment: {
          tone: 'neutral',
          tone_signals: []
        },
        entities: {},
        summary: {
          one_line: `Email from ${email.from_email} - classified by sender rule`,
          key_points: ['Matched sender rule pattern']
        },
        suggested_actions: requires_reply ? ['Review and respond'] : ['No action needed'],
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
        contextualPrompt += '\n\nIMPORTANT: The business is currently hiring. Recruitment/job application emails should be classified as recruitment_hr with requires_reply: true.';
      }
      if (business_context.active_dispute) {
        contextualPrompt += '\n\nIMPORTANT: There is an active payment dispute. Emails from payment processors (Stripe, PayPal, etc.) should be classified as supplier_urgent with requires_reply: true.';
      }
      if (business_context.vip_domains && business_context.vip_domains.length > 0) {
        const senderDomain = email.from_email.split('@')[1]?.toLowerCase();
        if (business_context.vip_domains.includes(senderDomain)) {
          contextualPrompt += '\n\nIMPORTANT: This sender is from a VIP customer domain. Set urgency to high and requires_reply to true.';
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

    // Fetch triage prompt from database
    const { prompt: triagePrompt, model: triageModel } = await getTriagePrompt(supabase, workspace_id);

    // Prepare the email content for analysis
    const emailContent = `
FROM: ${email.from_name} <${email.from_email}>
TO: ${email.to_email || 'Unknown'}
SUBJECT: ${email.subject}

BODY:
${email.body.substring(0, 5000)}
`;

    // Call Claude for triage
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
        tools: [TRIAGE_TOOL],
        tool_choice: { type: 'tool', name: 'classify_email' },
        messages: [
          {
            role: 'user',
            content: `Classify this email:\n\n${emailContent}`
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
    console.log('Claude triage response received');

    // Extract the tool use result
    const toolUse = result.content?.find((c: any) => c.type === 'tool_use');
    if (!toolUse || toolUse.name !== 'classify_email') {
      console.error('No valid tool use in response');
      // Return safe defaults
      return new Response(JSON.stringify({
        classification: {
          category: 'customer_inquiry',
          requires_reply: true,
          confidence: 0.5
        },
        priority: {
          urgency: 'medium',
          urgency_reason: 'Could not classify - defaulting to medium'
        },
        sentiment: {
          tone: 'neutral',
          tone_signals: []
        },
        entities: {},
        summary: {
          one_line: email.subject,
          key_points: []
        },
        suggested_actions: ['Manual review required'],
        reasoning: 'Classification failed - requires manual review',
        needs_human_review: true,
        processing_time_ms: Date.now() - startTime
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const triageResult = toolUse.input;
    const processingTime = Date.now() - startTime;

    console.log('Triage complete:', {
      category: triageResult.classification.category,
      requires_reply: triageResult.classification.requires_reply,
      confidence: triageResult.classification.confidence,
      urgency: triageResult.priority.urgency,
      processing_time_ms: processingTime
    });

    // Add confidence-based review flag
    if (triageResult.classification.confidence < 0.7) {
      triageResult.needs_human_review = true;
    }

    // If confidence is below threshold but requires_reply is false, override to be safe
    if (triageResult.classification.confidence < 0.6 && !triageResult.classification.requires_reply) {
      console.log('Low confidence override: setting requires_reply to true');
      triageResult.classification.requires_reply = true;
      triageResult.needs_human_review = true;
      triageResult.reasoning += ' (Low confidence - escalated for human review)';
    }

    return new Response(JSON.stringify({
      ...triageResult,
      processing_time_ms: processingTime
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in email-triage-agent:', error);
    
    // Return safe defaults on error
    return new Response(JSON.stringify({
      classification: {
        category: 'customer_inquiry',
        requires_reply: true,
        confidence: 0
      },
      priority: {
        urgency: 'high',
        urgency_reason: 'Classification error - requires immediate review'
      },
      sentiment: {
        tone: 'neutral',
        tone_signals: []
      },
      entities: {},
      summary: {
        one_line: 'Classification failed',
        key_points: []
      },
      suggested_actions: ['Manual review required due to system error'],
      reasoning: `Error during classification: ${errorMessage}`,
      needs_human_review: true,
      error: errorMessage,
      processing_time_ms: Date.now()
    }), {
      status: 200, // Return 200 even on error to prevent retries
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
