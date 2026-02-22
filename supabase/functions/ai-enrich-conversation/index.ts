import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // --- AUTH: Accept user JWT or service-role / worker token ---
  const authHeader = req.headers.get('Authorization');
  const workerToken = req.headers.get('x-bb-worker-token');
  const isServiceRole = authHeader?.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '___none___');
  const isWorker = workerToken && workerToken === Deno.env.get('BB_WORKER_TOKEN');

  if (!isServiceRole && !isWorker) {
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  const startTime = Date.now();

  try {
    const { conversation_id, customer_id, workspace_id } = await req.json();

    if (!conversation_id || !workspace_id) {
      return new Response(JSON.stringify({ error: 'Missing conversation_id or workspace_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Fetch conversation
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id, title, category, decision_bucket, channel, customer_id, workspace_id')
      .eq('id', conversation_id)
      .single();

    if (!conversation) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const resolvedCustomerId = customer_id || conversation.customer_id;
    if (!resolvedCustomerId) {
      return new Response(JSON.stringify({ error: 'No customer associated' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Fetch customer
    const { data: customer } = await supabase
      .from('customers')
      .select('id, name, email, phone, vip_status, sentiment_trend, intelligence, topics_discussed, tier, lifetime_value, frequency')
      .eq('id', resolvedCustomerId)
      .single();

    if (!customer) {
      return new Response(JSON.stringify({ error: 'Customer not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3. Fetch last 10 messages
    const { data: messages } = await supabase
      .from('messages')
      .select('body, direction, actor_name, actor_type, channel, created_at')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: true })
      .limit(10);

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ status: 'no_messages' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 4. Build conversation thread text
    const threadText = messages.map(m =>
      `[${m.direction === 'inbound' ? 'CUSTOMER' : 'BUSINESS'}] ${m.actor_name || 'Unknown'}: ${(m.body || '').substring(0, 500)}`
    ).join('\n\n');

    // 5. Call Lovable AI Gateway
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const gatewayUrl = Deno.env.get('LOVABLE_AI_GATEWAY_URL') || 'https://ai.gateway.lovable.dev/v1/chat/completions';

    if (!LOVABLE_API_KEY) {
      console.error('[ai-enrich] LOVABLE_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const systemPrompt = `You are a customer intelligence analyst for a UK service business.
Analyze this customer's conversation history and generate a profile.

Return JSON:
{
  "summary": "1-2 sentence customer profile",
  "communication_patterns": {
    "tone": "formal" | "casual" | "friendly",
    "message_length": "short" | "medium" | "long",
    "typical_response_time": "fast" | "moderate" | "slow"
  },
  "topics_discussed": ["topic1", "topic2"],
  "insights": [
    {
      "type": "opportunity" | "risk" | "preference" | "behavior",
      "description": "Insight text",
      "confidence": 0.0-1.0
    }
  ],
  "lifetime_value_estimate": "high" | "medium" | "low" | "unknown",
  "sentiment": "positive" | "negative" | "neutral"
}

IMPORTANT: Return ONLY valid JSON. No markdown, no backticks, no explanation.`;

    const userPrompt = `Customer: ${customer.name || 'Unknown'} (${customer.email || 'no email'})
Channel: ${conversation.channel}
Subject: ${conversation.title || 'No subject'}
Category: ${conversation.category || 'uncategorized'}
Existing topics: ${(customer.topics_discussed || []).join(', ') || 'none'}

Conversation thread:
${threadText}`;

    const aiResponse = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('[ai-enrich] AI gateway error:', aiResponse.status, errText);
      return new Response(JSON.stringify({ error: 'AI call failed', status: aiResponse.status }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const aiData = await aiResponse.json();
    const rawText = aiData.choices?.[0]?.message?.content || '';

    // Parse JSON response
    let enrichment: any;
    try {
      const cleanJson = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      enrichment = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('[ai-enrich] Failed to parse AI response:', rawText.substring(0, 300));
      return new Response(JSON.stringify({ error: 'AI response parse failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 6. Update customers table with intelligence
    const existingIntel = (customer.intelligence || {}) as Record<string, any>;
    const existingTopics = customer.topics_discussed || [];
    const newTopics = enrichment.topics_discussed || [];
    const mergedTopics = [...new Set([...existingTopics, ...newTopics])].slice(0, 15);

    const intelligencePayload = {
      summary: enrichment.summary || existingIntel.summary || null,
      communication_patterns: enrichment.communication_patterns || existingIntel.communication_patterns || null,
      lifetime_value_estimate: enrichment.lifetime_value_estimate || existingIntel.lifetime_value_estimate || null,
      last_analyzed_at: new Date().toISOString(),
    };

    await supabase
      .from('customers')
      .update({
        intelligence: intelligencePayload,
        sentiment_trend: enrichment.sentiment || customer.sentiment_trend || 'neutral',
        topics_discussed: mergedTopics,
        last_analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', resolvedCustomerId);

    // 7. Upsert insights into customer_insights
    if (enrichment.insights && Array.isArray(enrichment.insights)) {
      for (const insight of enrichment.insights) {
        await supabase
          .from('customer_insights')
          .insert({
            customer_id: resolvedCustomerId,
            workspace_id: workspace_id,
            insight_type: insight.type || 'behavior',
            insight_text: insight.description || '',
            confidence: insight.confidence || null,
          });
      }
    }

    const processingTime = Date.now() - startTime;
    console.log(`[ai-enrich] Customer ${resolvedCustomerId} enriched in ${processingTime}ms`);

    return new Response(JSON.stringify({
      status: 'enriched',
      processing_time_ms: processingTime,
      intelligence: intelligencePayload,
      topics: mergedTopics,
      insights_count: enrichment.insights?.length || 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ai-enrich] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
