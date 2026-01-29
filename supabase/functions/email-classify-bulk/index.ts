import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * BULK EMAIL CLASSIFIER - Simplified Pipeline
 * 
 * Sends ALL unclassified emails to Gemini in ONE call using Lovable AI gateway.
 * Gemini 2.5 Flash has 1M token context window.
 * 30,000 emails × 250 chars = 7.5M chars = ~2M tokens. Fits easily.
 * 
 * On completion, triggers voice-learning to build the voice profile.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash'; // Fast, cheap, 1M token context

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspace_id } = await req.json();
    
    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const startTime = Date.now();

    console.log(`[email-classify-bulk] Starting for workspace ${workspace_id}`);

    // Update progress to classifying phase
    await supabase
      .from('email_import_progress')
      .upsert({
        workspace_id,
        current_phase: 'classifying',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

    // ==========================================================================
    // STEP 1: Fetch ALL unclassified emails in ONE query
    // ==========================================================================
    const { data: emails, error: fetchError } = await supabase
      .from('email_import_queue')
      .select('id, from_email, subject, body, direction')
      .eq('workspace_id', workspace_id)
      .is('category', null) // Not yet classified
      .order('id', { ascending: true })
      .limit(50000); // Safety limit

    if (fetchError) throw fetchError;

    if (!emails || emails.length === 0) {
      console.log(`[email-classify-bulk] No emails to classify, triggering voice-learn`);
      
      // Update progress and trigger voice learning
      await supabase
        .from('email_import_progress')
        .upsert({
          workspace_id,
          current_phase: 'learning',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id' });

      // Trigger voice learning
      await triggerVoiceLearning(supabaseUrl, supabaseServiceKey, workspace_id);

      return new Response(JSON.stringify({ 
        success: true, 
        status: 'no_work',
        message: 'No emails to classify, triggered voice learning' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[email-classify-bulk] Found ${emails.length} emails to classify`);

    // ==========================================================================
    // STEP 2: Build ONE prompt with ALL emails
    // ==========================================================================
    // Format: index|direction|from|subject|snippet (compact to maximize emails per call)
    const emailLines = emails.map((e, i) => {
      const dir = e.direction === 'outbound' ? 'OUT' : 'IN';
      const subject = (e.subject || '(none)').substring(0, 100).replace(/[\n\r|]/g, ' ');
      const snippet = (e.body || '').substring(0, 150).replace(/[\n\r|]/g, ' ');
      const from = (e.from_email || 'unknown').substring(0, 50);
      return `${i}|${dir}|${from}|${subject}|${snippet}`;
    }).join('\n');

    const prompt = `You are classifying emails for a small business. Classify each email into ONE category.

Categories:
- inquiry: Questions about services/products/availability
- booking: Appointment/booking/scheduling requests
- quote: Price/quote/estimate requests
- complaint: Issues/problems/negative feedback
- follow_up: Replies to previous conversations
- spam: Marketing, promotions, newsletters, unwanted mass emails
- notification: Automated system notifications (receipts, confirmations, shipping alerts, calendar invites)
- personal: Personal/social messages from friends/family

Return ONLY a JSON array. Format: [{"i":0,"c":"inquiry","r":true},{"i":1,"c":"spam","r":false}]
Where: i=index (integer), c=category (string), r=requires_reply (boolean)

Rules for requires_reply:
- spam, notification: ALWAYS false
- complaint, inquiry, quote, booking: ALWAYS true (customer needs response)
- follow_up: true if asking a question, false if just acknowledging/thanking
- personal: true if asking something, false otherwise
- outbound emails (OUT): ALWAYS false (you sent it, no need to reply to yourself)

Return ONLY valid JSON. No markdown. No explanation. Just the array.

EMAILS (${emails.length} total, format: index|direction|from|subject|snippet):
${emailLines}`;

    // Calculate approximate token count
    const estimatedTokens = Math.ceil(prompt.length / 4);
    console.log(`[email-classify-bulk] Prompt size: ${prompt.length} chars, ~${estimatedTokens} tokens`);

    // ==========================================================================
    // STEP 3: ONE Lovable AI Gateway call
    // ==========================================================================
    console.log(`[email-classify-bulk] Calling Lovable AI Gateway (${MODEL})...`);
    
    const response = await fetch(LOVABLE_AI_GATEWAY, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 65536, // Max output for classifications
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[email-classify-bulk] AI Gateway error:`, errorText);
      throw new Error(`AI Gateway error: ${response.status} - ${errorText}`);
    }

    const aiData = await response.json();
    const responseText = aiData.choices?.[0]?.message?.content || '';
    
    console.log(`[email-classify-bulk] Got response, length: ${responseText.length} chars`);

    // ==========================================================================
    // STEP 4: Parse classifications
    // ==========================================================================
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array in AI response');
    }

    let classifications: Array<{ i: number; c: string; r: boolean }>;
    try {
      classifications = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error(`[email-classify-bulk] JSON parse error:`, parseErr);
      throw new Error('Failed to parse AI response as JSON');
    }

    console.log(`[email-classify-bulk] Parsed ${classifications.length} classifications`);

    // ==========================================================================
    // STEP 5: Bulk update all emails with category and requires_reply
    // ==========================================================================
    const classMap = new Map<number, { c: string; r: boolean }>();
    for (const cl of classifications) {
      classMap.set(cl.i, { c: cl.c, r: cl.r });
    }

    // Batch update in chunks of 500 for database efficiency
    const BATCH_SIZE = 500;
    let updated = 0;
    let failed = 0;
    const now = new Date().toISOString();

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      
      // Build individual updates (Supabase upsert with specific columns)
      const updates = batch.map((email, batchIndex) => {
        const globalIndex = i + batchIndex;
        const classification = classMap.get(globalIndex);
        
        return {
          id: email.id,
          category: classification?.c || 'unknown',
          requires_reply: classification?.r || false,
          classified_at: now,
          status: 'processed',
          processed_at: now,
        };
      });

      // Use upsert for bulk update
      const { error: updateError } = await supabase
        .from('email_import_queue')
        .upsert(updates, { onConflict: 'id' });

      if (updateError) {
        console.error(`[email-classify-bulk] Batch update error:`, updateError);
        failed += batch.length;
      } else {
        updated += batch.length;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[email-classify-bulk] Complete: ${updated} emails classified in ${elapsed}ms (${failed} failed)`);

    // ==========================================================================
    // STEP 6: Update progress and trigger voice learning
    // ==========================================================================
    await supabase
      .from('email_import_progress')
      .upsert({
        workspace_id,
        current_phase: 'learning',
        emails_classified: updated,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

    // Trigger voice learning
    await triggerVoiceLearning(supabaseUrl, supabaseServiceKey, workspace_id);

    return new Response(JSON.stringify({
      success: true,
      emails_total: emails.length,
      emails_classified: updated,
      emails_failed: failed,
      elapsed_ms: elapsed,
      api_calls: 1, // THE KEY METRIC - just ONE call!
      chained_to: 'voice-learning',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[email-classify-bulk] Error:', error);
    
    // Update progress with error
    try {
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const body = await req.clone().json().catch(() => ({}));
      if (body.workspace_id) {
        await supabase
          .from('email_import_progress')
          .upsert({
            workspace_id: body.workspace_id,
            current_phase: 'error',
            last_error: error instanceof Error ? error.message : 'Classification failed',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'workspace_id' });
      }
    } catch (e) {
      // Ignore
    }
    
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// =============================================================================
// Trigger voice learning after classification completes
// =============================================================================
async function triggerVoiceLearning(
  supabaseUrl: string,
  supabaseServiceKey: string,
  workspace_id: string
): Promise<void> {
  try {
    const functionUrl = `${supabaseUrl}/functions/v1/voice-learning`;
    
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ workspace_id }),
    });

    if (!response.ok) {
      console.error(`[email-classify-bulk] Failed to trigger voice-learning: ${response.status}`);
    } else {
      console.log(`[email-classify-bulk] Triggered voice-learning for workspace ${workspace_id}`);
    }
  } catch (e) {
    console.error(`[email-classify-bulk] Error triggering voice-learning:`, e);
  }
}
