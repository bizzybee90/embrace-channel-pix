import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RetriagetFilter {
  status?: string;
  date_from?: string;
  date_to?: string;
}

interface RetriagetRequest {
  workspace_id: string;
  filter?: RetriagetFilter;
  batch_size?: number;
}

interface ClassificationResult {
  intent: string;
  priority: string;
  lane: string;
  sentiment: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'bulk-retriage';
  let step = 'initializing';

  try {
    // Auth validation
    const { validateAuth, AuthError, authErrorResponse } = await import('../_shared/auth.ts');
    let bodyRaw: any;
    try {
      bodyRaw = await req.clone().json();
    } catch { bodyRaw = {}; }
    try {
      await validateAuth(req, bodyRaw.workspace_id);
    } catch (authErr: any) {
      if (authErr instanceof AuthError) return authErrorResponse(authErr);
      throw authErr;
    }

    // Validate environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!supabaseUrl) throw new Error('SUPABASE_URL environment variable not configured');
    if (!supabaseKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable not configured');
    if (!lovableApiKey) throw new Error('LOVABLE_API_KEY environment variable not configured');

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse and validate input
    step = 'validating_input';
    const body: RetriagetRequest = bodyRaw;
    console.log(`[${functionName}] Starting:`, { 
      workspace_id: body.workspace_id, 
      filter: body.filter,
      batch_size: body.batch_size
    });

    if (!body.workspace_id) {
      throw new Error('workspace_id is required');
    }

    const batchSize = body.batch_size || 50;
    if (batchSize < 1 || batchSize > 100) {
      throw new Error('batch_size must be between 1 and 100');
    }

    // Build query with filters
    step = 'fetching_conversations';
    let query = supabase
      .from('conversations')
      .select(`
        id,
        subject,
        status,
        intent,
        priority,
        lane,
        created_at,
        customer:customers(id, email, name),
        messages(id, body, direction, created_at)
      `)
      .eq('workspace_id', body.workspace_id)
      .order('created_at', { ascending: false })
      .limit(batchSize);

    // Apply optional filters
    if (body.filter?.status) {
      query = query.eq('status', body.filter.status);
    }
    if (body.filter?.date_from) {
      query = query.gte('created_at', body.filter.date_from);
    }
    if (body.filter?.date_to) {
      query = query.lte('created_at', body.filter.date_to);
    }

    const { data: conversations, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch conversations: ${fetchError.message}`);
    }

    if (!conversations || conversations.length === 0) {
      console.log(`[${functionName}] No conversations found matching filters`);
      return new Response(
        JSON.stringify({
          success: true,
          retriaged: 0,
          message: 'No conversations found matching the specified filters',
          duration_ms: Date.now() - startTime
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[${functionName}] Found ${conversations.length} conversations to retriage`);

    // Prepare conversations for AI classification
    step = 'preparing_classification';
    const conversationsForAI = conversations.map((conv: any) => {
      const messages = conv.messages || [];
      messages.sort((a: any, b: any) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      const messagesSummary = messages.slice(0, 5).map((m: any) => 
        `[${m.direction}]: ${m.body?.substring(0, 200) || '(empty)'}`
      ).join('\n');

      return {
        id: conv.id,
        subject: conv.subject || '(no subject)',
        customer_email: conv.customer?.email || 'unknown',
        customer_name: conv.customer?.name || 'unknown',
        messages: messagesSummary,
        current_intent: conv.intent,
        current_priority: conv.priority,
        current_lane: conv.lane
      };
    });

    // Call AI for classification
    step = 'classifying_with_ai';
    const classificationPrompt = `You are classifying customer service conversations for a UK service business.

For each conversation below, analyze the messages and provide:
- intent: quote_request | booking | complaint | question | feedback | spam | follow_up | thank_you | other
- priority: high | medium | low
- lane: inbox | waiting | resolved
- sentiment: positive | neutral | negative

Classification rules:
- HIGH priority: Complaints, urgent bookings, unhappy customers
- MEDIUM priority: Quote requests, general questions
- LOW priority: Thank you messages, spam, already resolved

- INBOX lane: Needs immediate action/response
- WAITING lane: Waiting for customer reply or external action
- RESOLVED lane: No further action needed (thank you, confirmed bookings, spam)

Respond with ONLY a JSON array, no other text:
[{"id": "conversation_id", "intent": "...", "priority": "...", "lane": "...", "sentiment": "..."}]

CONVERSATIONS TO CLASSIFY:
${JSON.stringify(conversationsForAI, null, 2)}`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: classificationPrompt }],
        max_tokens: 4000
      })
    });

    if (!aiResponse.ok) {
      const errorBody = await aiResponse.text();
      throw new Error(`AI Gateway error ${aiResponse.status}: ${errorBody}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content;

    if (!aiContent) {
      throw new Error('AI returned empty response');
    }

    // Parse AI response
    step = 'parsing_ai_response';
    let classifications: Array<{ id: string } & ClassificationResult>;
    try {
      // Handle potential markdown code blocks
      const cleanContent = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      classifications = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error(`[${functionName}] Failed to parse AI response:`, aiContent);
      throw new Error(`Failed to parse AI classification response: ${parseError}`);
    }

    if (!Array.isArray(classifications)) {
      throw new Error('AI response is not an array');
    }

    console.log(`[${functionName}] AI classified ${classifications.length} conversations`);

    // Update conversations in database
    step = 'updating_conversations';
    let updated = 0;
    let unchanged = 0;
    const errors: string[] = [];

    for (const classification of classifications) {
      const original = conversations.find((c: any) => c.id === classification.id);
      
      // Skip if nothing changed
      if (original && 
          original.intent === classification.intent && 
          original.priority === classification.priority && 
          original.lane === classification.lane) {
        unchanged++;
        continue;
      }

      const { error: updateError } = await supabase
        .from('conversations')
        .update({
          intent: classification.intent,
          priority: classification.priority,
          lane: classification.lane,
          updated_at: new Date().toISOString()
        })
        .eq('id', classification.id)
        .eq('workspace_id', body.workspace_id);

      if (updateError) {
        errors.push(`Failed to update ${classification.id}: ${updateError.message}`);
        console.error(`[${functionName}] Update error for ${classification.id}:`, updateError);
      } else {
        updated++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms:`, {
      total: conversations.length,
      updated,
      unchanged,
      errors: errors.length
    });

    return new Response(
      JSON.stringify({
        success: true,
        retriaged: updated,
        unchanged,
        total_processed: conversations.length,
        errors: errors.length > 0 ? errors : undefined,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[${functionName}] Error at step "${step}":`, error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: functionName,
        step,
        duration_ms: duration
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
