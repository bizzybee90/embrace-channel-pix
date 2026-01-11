import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface IntelligenceRequest {
  workspace_id: string;
  customer_id?: string;
  action: 'analyze' | 'refresh_all' | 'get_insights';
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
    console.log(`[${functionName}] Starting:`, body);

    if (!body.workspace_id) throw new Error('workspace_id is required');
    if (!body.action) throw new Error('action is required');

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    let result: any;

    switch (body.action) {
      case 'analyze': {
        if (!body.customer_id) throw new Error('customer_id required for analyze');
        
        // Fetch customer's conversation history
        const { data: conversations, error: convError } = await supabase
          .from('conversations')
          .select(`
            id,
            title,
            status,
            priority,
            ai_sentiment,
            category,
            created_at
          `)
          .eq('customer_id', body.customer_id)
          .order('created_at', { ascending: false })
          .limit(50);

        if (convError) throw new Error(`Failed to fetch conversations: ${convError.message}`);
        if (!conversations || conversations.length === 0) {
          return new Response(
            JSON.stringify({ success: true, message: 'No conversations to analyze' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get messages for these conversations
        const conversationIds = conversations.map(c => c.id);
        const { data: messages } = await supabase
          .from('messages')
          .select('conversation_id, body, direction, created_at')
          .in('conversation_id', conversationIds)
          .order('created_at', { ascending: false })
          .limit(200);

        // Group messages by conversation
        const messagesByConv: Record<string, any[]> = {};
        (messages || []).forEach(m => {
          if (!messagesByConv[m.conversation_id]) {
            messagesByConv[m.conversation_id] = [];
          }
          messagesByConv[m.conversation_id].push(m);
        });

        // Prepare conversation summary for AI
        const conversationSummary = conversations.slice(0, 20).map(conv => {
          const convMessages = messagesByConv[conv.id]?.slice(0, 5) || [];
          return `Subject: ${conv.title || 'No subject'}
Status: ${conv.status}
Priority: ${conv.priority}
Category: ${conv.category || 'uncategorized'}
Sentiment: ${conv.ai_sentiment || 'unknown'}
Messages: ${convMessages.map(m => `[${m.direction}] ${m.body?.slice(0, 200)}`).join('\n')}`;
        }).join('\n---\n');

        // Analyze with Gemini
        const analysisPrompt = `Analyze this customer's email history and extract insights:

${conversationSummary}

Provide a JSON response with:
{
  "lifetime_value_estimate": "low/medium/high/vip based on engagement",
  "sentiment_trend": "positive/neutral/negative/declining",
  "response_preference": "formal/casual/brief/detailed based on their messages",
  "topics_discussed": ["array", "of", "main", "topics"],
  "communication_patterns": {
    "typical_response_time": "immediate/same-day/slow",
    "message_length": "brief/moderate/detailed",
    "tone": "professional/friendly/demanding/appreciative"
  },
  "insights": [
    {
      "type": "behavior/preference/risk/opportunity",
      "text": "specific insight",
      "confidence": 0.0-1.0
    }
  ],
  "summary": "2-3 sentence summary of this customer"
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
              { role: 'system', content: 'You are a customer intelligence analyst. Analyze email patterns to understand customers. Respond with valid JSON only.' },
              { role: 'user', content: analysisPrompt }
            ],
            temperature: 0.3
          })
        });

        if (!aiResponse.ok) throw new Error(`AI error: ${await aiResponse.text()}`);

        const aiData = await aiResponse.json();
        const analysisText = aiData.choices?.[0]?.message?.content || '';
        
        let analysis;
        try {
          const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(jsonMatch?.[0] || '{}');
        } catch {
          throw new Error('Failed to parse AI analysis');
        }

        // Update customer record
        const { error: updateError } = await supabase
          .from('customers')
          .update({
            intelligence: analysis,
            lifetime_value: analysis.lifetime_value_estimate === 'vip' ? 10000 : 
                           analysis.lifetime_value_estimate === 'high' ? 5000 :
                           analysis.lifetime_value_estimate === 'medium' ? 1000 : 100,
            sentiment_trend: analysis.sentiment_trend,
            response_preference: analysis.response_preference,
            topics_discussed: analysis.topics_discussed,
            vip_status: analysis.lifetime_value_estimate === 'vip',
            last_analyzed_at: new Date().toISOString()
          })
          .eq('id', body.customer_id);

        if (updateError) throw new Error(`Failed to update customer: ${updateError.message}`);

        // Store insights
        if (analysis.insights?.length > 0) {
          const insights = analysis.insights.map((i: any) => ({
            customer_id: body.customer_id,
            workspace_id: body.workspace_id,
            insight_type: i.type,
            insight_text: i.text,
            confidence: i.confidence,
            source_conversations: conversations.slice(0, 10).map(c => c.id)
          }));

          await supabase.from('customer_insights').insert(insights);
        }

        result = { 
          customer_id: body.customer_id,
          analysis,
          conversations_analyzed: conversations.length
        };
        break;
      }

      case 'refresh_all': {
        // Get customers who haven't been analyzed recently
        const { data: customers } = await supabase
          .from('customers')
          .select('id')
          .eq('workspace_id', body.workspace_id)
          .or('last_analyzed_at.is.null,last_analyzed_at.lt.' + 
              new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .limit(20);

        const analyzed = [];
        for (const customer of customers || []) {
          try {
            // Recursive call to analyze each
            const { data } = await supabase.functions.invoke('customer-intelligence', {
              body: { workspace_id: body.workspace_id, customer_id: customer.id, action: 'analyze' }
            });
            analyzed.push(customer.id);
          } catch (e) {
            console.error(`Failed to analyze ${customer.id}:`, e);
          }
        }

        result = { refreshed: analyzed.length, customers: analyzed };
        break;
      }

      case 'get_insights': {
        const query = supabase
          .from('customer_insights')
          .select('*, customer:customers(name, email)')
          .eq('workspace_id', body.workspace_id)
          .order('created_at', { ascending: false })
          .limit(50);

        if (body.customer_id) {
          query.eq('customer_id', body.customer_id);
        }

        const { data: insights, error } = await query;
        if (error) throw error;

        result = { insights };
        break;
      }

      default:
        throw new Error(`Unknown action: ${body.action}`);
    }

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify({ success: true, ...result, duration_ms: duration }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[${functionName}] Error:`, error);
    return new Response(
      JSON.stringify({ success: false, error: error.message, function: functionName }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});