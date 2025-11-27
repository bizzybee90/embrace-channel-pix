import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Tool definitions for Claude
const TOOLS = [
  {
    name: "search_faqs",
    description: "Search the FAQ database for answers to common questions. Returns relevant FAQs based on keywords or category.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query or keywords to find relevant FAQs"
        },
        category: {
          type: "string",
          description: "Optional category to filter FAQs (e.g., 'pricing', 'scheduling', 'services')"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "get_customer_info",
    description: "Retrieve detailed information about a customer including their history, preferences, and notes.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: {
          type: "string",
          description: "The UUID of the customer"
        }
      },
      required: ["customer_id"]
    }
  },
  {
    name: "get_pricing",
    description: "Get pricing information for services. Can search by service name or get all pricing.",
    input_schema: {
      type: "object",
      properties: {
        service_name: {
          type: "string",
          description: "Optional service name to filter pricing (e.g., 'window cleaning', 'conservatory', 'gutters')"
        }
      },
      required: []
    }
  },
  {
    name: "get_business_facts",
    description: "Retrieve business-specific facts and information like operating hours, service areas, policies, etc.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Optional category to filter facts (e.g., 'hours', 'areas', 'policies')"
        }
      },
      required: []
    }
  },
  {
    name: "search_similar_conversations",
    description: "Search past conversations using semantic similarity to learn from successful interactions and human corrections. Prioritizes conversations that led to bookings or were edited by humans.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The text to find similar past conversations for"
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default 5)"
        },
        prioritize_successful: {
          type: "boolean",
          description: "Whether to prioritize conversations with high satisfaction or that led to bookings (default true)"
        }
      },
      required: ["query"]
    }
  }
];

const SYSTEM_PROMPT = `You are a friendly, professional customer service AI for MAC Cleaning, a window cleaning service in the Luton and Milton Keynes area.

## Your Personality
- Warm and helpful, like a friendly neighbour
- Professional but not corporate or stuffy
- British English (favour, colour, apologise)
- Concise - customers are busy
- Proactive in offering solutions

## Available Tools
You have access to several tools to help answer questions:
- search_faqs: Find answers in the FAQ database
- get_customer_info: Look up customer details and history
- get_pricing: Get current pricing for services
- get_business_facts: Look up business information (hours, areas, policies)
- search_similar_conversations: Learn from past successful interactions

Use these tools when you need specific information to answer the customer's question.

## Response Guidelines
- Keep responses concise and friendly
- Use tools to provide accurate information
- If you're unsure, use search_similar_conversations to see how similar questions were handled
- Escalate if the customer is frustrated, mentions legal issues, or requests refunds

## Confidence Scoring
Rate your confidence 0.0 to 1.0:
- 0.9-1.0: Simple query, clear answer, customer happy
- 0.7-0.9: Straightforward but may need follow-up
- 0.5-0.7: Somewhat complex, less certain of best response
- Below 0.5: Escalate to human

## Output Format
Always respond with valid JSON:
{
  "response": "Your message to the customer",
  "confidence": 0.85,
  "intent": "schedule_query",
  "sentiment": "neutral",
  "escalate": false,
  "escalation_reason": null,
  "ai_title": "Query Title",
  "ai_summary": "Brief summary",
  "ai_category": "category"
}`;

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

    const { message, conversation_history, customer_data } = await req.json();

    console.log('Processing message with tool calling:', message.message_content);

    // Prepare conversation context
    type Message = 
      | { role: 'user'; content: string | any[] }
      | { role: 'assistant'; content: any[] };

    const messages: Message[] = [
      {
        role: 'user',
        content: `Customer: ${customer_data?.name || 'Unknown'}
Channel: ${message.channel}
Message: "${message.message_content}"

Recent conversation history:
${conversation_history.slice(0, 5).map((m: any) => `${m.actor_type}: ${m.body}`).join('\n')}`
      }
    ];

    let toolResults: any[] = [];
    let finalResponse = null;
    const maxIterations = 5;
    let iteration = 0;

    // Tool calling loop
    while (iteration < maxIterations && !finalResponse) {
      iteration++;
      
      const claudeBody: any = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages,
        tools: TOOLS,
      };

      console.log(`Tool calling iteration ${iteration}`);

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
        console.error('Claude API error:', errorText);
        throw new Error(`Claude API failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('Claude response:', JSON.stringify(data, null, 2));

      // Check if Claude wants to use tools
      const toolUseBlocks = data.content.filter((block: any) => block.type === 'tool_use');
      
      if (toolUseBlocks.length === 0) {
        // No tools requested, extract final response
        const textBlock = data.content.find((block: any) => block.type === 'text');
        if (textBlock) {
          try {
            finalResponse = JSON.parse(textBlock.text);
          } catch {
            // If not JSON, treat as plain text
            finalResponse = {
              response: textBlock.text,
              confidence: 0.7,
              intent: "general_inquiry",
              sentiment: "neutral",
              escalate: false,
              escalation_reason: null,
              ai_title: "Customer Inquiry",
              ai_summary: message.message_content.substring(0, 100),
              ai_category: "general"
            };
          }
        }
        break;
      }

      // Execute all tool requests
      const toolResultsForThisIteration: any[] = [];
      
      for (const toolUse of toolUseBlocks) {
        const { name, input, id } = toolUse;
        console.log(`Executing tool: ${name}`, input);

        let toolResult: any;

        try {
          switch (name) {
            case 'search_faqs':
              toolResult = await searchFaqs(supabase, input);
              break;
            case 'get_customer_info':
              toolResult = await getCustomerInfo(supabase, input, customer_data);
              break;
            case 'get_pricing':
              toolResult = await getPricing(supabase, input);
              break;
            case 'get_business_facts':
              toolResult = await getBusinessFacts(supabase, input);
              break;
            case 'search_similar_conversations':
              toolResult = await searchSimilarConversations(supabase, input);
              break;
            default:
              toolResult = { error: `Unknown tool: ${name}` };
          }
        } catch (error) {
          console.error(`Tool ${name} error:`, error);
          toolResult = { error: error instanceof Error ? error.message : 'Tool execution failed' };
        }

        toolResultsForThisIteration.push({
          type: 'tool_result',
          tool_use_id: id,
          content: JSON.stringify(toolResult)
        });
      }

      // Add assistant message with tool use
      messages.push({
        role: 'assistant',
        content: data.content
      });

      // Add tool results
      messages.push({
        role: 'user',
        content: toolResultsForThisIteration
      });
    }

    if (!finalResponse) {
      throw new Error('Failed to get final response from Claude');
    }

    console.log('Final AI output:', finalResponse);

    return new Response(JSON.stringify(finalResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in claude-ai-agent-tools:', error);
    
    const fallbackResponse = {
      response: "Thank you for your message. I'll make sure someone from our team gets back to you shortly.",
      confidence: 0.0,
      intent: "unknown",
      sentiment: "neutral",
      escalate: true,
      escalation_reason: error instanceof Error ? `AI agent error: ${error.message}` : 'AI agent error',
      ai_title: "AI Error - Needs Review",
      ai_summary: "AI agent encountered an error processing this message",
      ai_category: "error"
    };

    return new Response(JSON.stringify(fallbackResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Tool implementation functions
async function searchFaqs(supabase: any, input: any) {
  const { query, category } = input;
  
  let queryBuilder = supabase
    .from('faq_database')
    .select('question, answer, category')
    .or(`question.ilike.%${query}%,answer.ilike.%${query}%,keywords.cs.{${query}}`);
  
  if (category) {
    queryBuilder = queryBuilder.eq('category', category);
  }

  const { data, error } = await queryBuilder.limit(5);

  if (error) throw error;
  
  return data || [];
}

async function getCustomerInfo(supabase: any, input: any, existingCustomerData: any) {
  // If we already have customer data from the calling function, return it
  if (existingCustomerData) {
    return existingCustomerData;
  }

  const { customer_id } = input;
  
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customer_id)
    .single();

  if (error) throw error;
  
  return data;
}

async function getPricing(supabase: any, input: any) {
  const { service_name } = input;
  
  let queryBuilder = supabase
    .from('price_list')
    .select('*');
  
  if (service_name) {
    queryBuilder = queryBuilder.ilike('service_name', `%${service_name}%`);
  }

  const { data, error } = await queryBuilder.order('service_name');

  if (error) throw error;
  
  return data || [];
}

async function getBusinessFacts(supabase: any, input: any) {
  const { category } = input;
  
  let queryBuilder = supabase
    .from('business_facts')
    .select('*');
  
  if (category) {
    queryBuilder = queryBuilder.eq('category', category);
  }

  const { data, error } = await queryBuilder;

  if (error) throw error;
  
  return data || [];
}

async function searchSimilarConversations(supabase: any, input: any) {
  const { query, limit = 5, prioritize_successful = true } = input;
  
  // First, generate embedding for the query
  const { data: embeddingData, error: embeddingError } = await supabase.functions.invoke('generate-embedding', {
    body: { text: query }
  });

  if (embeddingError || !embeddingData?.embedding) {
    console.error('Failed to generate embedding:', embeddingError);
    return [];
  }

  const embedding = embeddingData.embedding;

  // Search for similar conversations using vector similarity
  // We'll use a raw query for better control over the similarity search
  let queryBuilder = supabase.rpc('match_conversations', {
    query_embedding: embedding,
    match_threshold: 0.7,
    match_count: limit * 2 // Get more results to filter
  });

  const { data, error } = await queryBuilder;

  if (error) {
    console.error('Vector search error:', error);
    return [];
  }

  if (!data || data.length === 0) return [];

  // If prioritize_successful, sort by quality indicators
  if (prioritize_successful) {
    data.sort((a: any, b: any) => {
      let scoreA = 0;
      let scoreB = 0;

      if (a.led_to_booking) scoreA += 10;
      if (b.led_to_booking) scoreB += 10;

      if (a.human_edited) scoreA += 5;
      if (b.human_edited) scoreB += 5;

      if (a.customer_satisfaction) scoreA += a.customer_satisfaction;
      if (b.customer_satisfaction) scoreB += b.customer_satisfaction;

      return scoreB - scoreA;
    });
  }

  return data.slice(0, limit).map((conv: any) => ({
    text: conv.text,
    ai_response: conv.ai_response,
    final_response: conv.final_response,
    human_edited: conv.human_edited,
    led_to_booking: conv.led_to_booking,
    customer_satisfaction: conv.customer_satisfaction,
    similarity: conv.similarity
  }));
}
