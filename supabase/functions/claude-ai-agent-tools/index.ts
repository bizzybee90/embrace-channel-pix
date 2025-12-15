import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Knowledge base tools for gathering information
const KNOWLEDGE_TOOLS = [
  {
    name: "lookup_customer_by_contact",
    description: "ALWAYS call this first! Look up a customer by their phone number or email to find their name, address, and account details.",
    input_schema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "Customer's phone number" },
        email: { type: "string", description: "Customer's email address" }
      },
      required: []
    }
  },
  {
    name: "search_faqs",
    description: "Search the FAQ database for answers to common questions.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or keywords" },
        category: { type: "string", description: "Optional category filter" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_customer_info",
    description: "Retrieve detailed information about a customer by their ID.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "The UUID of the customer" }
      },
      required: ["customer_id"]
    }
  },
  {
    name: "get_pricing",
    description: "Get pricing information for services.",
    input_schema: {
      type: "object",
      properties: {
        service_name: { type: "string", description: "Optional service name to filter pricing" }
      },
      required: []
    }
  },
  {
    name: "get_business_facts",
    description: "Retrieve business-specific facts like operating hours, service areas, policies.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Optional category to filter facts" }
      },
      required: []
    }
  },
  {
    name: "search_similar_conversations",
    description: "Search past conversations using semantic similarity.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The text to find similar conversations for" },
        limit: { type: "number", description: "Maximum results (default 5)" }
      },
      required: ["query"]
    }
  }
];

// Response tool that Claude MUST call
const RESPONSE_TOOL = {
  name: "respond_to_customer",
  description: "YOU MUST call this tool to provide your final response. Required for every message.",
  input_schema: {
    type: "object",
    properties: {
      requires_reply: { type: "boolean", description: "Does this need a response?" },
      email_classification: {
        type: "string",
        enum: ["customer_inquiry", "automated_notification", "spam_phishing", "marketing_newsletter", "recruitment_hr", "receipt_confirmation", "internal_system"],
        description: "Email classification type"
      },
      response: { type: "string", description: "Your message to the customer (20-500 characters)" },
      confidence: { type: "number", description: "Confidence score 0.0-1.0" },
      intent: { type: "string", description: "Customer intent category" },
      sentiment: { type: "string", enum: ["positive", "neutral", "upset", "angry"], description: "Customer sentiment" },
      escalate: { type: "boolean", description: "Needs human review?" },
      escalation_reason: { type: "string", description: "Why escalating (if applicable)" },
      ai_title: { type: "string", description: "Short title (max 50 chars)" },
      ai_summary: { type: "string", description: "Brief summary (max 200 chars)" },
      ai_category: { type: "string", description: "Category: general, pricing, complaint, booking, etc." }
    },
    required: ["requires_reply", "response", "confidence", "intent", "sentiment", "escalate", "ai_title", "ai_summary", "ai_category"]
  }
};

const ALL_TOOLS = [...KNOWLEDGE_TOOLS, RESPONSE_TOOL];

// Default prompts if database fetch fails
const DEFAULT_ROUTER_PROMPT = `You are the Router Agent. Analyze the customer message and determine which specialist should handle it.

Route to QUOTE when:
- Customer explicitly asks for a quote or price
- New customer asking about services
- "How much does X cost?"

Route to CUSTOMER_SUPPORT when:
- Existing customer questions
- Schedule changes, complaints, payments
- General inquiries from known customers

Respond with ONLY: {"route": "quote"} or {"route": "customer_support"}`;

const DEFAULT_CUSTOMER_SUPPORT_PROMPT = `You are a customer service agent for MAC Cleaning. Be warm, helpful, and professional. Use British English. Keep responses to 2-4 sentences.`;

const DEFAULT_QUOTE_PROMPT = `You are the Quote Specialist for MAC Cleaning. Gather property details and provide accurate pricing using the get_pricing tool.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { message, conversation_history, customer_data, triage_context } = await req.json();

    console.log('📥 [Multi-Agent] Processing message:', message.message_content?.substring(0, 100));
    console.log('📥 [Multi-Agent] Channel:', message.channel);

    // Fetch system prompts from database
    const { data: prompts } = await supabase
      .from('system_prompts')
      .select('*')
      .eq('is_active', true)
      .eq('is_default', true);

    const getPrompt = (agentType: string) => {
      const dbPrompt = prompts?.find(p => p.agent_type === agentType);
      if (dbPrompt) return { prompt: dbPrompt.prompt, model: dbPrompt.model || 'claude-sonnet-4-20250514' };
      
      // Fallback defaults
      if (agentType === 'router') return { prompt: DEFAULT_ROUTER_PROMPT, model: 'claude-sonnet-4-20250514' };
      if (agentType === 'quote') return { prompt: DEFAULT_QUOTE_PROMPT, model: 'claude-sonnet-4-20250514' };
      return { prompt: DEFAULT_CUSTOMER_SUPPORT_PROMPT, model: 'claude-sonnet-4-20250514' };
    };

    // Check sender rules first
    const senderEmail = message.sender_email || '';
    const senderDomain = senderEmail.includes('@') ? senderEmail.split('@')[1] : '';
    
    if (senderEmail || senderDomain) {
      const { data: rules } = await supabase
        .from('sender_rules')
        .select('*')
        .eq('is_active', true);
      
      if (rules) {
        for (const rule of rules) {
          const pattern = rule.sender_pattern.toLowerCase();
          const email = senderEmail.toLowerCase();
          
          if ((pattern.startsWith('@') && email.endsWith(pattern)) || 
              email === pattern || email.includes(pattern)) {
            console.log('🎯 [Multi-Agent] Sender rule match:', pattern);
            
            await supabase
              .from('sender_rules')
              .update({ hit_count: (rule.hit_count || 0) + 1 })
              .eq('id', rule.id);
            
            return new Response(JSON.stringify({
              requires_reply: rule.default_requires_reply,
              email_classification: rule.default_classification,
              response: `No reply needed - matched sender rule: ${rule.sender_pattern}`,
              confidence: 0.95,
              intent: 'no_action_needed',
              sentiment: 'neutral',
              escalate: false,
              ai_title: `Auto-classified: ${rule.default_classification.replace('_', ' ')}`,
              ai_summary: message.message_content?.substring(0, 100) || 'Email matched sender rule',
              ai_category: 'notification',
              routed_to: 'sender_rule',
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        }
      }
    }

    // STEP 1: ROUTER AGENT - Determine which specialist to use
    console.log('🚦 [Router] Analyzing message for routing...');
    const routerConfig = getPrompt('router');
    
    const routerResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022', // Fast model for routing
        max_tokens: 100,
        system: routerConfig.prompt,
        messages: [{ role: 'user', content: `Customer message: "${message.message_content}"` }],
      }),
    });

    let route = 'customer_support'; // Default route
    if (routerResponse.ok) {
      const routerData = await routerResponse.json();
      const routerText = routerData.content?.[0]?.text || '';
      console.log('🚦 [Router] Response:', routerText);
      
      try {
        // Extract JSON from response
        const jsonMatch = routerText.match(/\{[^}]+\}/);
        if (jsonMatch) {
          const routerJson = JSON.parse(jsonMatch[0]);
          if (routerJson.route === 'quote' || routerJson.route === 'customer_support') {
            route = routerJson.route;
          }
        }
      } catch (e) {
        console.log('🚦 [Router] JSON parse failed, using default route');
      }
    }
    
    console.log(`🚦 [Router] Routing to: ${route.toUpperCase()}`);

    // STEP 2: SPECIALIST AGENT - Generate response
    const specialistType = route === 'quote' ? 'quote' : 'customer_support';
    const specialistConfig = getPrompt(specialistType);
    
    console.log(`🤖 [${specialistType}] Processing with specialist agent...`);

    // Build conversation context
    const conversationContext = conversation_history?.slice(0, 5).map((m: any) => 
      `${m.actor_type}: ${m.body}`
    ).join('\n') || '';

    // Build triage context if available
    let triageInfo = '';
    if (triage_context) {
      triageInfo = `\nTriage Info: Category=${triage_context.category}, Urgency=${triage_context.urgency}, Sentiment=${triage_context.sentiment}`;
    }

    const messages: any[] = [{
      role: 'user',
      content: `Incoming message from customer:
Sender Phone: ${message.sender_phone || 'Not provided'}
Sender Email: ${message.sender_email || 'Not provided'}
Channel: ${message.channel}
Message: "${message.message_content}"

Recent conversation:
${conversationContext}
${triageInfo}

IMPORTANT: 
1. FIRST call "lookup_customer_by_contact" with sender's phone or email
2. Use the customer's name in your response if found
3. Then call "respond_to_customer" with your final response.`
    }];

    let finalResponse = null;
    const maxIterations = 8;
    let iteration = 0;

    // Tool calling loop
    while (iteration < maxIterations && !finalResponse) {
      iteration++;
      
      const claudeBody = {
        model: specialistConfig.model,
        max_tokens: 2048,
        system: specialistConfig.prompt,
        messages,
        tools: ALL_TOOLS,
      };

      console.log(`🔄 [${specialistType}] Iteration ${iteration}`);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(claudeBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ [Specialist] Claude API error:', errorText);
        throw new Error(`Claude API failed: ${response.status}`);
      }

      const data = await response.json();
      const toolUseBlocks = data.content.filter((block: any) => block.type === 'tool_use');
      
      if (toolUseBlocks.length === 0) {
        console.log('⚠️ [Specialist] No tool calls, prompting for response');
        messages.push({ role: 'assistant', content: data.content });
        messages.push({ role: 'user', content: 'Please call the respond_to_customer tool now.' });
        continue;
      }

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        console.log(`🔧 [Tool] Calling: ${toolUse.name}`);
        
        if (toolUse.name === 'respond_to_customer') {
          finalResponse = toolUse.input;
          console.log('✅ [Specialist] Final response received');
          break;
        }

        // Execute knowledge tools
        let result;
        try {
          switch (toolUse.name) {
            case 'lookup_customer_by_contact':
              result = await lookupCustomerByContact(supabase, toolUse.input);
              break;
            case 'search_faqs':
              result = await searchFaqs(supabase, toolUse.input);
              break;
            case 'get_customer_info':
              result = await getCustomerInfo(supabase, toolUse.input);
              break;
            case 'get_pricing':
              result = await getPricing(supabase, toolUse.input);
              break;
            case 'get_business_facts':
              result = await getBusinessFacts(supabase, toolUse.input);
              break;
            case 'search_similar_conversations':
              result = await searchSimilarConversations(supabase, toolUse.input);
              break;
            default:
              result = { error: 'Unknown tool' };
          }
        } catch (e) {
          result = { error: 'Tool execution failed' };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      if (finalResponse) break;

      messages.push({ role: 'assistant', content: data.content });
      messages.push({ role: 'user', content: toolResults });
    }

    // Fallback if no response generated
    if (!finalResponse) {
      console.log('⚠️ [Multi-Agent] Max iterations reached, escalating');
      finalResponse = {
        requires_reply: true,
        email_classification: 'customer_inquiry',
        response: "Thank you for your message. I've passed this to our team who will get back to you shortly.",
        confidence: 0.3,
        intent: 'unknown',
        sentiment: 'neutral',
        escalate: true,
        escalation_reason: 'AI could not generate confident response',
        ai_title: 'Needs human review',
        ai_summary: message.message_content?.substring(0, 100) || 'Message requires review',
        ai_category: 'general',
      };
    }

    // Add routing info to response
    finalResponse.routed_to = route;
    
    console.log('✅ [Multi-Agent] Complete:', {
      route,
      confidence: finalResponse.confidence,
      escalate: finalResponse.escalate,
    });

    return new Response(JSON.stringify(finalResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ [Multi-Agent] Error:', error);
    return new Response(JSON.stringify({
      requires_reply: true,
      response: "Thank you for your message. Our team will review this and get back to you shortly.",
      confidence: 0.2,
      escalate: true,
      escalation_reason: `System error: ${error instanceof Error ? error.message : 'Unknown'}`,
      ai_title: 'System error - needs review',
      ai_summary: 'Error processing message',
      ai_category: 'general',
      routed_to: 'error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Tool implementations
async function lookupCustomerByContact(supabase: any, input: any) {
  const { phone, email } = input;
  let query = supabase.from('customers').select('*');
  
  if (phone) {
    const normalizedPhone = phone.replace(/\D/g, '').slice(-10);
    query = query.or(`phone.ilike.%${normalizedPhone}%,phone.ilike.%${phone}%`);
  }
  if (email) {
    query = query.or(`email.ilike.${email}`);
  }
  
  const { data } = await query.limit(1).maybeSingle();
  
  if (data) {
    return {
      found: true,
      customer: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        address: data.address,
        tier: data.tier,
        balance: data.balance,
        next_appointment: data.next_appointment,
        notes: data.notes,
      }
    };
  }
  return { found: false, message: 'Customer not found. You may need to ask for their details.' };
}

async function searchFaqs(supabase: any, input: any) {
  let query = supabase.from('faq_database').select('question, answer, category').eq('is_active', true);
  
  if (input.category) {
    query = query.eq('category', input.category);
  }
  
  const { data } = await query.limit(5);
  
  if (data && data.length > 0) {
    const searchTerms = input.query.toLowerCase().split(' ');
    const filtered = data.filter((faq: any) => 
      searchTerms.some((term: string) => 
        faq.question.toLowerCase().includes(term) || 
        faq.answer.toLowerCase().includes(term)
      )
    );
    return { faqs: filtered.slice(0, 3) };
  }
  return { faqs: [], message: 'No relevant FAQs found' };
}

async function getCustomerInfo(supabase: any, input: any) {
  const { data } = await supabase
    .from('customers')
    .select('*')
    .eq('id', input.customer_id)
    .single();
  
  if (data) {
    return { customer: data };
  }
  return { error: 'Customer not found' };
}

async function getPricing(supabase: any, input: any) {
  let query = supabase.from('price_list').select('*').eq('is_active', true);
  
  if (input.service_name) {
    query = query.ilike('service_name', `%${input.service_name}%`);
  }
  
  const { data } = await query.limit(10);
  return { pricing: data || [] };
}

async function getBusinessFacts(supabase: any, input: any) {
  let query = supabase.from('business_facts').select('category, fact_key, fact_value');
  
  if (input.category) {
    query = query.eq('category', input.category);
  }
  
  const { data } = await query.limit(20);
  return { facts: data || [] };
}

async function searchSimilarConversations(supabase: any, input: any) {
  // Simplified: just return recent resolved conversations
  const { data } = await supabase
    .from('conversations')
    .select('title, ai_draft_response, final_response, category')
    .eq('status', 'resolved')
    .not('final_response', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(input.limit || 3);
  
  return { similar: data || [] };
}
