import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NormalisedMessage {
  channel: "sms" | "whatsapp" | "email" | "web";
  customer_identifier: string;
  customer_name: string | null;
  customer_email: string | null;
  message_content: string;
  message_id: string;
  timestamp: string;
  session_id: string;
}

interface AIAgentInput {
  message: NormalisedMessage;
  conversation_history: any[];
  customer_data: any | null;
}

interface AIAgentOutput {
  response: string;
  confidence: number;
  intent: string;
  sentiment: "positive" | "neutral" | "negative" | "frustrated";
  escalate: boolean;
  escalation_reason: string | null;
  agent_used: "router" | "customer_service" | "quote";
  ai_title: string;
  ai_summary: string;
  ai_category: string;
  suggested_response: string;
  quote_details?: any;
}

const ESCALATION_TRIGGERS = {
  keywords: [
    "refund", "compensation", "damage", "legal", "solicitor", "lawyer",
    "trading standards", "ombudsman", "sue", "court",
    "ring doorbell", "camera", "footage", "cctv",
    "hospital", "illness", "death", "bereavement", "funeral",
    "police", "theft", "stolen"
  ],
  sentiment_threshold: "frustrated",
  confidence_threshold: 0.46,
  intents_always_escalate: [
    "complaint",
    "damage_report",
    "refund_request",
    "legal_threat"
  ]
};

const ROUTER_PROMPT = `You are a routing agent for MAC Cleaning, a professional window cleaning service.

Analyse the customer message and determine:
1. Primary intent
2. Which specialist agent should handle this
3. Initial sentiment assessment

INTENTS AND ROUTING:

Route to QUOTE AGENT:
- quote_request: Asking for pricing or quotes
- new_service: Wanting to become a customer
- service_addition: Adding services to existing account

Route to CUSTOMER SERVICE AGENT:
- schedule_query: Questions about appointment times
- reschedule: Wanting to change appointment
- service_question: Questions about how service works
- complaint: Unhappy with service
- cancellation: Wanting to cancel
- payment_query: Questions about billing
- general_inquiry: General questions
- positive_feedback: Compliments or thanks

Output JSON only:
{
  "intent": "string",
  "route_to": "quote_agent" | "customer_service_agent",
  "sentiment": "positive" | "neutral" | "negative" | "frustrated",
  "reasoning": "brief explanation"
}`;

const CUSTOMER_SERVICE_PROMPT = `You are a friendly, professional customer service AI for MAC Cleaning, a window cleaning service in the Luton and Milton Keynes area.

## Your Personality
- Warm and helpful, like a friendly neighbour
- Professional but not corporate or stuffy
- British English (favour, colour, apologise)
- Concise - customers are busy
- Proactive in offering solutions

## Company Information
- Business: MAC Cleaning - Professional Window Cleaning
- Areas: Luton, Dunstable, Houghton Regis, Leighton Buzzard, Milton Keynes
- Services: Residential window cleaning, conservatory cleaning, gutter clearing, fascia/soffit cleaning
- Scheduling: Regular cleans every 4, 6, or 8 weeks
- Payment: Cash, bank transfer, or card on the day
- Contact: +447878758588

## What You Can Help With
1. Appointment queries - Check when their next clean is
2. Rescheduling - Help move appointments (within reason)
3. Service questions - Explain what we do and how
4. Complaints - Apologise, show empathy, offer solutions
5. General inquiries - Answer questions about MAC Cleaning

## What You CANNOT Do (Must Escalate)
1. Issue refunds or credits
2. Handle serious complaints about damage
3. Make promises about specific times/dates without checking
4. Discuss other customers
5. Handle abusive messages

## Response Guidelines

### Channel-Specific Formatting
- SMS: Keep under 160 characters when possible. No emojis. Direct and clear.
- WhatsApp: Can be slightly longer. Occasional emoji okay 👍. Friendly tone.
- Email: Professional greeting and sign-off. Can be more detailed.

### Confidence Scoring
Rate your confidence 0.0 to 1.0:
- 0.9-1.0: Simple query, clear answer, customer happy
- 0.7-0.9: Straightforward but may need follow-up
- 0.5-0.7: Somewhat complex, less certain of best response
- Below 0.5: Escalate to human - complaint, complex issue, angry customer

### Escalation Triggers (ALWAYS escalate)
- Customer mentions: refund, compensation, damage, legal, solicitor
- Customer is clearly angry or frustrated (ALL CAPS, multiple exclamation marks, swearing)
- Request involves Ring doorbell, camera, or security footage
- Customer mentions hospital, illness, or bereavement
- Payment disputes or billing errors
- You're not confident in your answer

## Output Format

You must respond with valid JSON only:
{
  "response": "Your message to the customer",
  "confidence": 0.85,
  "intent": "schedule_query",
  "sentiment": "neutral",
  "escalate": false,
  "escalation_reason": null,
  "ai_title": "Next Clean Query",
  "ai_summary": "Customer asked about their next scheduled clean",
  "ai_category": "scheduling",
  "suggested_response": "Your message to the customer"
}`;

const QUOTE_AGENT_PROMPT = `You are a friendly, knowledgeable quoting assistant for MAC Cleaning, a professional window cleaning service.

## Your Personality
- Helpful and enthusiastic about getting new customers
- Professional but approachable
- Clear about pricing - no hidden costs
- British English

## Pricing Structure

### Standard Window Cleaning (External Only)
| Property Type | Price Range |
|---------------|-------------|
| 1-2 bed flat | £8 - £12 |
| 2-3 bed semi | £12 - £18 |
| 3-4 bed detached | £18 - £28 |
| 4-5 bed large detached | £28 - £40 |
| 5+ bed / mansion | £40+ (custom quote) |

### Frequency Discounts
- Every 4 weeks: Standard price
- Every 6 weeks: Standard price
- Every 8 weeks: +£2-4 (more buildup)
- One-off clean: +20% (no regular discount)

### Additional Services
| Service | Typical Price |
|---------|---------------|
| Conservatory roof | £30 - £60 |
| Gutter clearing | £40 - £80 |
| Fascia & soffit clean | £40 - £80 |
| Inside windows | +50% of external price |

### First Clean
First clean is often slightly more (£2-5) due to initial buildup if windows haven't been cleaned recently.

## Quoting Process

1. Ask what type of property (beds, detached/semi/terrace)
2. Ask what services they need
3. Ask their postcode (to confirm we cover their area)
4. Provide estimate range
5. Offer to book a time for first clean

## Areas We Cover
- Luton and surrounding (LU1-LU7)
- Dunstable
- Houghton Regis
- Leighton Buzzard
- Milton Keynes (MK1-MK19)

## Output Format

You must respond with valid JSON only:
{
  "response": "Your message to the customer",
  "confidence": 0.85,
  "intent": "quote_request",
  "sentiment": "positive",
  "escalate": false,
  "escalation_reason": null,
  "ai_title": "New Quote Request",
  "ai_summary": "Potential new customer asking for quote on 3-bed semi",
  "ai_category": "sales",
  "suggested_response": "Your message to the customer",
  "quote_details": {
    "property_type": "3-bed semi",
    "services": ["windows"],
    "estimated_price": "£12-£18",
    "frequency": "every 4 weeks"
  }
}`;

// Helper function to extract JSON from markdown code fences
function extractJSON(text: string): string {
  // Remove markdown code fences if present
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  return text.trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const input: AIAgentInput = await req.json();
    const { message, conversation_history, customer_data } = input;

    console.log('Processing message:', message.message_content);
    console.log('Customer data:', customer_data);

    // Step 1: Router Agent - Determine intent and routing
    const routerResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `${ROUTER_PROMPT}\n\nCustomer message: "${message.message_content}"\n\nConversation history:\n${conversation_history.map(m => `${m.actor_type}: ${m.body}`).join('\n')}`
        }]
      }),
    });

    if (!routerResponse.ok) {
      const errorText = await routerResponse.text();
      console.error('Router API error:', errorText);
      throw new Error(`Router agent failed: ${routerResponse.status}`);
    }

    const routerData = await routerResponse.json();
    const cleanRouterText = extractJSON(routerData.content[0].text);
    const routerOutput = JSON.parse(cleanRouterText);
    console.log('Router decision:', routerOutput);

    // Step 2: Query relevant data based on routing
    let faqs: any[] = [];
    if (routerOutput.route_to === 'customer_service_agent') {
      // Search FAQs for customer service queries
      const { data: faqData } = await supabase
        .from('faqs')
        .select('question, answer, category')
        .or(`question.ilike.%${message.message_content}%,answer.ilike.%${message.message_content}%`)
        .limit(5);
      
      if (faqData) faqs = faqData;
    }

    // Step 3: Call specialist agent
    const specialistPrompt = routerOutput.route_to === 'quote_agent' 
      ? QUOTE_AGENT_PROMPT 
      : CUSTOMER_SERVICE_PROMPT;

    const contextInfo = `
Customer Information:
${customer_data ? `- Name: ${customer_data.name || 'Unknown'}
- Phone: ${customer_data.phone || 'Unknown'}
- Email: ${customer_data.email || 'Unknown'}
- Tier: ${customer_data.tier || 'regular'}
- Notes: ${customer_data.notes || 'None'}` : '- New customer, no existing record'}

Recent Conversation History:
${conversation_history.slice(0, 5).map(m => `${m.actor_type} (${m.created_at}): ${m.body}`).join('\n')}

${faqs.length > 0 ? `\nRelevant FAQs:\n${faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}` : ''}

Channel: ${message.channel}
Customer Message: "${message.message_content}"
`;

    const specialistResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: `${specialistPrompt}\n\n${contextInfo}\n\nProvide your response in valid JSON format only.`
        }]
      }),
    });

    if (!specialistResponse.ok) {
      const errorText = await specialistResponse.text();
      console.error('Specialist API error:', errorText);
      throw new Error(`Specialist agent failed: ${specialistResponse.status}`);
    }

    const specialistData = await specialistResponse.json();
    const cleanSpecialistText = extractJSON(specialistData.content[0].text);
    let specialistOutput = JSON.parse(cleanSpecialistText);

    // Override with router sentiment if more severe
    if (routerOutput.sentiment === 'frustrated') {
      specialistOutput.sentiment = 'frustrated';
    }

    // Step 4: Apply escalation logic
    const shouldEscalate = checkEscalation(specialistOutput, message.message_content);
    if (shouldEscalate && !specialistOutput.escalate) {
      specialistOutput.escalate = true;
      specialistOutput.escalation_reason = specialistOutput.escalation_reason || 'Triggered by escalation keywords or low confidence';
    }

    const finalOutput: AIAgentOutput = {
      ...specialistOutput,
      agent_used: routerOutput.route_to === 'quote_agent' ? 'quote' : 'customer_service',
      intent: routerOutput.intent,
    };

    console.log('Final AI output:', finalOutput);

    return new Response(JSON.stringify(finalOutput), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in claude-ai-agent:', error);
    
    // Fallback escalation response
    const fallbackResponse: AIAgentOutput = {
      response: "Thank you for your message. I'll make sure someone from our team gets back to you shortly.",
      confidence: 0.0,
      intent: "unknown",
      sentiment: "neutral",
      escalate: true,
      escalation_reason: `AI agent error: ${error.message}`,
      agent_used: "router",
      ai_title: "AI Error - Needs Review",
      ai_summary: "AI agent encountered an error processing this message",
      ai_category: "error",
      suggested_response: "Please review this conversation manually"
    };

    return new Response(JSON.stringify(fallbackResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function checkEscalation(response: any, message: string): boolean {
  const lowerMessage = message.toLowerCase();
  
  // Check keywords
  for (const keyword of ESCALATION_TRIGGERS.keywords) {
    if (lowerMessage.includes(keyword)) {
      console.log(`Escalation triggered by keyword: ${keyword}`);
      return true;
    }
  }
  
  // Check sentiment
  if (response.sentiment === ESCALATION_TRIGGERS.sentiment_threshold) {
    console.log('Escalation triggered by frustrated sentiment');
    return true;
  }
  
  // Check confidence
  if (response.confidence < ESCALATION_TRIGGERS.confidence_threshold) {
    console.log(`Escalation triggered by low confidence: ${response.confidence}`);
    return true;
  }
  
  // Check intent
  if (ESCALATION_TRIGGERS.intents_always_escalate.includes(response.intent)) {
    console.log(`Escalation triggered by intent: ${response.intent}`);
    return true;
  }
  
  return response.escalate;
}
