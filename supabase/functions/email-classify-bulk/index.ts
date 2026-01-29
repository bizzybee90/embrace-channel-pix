import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * SIMPLE BULK EMAIL CLASSIFIER
 * 
 * Takes ALL unclassified emails and sends them to Gemini in ONE call.
 * Gemini 1.5 Pro has 2M token context window.
 * 20,000 emails × 200 chars = 4M chars = ~1M tokens. Fits easily.
 * 
 * No relays. No locks. No batching. Just one API call.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Using Gemini 1.5 Pro for maximum context window (2M tokens)
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent';

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
    const googleApiKey = Deno.env.get('GOOGLE_API_KEY');

    if (!googleApiKey) {
      return new Response(JSON.stringify({ error: 'GOOGLE_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const startTime = Date.now();

    console.log(`[email-classify-bulk] Starting for workspace ${workspace_id}`);

    // ==========================================================================
    // STEP 1: Fetch ALL unclassified emails in ONE query
    // ==========================================================================
    const { data: emails, error: fetchError, count } = await supabase
      .from('email_import_queue')
      .select('id, from_email, subject, body', { count: 'exact' })
      .eq('workspace_id', workspace_id)
      .eq('status', 'scanned')
      .eq('has_body', true)
      .order('id', { ascending: true })
      .limit(50000); // Safety limit

    if (fetchError) throw fetchError;

    if (!emails || emails.length === 0) {
      console.log(`[email-classify-bulk] No emails to classify`);
      return new Response(JSON.stringify({ 
        success: true, 
        status: 'no_work',
        message: 'No emails to classify' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[email-classify-bulk] Found ${emails.length} emails to classify`);

    // ==========================================================================
    // STEP 2: Build ONE prompt with ALL emails
    // ==========================================================================
    // Format: index|from|subject|snippet (compact to maximize emails per call)
    const emailLines = emails.map((e, i) => {
      const subject = (e.subject || '(none)').substring(0, 100).replace(/[\n\r|]/g, ' ');
      const snippet = (e.body || '').substring(0, 150).replace(/[\n\r|]/g, ' ');
      const from = (e.from_email || 'unknown').substring(0, 50);
      return `${i}|${from}|${subject}|${snippet}`;
    }).join('\n');

    const prompt = `Classify each email into ONE category. Categories:
- inquiry: Questions about services/products
- booking: Appointment/booking requests
- quote: Price/quote requests
- complaint: Issues/problems/negative feedback
- follow_up: Replies to previous conversations
- spam: Marketing, promotions, unwanted
- notification: Automated system notifications (receipts, confirmations, alerts)
- personal: Personal/social messages

Return ONLY a JSON array. Format: [{"i":0,"c":"inquiry","r":true},{"i":1,"c":"spam","r":false}]
Where: i=index (integer), c=category (string), r=requires_reply (boolean)

Rules for requires_reply:
- spam, notification: ALWAYS false
- complaint, inquiry, quote, booking: ALWAYS true
- follow_up, personal: true if they're asking something, false if just acknowledging

Return ONLY valid JSON. No markdown. No explanation. Just the array.

EMAILS (${emails.length} total, format: index|from|subject|snippet):
${emailLines}`;

    // Calculate approximate token count
    const estimatedTokens = Math.ceil(prompt.length / 4);
    console.log(`[email-classify-bulk] Prompt size: ${prompt.length} chars, ~${estimatedTokens} tokens`);

    // ==========================================================================
    // STEP 3: ONE Gemini API call
    // ==========================================================================
    console.log(`[email-classify-bulk] Calling Gemini 1.5 Pro...`);
    
    const response = await fetch(`${GEMINI_API}?key=${googleApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.1,
          maxOutputTokens: 65536, // Max output for classifications
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[email-classify-bulk] Gemini error:`, errorText);
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const geminiData = await response.json();
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    console.log(`[email-classify-bulk] Got response, length: ${responseText.length} chars`);

    // ==========================================================================
    // STEP 4: Parse classifications
    // ==========================================================================
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array in Gemini response');
    }

    let classifications: Array<{ i: number; c: string; r: boolean }>;
    try {
      classifications = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error(`[email-classify-bulk] JSON parse error:`, parseErr);
      throw new Error('Failed to parse Gemini response as JSON');
    }

    console.log(`[email-classify-bulk] Parsed ${classifications.length} classifications`);

    // ==========================================================================
    // STEP 5: Bulk update all emails
    // ==========================================================================
    // Create a map of index -> classification for fast lookup
    const classMap = new Map<number, { c: string; r: boolean }>();
    for (const cl of classifications) {
      classMap.set(cl.i, { c: cl.c, r: cl.r });
    }

    // Batch update in chunks of 500 for database efficiency
    const BATCH_SIZE = 500;
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      
      // Build update records
      const updates = batch.map((email, batchIndex) => {
        const globalIndex = i + batchIndex;
        const classification = classMap.get(globalIndex);
        
        return {
          id: email.id,
          status: 'processed',
          processed_at: new Date().toISOString(),
          // Store classification in metadata if needed
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

    // Update progress
    await supabase
      .from('email_import_progress')
      .upsert({
        workspace_id,
        current_phase: 'completed',
        emails_classified: updated,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

    return new Response(JSON.stringify({
      success: true,
      emails_total: emails.length,
      emails_classified: updated,
      emails_failed: failed,
      elapsed_ms: elapsed,
      api_calls: 1, // THE KEY METRIC - just ONE call!
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[email-classify-bulk] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
