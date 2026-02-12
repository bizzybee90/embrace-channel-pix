import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * BULK EMAIL CLASSIFIER - Parallel Relay-Race Edition
 * 
 * Supports two modes:
 * 1. Partitioned (called by dispatcher): receives partition_id & total_partitions,
 *    uses RPC to fetch only its slice of emails. Last worker standing triggers voice-learning.
 * 2. Legacy (direct call): fetches all unclassified emails sequentially. Backward compatible.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';
const BATCH_SIZE = 5000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      workspace_id, 
      partition_id, 
      total_partitions, 
      callback_url,
      _batch_number = 0 
    } = await req.json();
    
    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isPartitioned = partition_id !== undefined && total_partitions !== undefined;
    const workerTag = isPartitioned ? `[Worker ${partition_id}/${total_partitions}]` : '[legacy]';

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

    console.log(`${workerTag} Starting batch ${_batch_number} for workspace ${workspace_id}`);

    // Update progress
    await supabase
      .from('email_import_progress')
      .upsert({
        workspace_id,
        current_phase: 'classifying',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

    // ==========================================================================
    // STEP 1: Fetch emails (partitioned or legacy)
    // ==========================================================================
    let emails: any[] | null = null;
    let fetchError: any = null;

    if (isPartitioned) {
      const result = await supabase.rpc('get_partitioned_unclassified_batch', {
        p_workspace_id: workspace_id,
        p_partition_id: partition_id,
        p_total_partitions: total_partitions,
        p_batch_size: BATCH_SIZE,
      });
      emails = result.data;
      fetchError = result.error;
    } else {
      const result = await supabase
        .from('email_import_queue')
        .select('id, from_email, subject, body, direction')
        .eq('workspace_id', workspace_id)
        .is('category', null)
        .order('id', { ascending: true })
        .range(0, BATCH_SIZE - 1);
      emails = result.data;
      fetchError = result.error;
    }

    if (fetchError) throw fetchError;

    if (!emails || emails.length === 0) {
      console.log(`${workerTag} No more emails in partition`);
      return await handlePartitionComplete(supabase, supabaseUrl, supabaseServiceKey, workspace_id, workerTag, callback_url, isPartitioned);
    }

    console.log(`${workerTag} Found ${emails.length} emails in batch ${_batch_number}`);

    // ==========================================================================
    // STEP 2: Build prompt
    // ==========================================================================
    const emailLines = emails.map((e: any, i: number) => {
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

    console.log(`${workerTag} Prompt: ${prompt.length} chars, ~${Math.ceil(prompt.length / 4)} tokens`);

    // ==========================================================================
    // STEP 3: Call Lovable AI Gateway
    // ==========================================================================
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
      console.error(`${workerTag} AI Gateway error:`, errorText);
      throw new Error(`AI Gateway error: ${response.status} - ${errorText}`);
    }

    const aiData = await response.json();
    const responseText = aiData.choices?.[0]?.message?.content || '';

    // ==========================================================================
    // STEP 4: Parse classifications
    // ==========================================================================
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in AI response');

    let classifications: Array<{ i: number; c: string; r: boolean }>;
    try {
      classifications = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('Failed to parse AI response as JSON');
    }

    console.log(`${workerTag} Parsed ${classifications.length} classifications`);

    // ==========================================================================
    // STEP 5: Bulk update emails
    // ==========================================================================
    const classMap = new Map<number, { c: string; r: boolean }>();
    for (const cl of classifications) {
      classMap.set(cl.i, { c: cl.c, r: cl.r });
    }

    const now = new Date().toISOString();
    let updated = 0;
    let failed = 0;

    const PARALLEL_BATCH = 50;
    for (let i = 0; i < emails.length; i += PARALLEL_BATCH) {
      const batch = emails.slice(i, i + PARALLEL_BATCH);
      const results = await Promise.all(batch.map(async (email: any, batchIdx: number) => {
        const globalIdx = i + batchIdx;
        const classification = classMap.get(globalIdx);
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
        return !error;
      }));
      updated += results.filter(Boolean).length;
      failed += results.filter(r => !r).length;
    }

    const elapsed = Date.now() - startTime;
    console.log(`${workerTag} Batch ${_batch_number}: ${updated} updated, ${failed} failed in ${elapsed}ms`);

    // ==========================================================================
    // STEP 6: Self-chain if more emails in partition
    // ==========================================================================
    // Check if there are more in THIS worker's partition
    let moreInPartition = false;
    if (isPartitioned) {
      const { data: nextBatch } = await supabase.rpc('get_partitioned_unclassified_batch', {
        p_workspace_id: workspace_id,
        p_partition_id: partition_id,
        p_total_partitions: total_partitions,
        p_batch_size: 1,
      });
      moreInPartition = nextBatch && nextBatch.length > 0;
    } else {
      const { count } = await supabase
        .from('email_import_queue')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace_id)
        .is('category', null);
      moreInPartition = (count || 0) > 0;
    }

    if (moreInPartition) {
      console.log(`${workerTag} More emails remain, self-chaining batch ${_batch_number + 1}`);

      // Update progress count
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

      fetch(`${supabaseUrl}/functions/v1/email-classify-bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ 
          workspace_id, 
          partition_id: isPartitioned ? partition_id : undefined,
          total_partitions: isPartitioned ? total_partitions : undefined,
          callback_url,
          _batch_number: _batch_number + 1,
        }),
      }).catch(e => console.error(`${workerTag} Self-chain failed:`, e));

      return new Response(JSON.stringify({
        success: true,
        status: 'continuing',
        worker: workerTag,
        batch: _batch_number,
        emails_classified: updated,
        elapsed_ms: elapsed,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================================================
    // STEP 7: Partition empty → check global remaining
    // ==========================================================================
    return await handlePartitionComplete(supabase, supabaseUrl, supabaseServiceKey, workspace_id, workerTag, callback_url, isPartitioned);

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
    } catch {
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

/**
 * Called when a worker's partition is empty.
 * Checks global remaining count - only the LAST worker triggers voice-learning and callback.
 */
async function handlePartitionComplete(
  supabase: any,
  supabaseUrl: string,
  supabaseServiceKey: string,
  workspace_id: string,
  workerTag: string,
  callback_url: string | null,
  isPartitioned: boolean,
) {
  // Check global remaining
  const { data: globalRemaining } = await supabase
    .rpc('count_unclassified_emails', { p_workspace_id: workspace_id });

  const remaining = Number(globalRemaining) || 0;

  if (remaining > 0 && isPartitioned) {
    console.log(`${workerTag} Partition empty but ${remaining} emails remain globally (other workers still running)`);
    return new Response(JSON.stringify({
      success: true,
      status: 'partition_complete',
      worker: workerTag,
      global_remaining: remaining,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // This is the last worker! Trigger voice-learning and callback.
  console.log(`${workerTag} ALL DONE - triggering voice-learning`);

  const { count: totalClassified } = await supabase
    .from('email_import_queue')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspace_id)
    .not('category', 'is', null);

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

  // Send callback to n8n if provided
  if (callback_url) {
    try {
      await fetch(callback_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id,
          status: 'classification_complete',
          total_classified: totalClassified || 0,
          message: 'All emails classified, voice learning triggered',
        }),
      });
      console.log(`${workerTag} Sent completion callback to ${callback_url}`);
    } catch (e) {
      console.error(`${workerTag} Callback failed:`, e);
    }
  }

  return new Response(JSON.stringify({
    success: true,
    status: 'complete',
    worker: workerTag,
    total_classified: totalClassified,
    chained_to: 'voice-learning',
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function triggerVoiceLearning(
  supabaseUrl: string,
  supabaseServiceKey: string,
  workspace_id: string
): Promise<void> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/voice-learning`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ workspace_id }),
    });

    if (!response.ok) {
      console.error(`Failed to trigger voice-learning: ${response.status}`);
    } else {
      console.log(`Triggered voice-learning for workspace ${workspace_id}`);
    }
  } catch (e) {
    console.error(`Error triggering voice-learning:`, e);
  }
}
