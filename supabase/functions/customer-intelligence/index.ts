import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface IntelligenceRequest {
  workspace_id: string;
  customer_id: string;
  action: 'analyze' | 'refresh' | 'get';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'customer-intelligence';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body: IntelligenceRequest = await req.json();
    console.log(`[${functionName}] Request:`, body);

    if (!body.workspace_id) throw new Error('workspace_id is required');
    if (!body.customer_id) throw new Error('customer_id is required');

    const action = body.action || 'analyze';

    // Get customer data
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', body.customer_id)
      .eq('workspace_id', body.workspace_id)
      .single();

    if (customerError || !customer) {
      throw new Error('Customer not found');
    }

    // If just getting existing intelligence, return early
    if (action === 'get') {
      const { data: insights } = await supabase
        .from('customer_insights')
        .select('*')
        .eq('customer_id', body.customer_id)
        .order('created_at', { ascending: false })
        .limit(10);

      return new Response(
        JSON.stringify({
          success: true,
          customer: {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            intelligence: customer.intelligence,
            lifetime_value: customer.lifetime_value,
            sentiment_trend: customer.sentiment_trend,
            topics_discussed: customer.topics_discussed,
            vip_status: customer.vip_status,
            last_analyzed_at: customer.last_analyzed_at
          },
          insights: insights || []
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get customer's conversation history
    const { data: conversations } = await supabase
      .from('conversations')
      .select('id, title, summary_for_human, category, priority, ai_sentiment, created_at, status, urgency')
      .eq('customer_id', body.customer_id)
      .order('created_at', { ascending: false })
      .limit(50);

    // Get messages from those conversations
    const conversationIds = conversations?.map(c => c.id) || [];
    let messages: any[] = [];
    if (conversationIds.length > 0) {
      const { data: msgData } = await supabase
        .from('messages')
        .select('id, conversation_id, body, direction, actor_type, created_at')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: false })
        .limit(200);
      messages = msgData || [];
    }

    // Prepare context for AI analysis
    const conversationSummaries = conversations?.slice(0, 20).map(c => ({
      category: c.category,
      sentiment: c.ai_sentiment,
      priority: c.priority,
      summary: c.summary_for_human,
      date: c.created_at
    })) || [];

    const customerMessages = messages
      .filter(m => m.direction === 'inbound')
      .slice(0, 50)
      .map(m => m.body)
      .join('\n---\n');

    // Analyze with AI
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const analysisPrompt = `Analyze this customer's communication history and create a detailed profile.

## CUSTOMER INFO
Name: ${customer.name || 'Unknown'}
Email: ${customer.email || 'Unknown'}
Phone: ${customer.phone || 'Unknown'}
Total Conversations: ${conversations?.length || 0}

## CONVERSATION HISTORY (most recent first)
${JSON.stringify(conversationSummaries, null, 2)}

## SAMPLE CUSTOMER MESSAGES
${customerMessages.slice(0, 3000)}

---

Create a comprehensive customer intelligence profile. Return JSON:
{
  "personality_traits": ["trait1", "trait2"],
  "communication_style": "brief|detailed|formal|casual|urgent",
  "preferred_response_style": "description of how to best respond to this customer",
  "key_topics": ["topic1", "topic2"],
  "sentiment_trend": "positive|neutral|negative|improving|declining",
  "engagement_level": "high|medium|low",
  "vip_indicators": ["reason1", "reason2"],
  "is_vip": true|false,
  "potential_concerns": ["concern1"],
  "opportunities": ["opportunity1"],
  "insights": [
    {
      "type": "behavior|preference|need|risk|opportunity",
      "text": "specific insight about the customer",
      "confidence": 0.0-1.0
    }
  ],
  "recommended_approach": "summary of best way to handle this customer"
}`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { 
            role: 'system', 
            content: 'You are a customer intelligence analyst. Analyze communication patterns and create actionable customer profiles. Return valid JSON only.' 
          },
          { role: 'user', content: analysisPrompt }
        ],
        temperature: 0.3
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`AI Gateway error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const analysisText = aiData.choices?.[0]?.message?.content || '';

    // Parse AI response
    let analysis;
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      analysis = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`[${functionName}] Failed to parse analysis:`, analysisText);
      analysis = {
        sentiment_trend: 'neutral',
        communication_style: 'unknown',
        is_vip: false,
        insights: []
      };
    }

    console.log(`[${functionName}] Analysis complete:`, {
      sentiment: analysis.sentiment_trend,
      is_vip: analysis.is_vip,
      insights_count: analysis.insights?.length || 0
    });

    // Update customer record
    const { error: updateError } = await supabase
      .from('customers')
      .update({
        intelligence: {
          personality_traits: analysis.personality_traits,
          communication_style: analysis.communication_style,
          preferred_response_style: analysis.preferred_response_style,
          engagement_level: analysis.engagement_level,
          recommended_approach: analysis.recommended_approach,
          potential_concerns: analysis.potential_concerns,
          opportunities: analysis.opportunities
        },
        sentiment_trend: analysis.sentiment_trend,
        topics_discussed: analysis.key_topics || [],
        vip_status: analysis.is_vip || false,
        last_analyzed_at: new Date().toISOString()
      })
      .eq('id', body.customer_id);

    if (updateError) {
      console.error(`[${functionName}] Failed to update customer:`, updateError);
    }

    // Store individual insights
    if (analysis.insights && analysis.insights.length > 0) {
      const insightsToStore = analysis.insights.map((insight: any) => ({
        customer_id: body.customer_id,
        workspace_id: body.workspace_id,
        insight_type: insight.type,
        insight_text: insight.text,
        confidence: insight.confidence,
        source_conversations: conversationIds.slice(0, 10),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
      }));

      const { error: insightError } = await supabase
        .from('customer_insights')
        .insert(insightsToStore);

      if (insightError) {
        console.error(`[${functionName}] Failed to store insights:`, insightError);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        analysis: {
          ...analysis,
          conversations_analyzed: conversations?.length || 0,
          messages_analyzed: messages.length
        },
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[${functionName}] Error:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: functionName,
        duration_ms: Date.now() - startTime
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
