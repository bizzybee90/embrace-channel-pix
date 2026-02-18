import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { conversation_id, workspace_id } = await req.json();

    if (!conversation_id || !workspace_id) {
      return new Response(JSON.stringify({ error: 'Missing conversation_id or workspace_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch conversation + customer + messages
    const { data: conversation } = await supabase
      .from('conversations')
      .select('*, customer:customers(name, email, vip_status, sentiment_trend, intelligence)')
      .eq('id', conversation_id)
      .single();

    if (!conversation) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: messages } = await supabase
      .from('messages')
      .select('body, direction, actor_name, created_at')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: true })
      .limit(10);

    if (!messages || messages.length === 0) {
      console.log('No messages found for conversation:', conversation_id);
      return new Response(JSON.stringify({ status: 'no_messages' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Fetch relevant FAQs for draft context
    const { data: faqs } = await supabase
      .from('faqs')
      .select('question, answer')
      .eq('workspace_id', workspace_id)
      .eq('is_active', true)
      .limit(10);

    // 3. Fetch workspace context
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name, industry, business_context')
      .eq('id', workspace_id)
      .single();

    // 4. Build the conversation thread text
    const threadText = messages.map(m =>
      `[${m.direction === 'inbound' ? 'CUSTOMER' : 'BUSINESS'}] ${m.actor_name || 'Unknown'}: ${(m.body || '').substring(0, 500)}`
    ).join('\n\n');

    const customerName = conversation.customer?.name || 'Unknown Customer';
    const customerEmail = conversation.customer?.email || '';
    const businessName = workspace?.name || 'the business';

    // 5. Build FAQ context for drafting
    const faqContext = (faqs && faqs.length > 0)
      ? `\nRelevant FAQs for this business:\n${faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}`
      : '';

    // 6. Single AI call - Claude Haiku generates everything
    const systemPrompt = `You are an AI assistant for ${businessName}, a UK-based service business. Analyze the email conversation and return a JSON object with these exact fields:

1. "summary" - A 1-2 sentence summary of what this conversation is about. Be specific.
2. "decision_bucket" - One of: "act_now" (urgent/complaint/cancellation), "quick_win" (simple reply needed), "wait" (FYI only, no action needed), "auto_handled" (newsletter/receipt/notification)
3. "why_this_needs_you" - A brief human-readable explanation of WHY this email needs attention (or why it doesn't). Be specific to the content.
4. "classification" - One of: "booking_request", "booking_change", "booking_cancellation", "quote_request", "complaint", "payment_query", "general_inquiry", "marketing_newsletter", "automated_notification", "receipt_confirmation", "spam", "other"
5. "requires_reply" - boolean, true if the customer is expecting a response
6. "sentiment" - One of: "positive", "negative", "neutral"
7. "urgency" - One of: "high", "medium", "low"
8. "draft_response" - If requires_reply is true, write a professional, friendly reply from ${businessName}. Match a warm but professional UK tone. Keep it concise. If requires_reply is false, set this to null.
9. "customer_insight" - A brief note about this customer's needs or pattern (e.g., "Regular customer checking on appointment", "New inquiry about pricing", "Frustrated about missed service")

${faqContext}

IMPORTANT: Return ONLY valid JSON. No markdown, no backticks, no explanation.`;

    const userPrompt = `Email subject: ${conversation.title || 'No subject'}
Customer: ${customerName} (${customerEmail})

Conversation thread:
${threadText}`;

    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1000,
        messages: [
          { role: 'user', content: userPrompt }
        ],
        system: systemPrompt,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('Anthropic API error:', aiResponse.status, errText);
      return new Response(JSON.stringify({ error: 'AI call failed', status: aiResponse.status }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const aiData = await aiResponse.json();
    const rawText = aiData.content?.[0]?.text || '';

    // Parse JSON response, handling potential markdown wrapping
    let enrichment;
    try {
      const cleanJson = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      enrichment = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('Failed to parse AI response:', rawText.substring(0, 200));
      return new Response(JSON.stringify({ error: 'AI response parse failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 7. Write everything back to the conversation in ONE update
    const updatePayload: Record<string, any> = {
      summary_for_human: enrichment.summary || null,
      ai_sentiment: enrichment.sentiment || null,
      ai_reason_for_escalation: enrichment.why_this_needs_you || null,
      email_classification: enrichment.classification || null,
      requires_reply: enrichment.requires_reply ?? true,
      ai_draft_response: enrichment.draft_response || null,
      ai_confidence: 0.85,
    };

    // Only override pre-triage decision_bucket if pre-triage didn't set one
    if (!conversation.decision_bucket || conversation.decision_bucket === 'wait') {
      updatePayload.decision_bucket = enrichment.decision_bucket || 'wait';
      updatePayload.why_this_needs_you = enrichment.why_this_needs_you || null;
    }

    // Add urgency if column exists
    if (enrichment.urgency) {
      updatePayload.urgency = enrichment.urgency;
    }

    const { error: updateError } = await supabase
      .from('conversations')
      .update(updatePayload)
      .eq('id', conversation_id);

    if (updateError) {
      console.error('Failed to update conversation:', updateError);
      // Try with fewer fields in case some columns don't exist
      const safePayload = {
        summary_for_human: enrichment.summary || null,
        ai_sentiment: enrichment.sentiment || null,
        requires_reply: enrichment.requires_reply ?? true,
        ai_draft_response: enrichment.draft_response || null,
      };
      await supabase
        .from('conversations')
        .update(safePayload)
        .eq('id', conversation_id);
    }

    // 8. Update customer intelligence if we have a customer
    if (conversation.customer_id && enrichment.customer_insight) {
      const existingIntel = conversation.customer?.intelligence || {};
      await supabase
        .from('customers')
        .update({
          sentiment_trend: enrichment.sentiment || null,
          intelligence: {
            ...existingIntel,
            last_insight: enrichment.customer_insight,
            last_analyzed_at: new Date().toISOString(),
          },
          last_analyzed_at: new Date().toISOString(),
        })
        .eq('id', conversation.customer_id);
    }

    const processingTime = Date.now() - startTime;
    console.log(`[ai-enrich] Conversation ${conversation_id} enriched in ${processingTime}ms`);

    return new Response(JSON.stringify({
      status: 'enriched',
      processing_time_ms: processingTime,
      summary: enrichment.summary,
      decision_bucket: enrichment.decision_bucket,
      has_draft: !!enrichment.draft_response,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ai-enrich] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
