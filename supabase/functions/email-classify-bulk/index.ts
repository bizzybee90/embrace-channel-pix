import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * BULK EMAIL CLASSIFIER - Simplified Pipeline
 * 
 * Sends emails to Gemini in batches of 5000 (to handle Supabase row limits).
 * Uses .range() to bypass 1000-row default limit.
 * Self-invokes until all emails are classified, then triggers voice-learning.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash'; // Fast, cheap, 1M token context
const BATCH_SIZE = 5000; // Process 5000 emails per invocation (Supabase range limit)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspace_id, _batch_number = 0 } = await req.json();
    
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

    console.log(`[email-classify-bulk] Starting batch ${_batch_number} for workspace ${workspace_id}`);

    // Update progress to classifying phase
    await supabase
      .from('email_import_progress')
      .upsert({
        workspace_id,
        current_phase: 'classifying',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

    // ==========================================================================
    // STEP 1: Fetch batch of unclassified emails using .range() to bypass 1000 limit
    // ==========================================================================
    const rangeStart = 0; // Always start from 0 since we're filtering by category IS NULL
    const rangeEnd = BATCH_SIZE - 1;
    
    const { data: emails, error: fetchError } = await supabase
      .from('email_import_queue')
      .select('id, from_email, subject, body, direction')
      .eq('workspace_id', workspace_id)
      .is('category', null) // Not yet classified
      .order('id', { ascending: true })
      .range(rangeStart, rangeEnd);

    if (fetchError) throw fetchError;

    if (!emails || emails.length === 0) {
      console.log(`[email-classify-bulk] No more emails to classify, triggering voice-learn`);
      
      // Get total classified count
      const { count: totalClassified } = await supabase
        .from('email_import_queue')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace_id)
        .not('category', 'is', null);
      
      // Update progress and trigger voice learning
      await supabase
        .from('email_import_progress')
        .upsert({
          workspace_id,
          current_phase: 'learning',
          emails_classified: totalClassified || 0,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id' });

      // Trigger voice learning
      await triggerVoiceLearning(supabaseUrl, supabaseServiceKey, workspace_id);

      return new Response(JSON.stringify({ 
        success: true, 
        status: 'complete',
        total_classified: totalClassified,
        message: 'All emails classified, triggered voice learning' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[email-classify-bulk] Found ${emails.length} emails to classify in batch ${_batch_number}`);

    // ==========================================================================
    // STEP 2: Build prompt with batch of emails
    // ==========================================================================
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

    const estimatedTokens = Math.ceil(prompt.length / 4);
    console.log(`[email-classify-bulk] Prompt size: ${prompt.length} chars, ~${estimatedTokens} tokens`);

    // ==========================================================================
    // STEP 3: Call Lovable AI Gateway
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
        max_tokens: 65536,
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
    // STEP 5: Bulk update emails - parallel updates for speed
    // ==========================================================================
    const classMap = new Map<number, { c: string; r: boolean }>();
    for (const cl of classifications) {
      classMap.set(cl.i, { c: cl.c, r: cl.r });
    }

    const now = new Date().toISOString();
    let updated = 0;
    let failed = 0;

    // Build all update promises
    const updatePromises = emails.map(async (email, index) => {
      const classification = classMap.get(index);
      const { error } = await supabase
        .from('email_import_queue')
        .update({
          category: classification?.c || 'unknown',
          requires_reply: classification?.r || false,
          classified_at: now,
          status: 'processed',
          processed_at: now,
        })
        .eq('id', email.id);
      
      return { success: !error, id: email.id };
    });

    // Execute in batches of 50 to avoid overwhelming the DB
    const PARALLEL_BATCH = 50;
    for (let i = 0; i < updatePromises.length; i += PARALLEL_BATCH) {
      const batch = updatePromises.slice(i, i + PARALLEL_BATCH);
      const results = await Promise.all(batch);
      updated += results.filter(r => r.success).length;
      failed += results.filter(r => !r.success).length;
    }

    console.log(`[email-classify-bulk] Updated ${updated} emails, ${failed} failed`);

    const elapsed = Date.now() - startTime;
    console.log(`[email-classify-bulk] Batch ${_batch_number} complete: ${updated} emails in ${elapsed}ms`);

    // ==========================================================================
    // STEP 6: Check if more emails remain, self-invoke if needed
    // ==========================================================================
    const { count: remaining } = await supabase
      .from('email_import_queue')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
      .is('category', null);

    if (remaining && remaining > 0) {
      console.log(`[email-classify-bulk] ${remaining} emails remaining, self-invoking batch ${_batch_number + 1}`);
      
      // Update progress with current count
      const { count: totalClassified } = await supabase
        .from('email_import_queue')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace_id)
        .not('category', 'is', null);
      
      await supabase
        .from('email_import_progress')
        .upsert({
          workspace_id,
          current_phase: 'classifying',
          emails_classified: totalClassified || 0,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id' });
      
      // Self-invoke for next batch
      fetch(`${supabaseUrl}/functions/v1/email-classify-bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ 
          workspace_id, 
          _batch_number: _batch_number + 1 
        }),
      }).catch(e => console.error('[email-classify-bulk] Self-invoke failed:', e));

      return new Response(JSON.stringify({
        success: true,
        status: 'continuing',
        batch: _batch_number,
        emails_classified: updated,
        emails_remaining: remaining,
        elapsed_ms: elapsed,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================================================
    // STEP 7: All done - trigger voice learning
    // ==========================================================================
    const { count: finalCount } = await supabase
      .from('email_import_queue')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
      .not('category', 'is', null);

    await supabase
      .from('email_import_progress')
      .upsert({
        workspace_id,
        current_phase: 'learning',
        emails_classified: finalCount || 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

    await triggerVoiceLearning(supabaseUrl, supabaseServiceKey, workspace_id);

    return new Response(JSON.stringify({
      success: true,
      status: 'complete',
      total_batches: _batch_number + 1,
      emails_classified: finalCount,
      elapsed_ms: elapsed,
      chained_to: 'voice-learning',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[email-classify-bulk] Error:', error);
    
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
