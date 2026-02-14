import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CHUNK_SIZE = 30;
const GEMINI_MODEL = 'gemini-2.5-flash';
const TIMEOUT_BUFFER_MS = 120000; // Stop 30s before typical 150s limit

interface FaqRow {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  source_business: string | null;
}

interface DedupedTopic {
  question: string;
  category: string | null;
  source_business: string | null;
  source_faq_id: string;
}

interface AdaptedFaq {
  question: string;
  answer: string;
  category: string | null;
  source_business: string | null;
  source_faq_id: string;
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { 
        temperature: 0.3, 
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) {
    console.error('[consolidate] Empty Gemini response:', JSON.stringify(data).slice(0, 1000));
    throw new Error('Empty response from Gemini API');
  }
  console.log(`[consolidate] Gemini response length: ${text.length}`);
  return text;
}

function extractJsonArray(text: string): unknown[] {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  // Try direct parse
  if (cleaned.startsWith('[')) {
    try { return JSON.parse(cleaned); } catch (e) {
      console.warn('[consolidate] Direct parse failed:', (e as Error).message);
    }
  }

  // Try extracting array with greedy regex
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (e) {
      console.warn('[consolidate] Regex parse failed:', (e as Error).message);
    }
  }

  // Last resort: try parsing as individual objects and wrapping
  const objMatches = [...cleaned.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)];
  if (objMatches.length > 0) {
    try {
      const arr = objMatches.map(m => JSON.parse(m[0]));
      console.log(`[consolidate] Recovered ${arr.length} objects from loose JSON`);
      return arr;
    } catch (e) {
      console.warn('[consolidate] Object recovery failed:', (e as Error).message);
    }
  }

  console.error('[consolidate] No JSON array. Raw (first 500):', cleaned.slice(0, 500));
  throw new Error('No JSON array found in AI response');
}

async function deduplicateChunk(apiKey: string, faqs: FaqRow[]): Promise<DedupedTopic[]> {
  const faqList = faqs.map((f, i) => 
    `${i + 1}. [ID: ${f.id}] [Source: ${f.source_business || 'unknown'}] Q: ${f.question}`
  ).join('\n');

  const prompt = `Deduplicate these ${faqs.length} FAQ questions from competitor businesses. Group by topic, keep one representative per unique topic. Return ONLY unique topic questions (no answers needed yet).

${faqList}

Return a JSON array:
[{"question":"representative question","category":"short label","source_business":"name","source_faq_id":"the ID"}]

Be concise. Only return unique topics, not duplicates.`;

  const response = await callGemini(apiKey, prompt);
  return extractJsonArray(response) as DedupedTopic[];
}

// Relay-race: self-invoke to continue processing
function chainSelf(supabaseUrl: string, serviceKey: string, payload: Record<string, unknown>) {
  const url = `${supabaseUrl}/functions/v1/consolidate-faqs`;
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(payload),
  }).catch(e => console.error('[consolidate] Chain error:', e));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const googleApiKey = Deno.env.get('GOOGLE_API_KEY');

  if (!googleApiKey) {
    return new Response(
      JSON.stringify({ error: 'GOOGLE_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const startTime = Date.now();

  try {
    const body = await req.json();
    const { workspace_id, _phase = 'dedup', _dedup_chunk_index = 0, _deduped_topics, _relay_depth = 0 } = body;
    
    if (!workspace_id) {
      return new Response(
        JSON.stringify({ error: 'workspace_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log(`[consolidate] Phase=${_phase}, chunk=${_dedup_chunk_index}, relay=${_relay_depth}, workspace=${workspace_id}`);

    // ═══════════════════════════════════════════
    //  PHASE 1: DEDUPLICATION (chunked relay-race)
    // ═══════════════════════════════════════════
    if (_phase === 'dedup') {
      // Update progress on first invocation
      if (_dedup_chunk_index === 0) {
        await supabase.from('n8n_workflow_progress').upsert({
          workspace_id,
          workflow_type: 'consolidation',
          status: 'deduplicating',
          details: { message: 'Starting FAQ consolidation — deduplicating competitor FAQs' },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id,workflow_type' });
      }

      // Fetch all competitor FAQs
      const { data: competitorFaqs, error: compErr } = await supabase
        .from('faq_database')
        .select('id, question, answer, category, source_business')
        .eq('workspace_id', workspace_id)
        .eq('is_own_content', false)
        .eq('is_active', true)
        .neq('generation_source', 'competitor_adapted')
        .order('created_at', { ascending: true });

      if (compErr) throw new Error(`Failed to fetch competitor FAQs: ${compErr.message}`);

      if (!competitorFaqs || competitorFaqs.length === 0) {
        await supabase.from('n8n_workflow_progress').upsert({
          workspace_id,
          workflow_type: 'consolidation',
          status: 'complete',
          details: { message: 'No competitor FAQs to consolidate', adapted_count: 0 },
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id,workflow_type' });
        return new Response(JSON.stringify({ success: true, adapted_count: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create chunks
      const chunks: FaqRow[][] = [];
      for (let i = 0; i < competitorFaqs.length; i += CHUNK_SIZE) {
        chunks.push(competitorFaqs.slice(i, i + CHUNK_SIZE) as FaqRow[]);
      }

      const totalChunks = chunks.length;
      const existingDeduped: DedupedTopic[] = _deduped_topics || [];

      // Process chunks one at a time, relay-racing if we run out of time
      for (let ci = _dedup_chunk_index; ci < totalChunks; ci++) {
        if (Date.now() - startTime > TIMEOUT_BUFFER_MS) {
          console.log(`[consolidate] Timeout approaching, chaining to chunk ${ci}`);
          chainSelf(supabaseUrl, supabaseServiceKey, {
            workspace_id,
            _phase: 'dedup',
            _dedup_chunk_index: ci,
            _deduped_topics: existingDeduped,
            _relay_depth: _relay_depth + 1,
          });
          return new Response(JSON.stringify({ status: 'continuing', chunk: ci }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[consolidate] Dedup chunk ${ci + 1}/${totalChunks}, size=${chunks[ci].length}`);
        const deduped = await deduplicateChunk(googleApiKey, chunks[ci]);
        existingDeduped.push(...deduped);

        await supabase.from('n8n_workflow_progress').upsert({
          workspace_id,
          workflow_type: 'consolidation',
          status: 'deduplicating',
          details: {
            message: `Deduplicating... chunk ${ci + 1}/${totalChunks} (${existingDeduped.length} unique topics so far)`,
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id,workflow_type' });
      }

      // If multiple chunks, do cross-chunk dedup pass
      let finalDeduped = existingDeduped;
      if (chunks.length > 1 && existingDeduped.length > CHUNK_SIZE) {
        console.log(`[consolidate] Cross-chunk dedup, ${existingDeduped.length} topics`);
        const asFaqRows: FaqRow[] = existingDeduped.map(t => ({
          id: t.source_faq_id,
          question: t.question,
          answer: '',
          category: t.category,
          source_business: t.source_business,
        }));
        
        // Process cross-chunk in sub-chunks too
        const crossChunks: FaqRow[][] = [];
        for (let i = 0; i < asFaqRows.length; i += CHUNK_SIZE) {
          crossChunks.push(asFaqRows.slice(i, i + CHUNK_SIZE));
        }
        finalDeduped = [];
        for (const cc of crossChunks) {
          if (Date.now() - startTime > TIMEOUT_BUFFER_MS) {
            // Can't finish cross-dedup, just use what we have
            finalDeduped.push(...cc.map(f => ({
              question: f.question,
              category: f.category,
              source_business: f.source_business,
              source_faq_id: f.id,
            })));
            continue;
          }
          const d = await deduplicateChunk(googleApiKey, cc);
          finalDeduped.push(...d);
        }
      }

      console.log(`[consolidate] Dedup complete: ${competitorFaqs.length} → ${finalDeduped.length} unique topics`);

      // Chain to adaptation phase
      chainSelf(supabaseUrl, supabaseServiceKey, {
        workspace_id,
        _phase: 'adapt',
        _deduped_topics: finalDeduped,
        _original_count: competitorFaqs.length,
        _relay_depth: _relay_depth + 1,
      });

      return new Response(JSON.stringify({
        status: 'continuing',
        phase: 'dedup_complete',
        deduped_count: finalDeduped.length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ═══════════════════════════════════════════
    //  PHASE 2: GAP ADAPTATION
    // ═══════════════════════════════════════════
    if (_phase === 'adapt') {
      const dedupedTopics: DedupedTopic[] = body._deduped_topics || [];
      const originalCount: number = body._original_count || 0;

      await supabase.from('n8n_workflow_progress').upsert({
        workspace_id,
        workflow_type: 'consolidation',
        status: 'adapting',
        details: {
          message: `Dedup complete (${dedupedTopics.length} unique topics). Adapting gap topics...`,
          deduped_count: dedupedTopics.length,
          original_count: originalCount,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,workflow_type' });

      // Fetch business context
      const [{ data: bizCtx }, { data: bizProfile }] = await Promise.all([
        supabase.from('business_context').select('company_name, business_type, service_area').eq('workspace_id', workspace_id).maybeSingle(),
        supabase.from('business_profile').select('phone, services, address, service_area, service_radius_miles').eq('workspace_id', workspace_id).maybeSingle(),
      ]);

      const name = bizCtx?.company_name || 'the business';
      const type = bizCtx?.business_type || '';
      const area = bizCtx?.service_area || bizProfile?.service_area || '';
      const radius = bizProfile?.service_radius_miles ? `${bizProfile.service_radius_miles}-mile radius` : '';
      const phone = bizProfile?.phone || '';
      const services = Array.isArray(bizProfile?.services) 
        ? (bizProfile.services as string[]).join(', ')
        : typeof bizProfile?.services === 'string' ? bizProfile.services : '';
      const address = bizProfile?.address || '';

      let businessInfo = `Adapt each FAQ to this business: ${name}`;
      if (type) businessInfo += `, a ${type} business`;
      if (area) businessInfo += `, based in ${area}`;
      if (radius) businessInfo += ` covering a ${radius}`;
      if (phone) businessInfo += `. Phone: ${phone}`;
      if (address) businessInfo += `. Address: ${address}`;
      if (services) businessInfo += `. Services: ${services}`;
      businessInfo += '.';

      // Fetch owner FAQs
      const { data: ownerFaqs } = await supabase
        .from('faq_database')
        .select('question')
        .eq('workspace_id', workspace_id)
        .eq('is_active', true)
        .neq('generation_source', 'competitor_adapted');

      // Fetch competitor FAQ answers for context
      const { data: compFaqs } = await supabase
        .from('faq_database')
        .select('id, question, answer')
        .eq('workspace_id', workspace_id)
        .eq('is_own_content', false)
        .eq('is_active', true);

      const competitorFaqMap = new Map<string, { question: string; answer: string }>();
      (compFaqs || []).forEach((f: any) => competitorFaqMap.set(f.id, { question: f.question, answer: f.answer }));

      console.log(`[consolidate] Owner has ${ownerFaqs?.length || 0} FAQs. Adapting ${dedupedTopics.length} topics. Business: ${businessInfo}`);

      // Send owner questions
      const ownerList = (ownerFaqs || []).map((f: any, i: number) => `${i + 1}. ${f.question}`).join('\n');

      // Include competitor answers from original data
      const competitorList = dedupedTopics.map((t, i) => {
        const original = competitorFaqMap.get(t.source_faq_id);
        const answer = original?.answer || '';
        const shortAnswer = answer.length > 150 ? answer.slice(0, 150) + '...' : answer;
        return `${i + 1}. [ID: ${t.source_faq_id}] [Source: ${t.source_business || 'unknown'}] Q: ${t.question}\nA: ${shortAnswer}`;
      }).join('\n\n');

      const prompt = `You are adapting competitor knowledge for a business. ${businessInfo}

Here are the owner's existing FAQ topics (AUTHORITATIVE — do NOT duplicate these):

${ownerList}

Here are deduplicated competitor FAQ topics:

${competitorList}

For each topic NOT already covered by the owner's FAQs, produce an adapted version using the owner's business context. Do NOT produce adapted versions for topics the owner already covers.

Write in first person ('we', 'our'). Replace competitor names, addresses, phone numbers, and specific prices with the owner's details or 'contact us for a quote' where appropriate. Keep answers concise (2-3 sentences max).

Return a JSON array of adapted FAQs (empty array [] if all topics are already covered):
[{"question":"adapted question","answer":"adapted answer","category":"label","source_business":"competitor name","source_faq_id":"ID"}]`;

      const response = await callGemini(googleApiKey, prompt);
      const adaptedFaqs = extractJsonArray(response) as AdaptedFaq[];

      console.log(`[consolidate] Adaptation complete: ${adaptedFaqs.length} gap-filling FAQs`);

      // Idempotency: delete previous adapted rows
      await supabase.from('faq_database').delete()
        .eq('workspace_id', workspace_id)
        .eq('generation_source', 'competitor_adapted');

      // Insert adapted FAQs
      if (adaptedFaqs.length > 0) {
        const rows = adaptedFaqs.map(faq => ({
          workspace_id,
          question: faq.question,
          answer: faq.answer,
          category: faq.category || 'general',
          source: 'competitor_adapted',
          generation_source: 'competitor_adapted',
          source_business: faq.source_business,
          original_faq_id: faq.source_faq_id || null,
          is_own_content: false,
          priority: 8,
          is_active: true,
        }));

        const { error: insertErr } = await supabase.from('faq_database').insert(rows);
        if (insertErr) throw new Error(`Failed to insert adapted FAQs: ${insertErr.message}`);
      }

      // Complete!
      await supabase.from('n8n_workflow_progress').upsert({
        workspace_id,
        workflow_type: 'consolidation',
        status: 'complete',
        details: {
          message: `Consolidation complete: ${adaptedFaqs.length} gap-filling FAQs created from ${dedupedTopics.length} unique topics`,
          original_count: originalCount,
          deduped_count: dedupedTopics.length,
          adapted_count: adaptedFaqs.length,
        },
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,workflow_type' });

      console.log(`[consolidate] Done. ${adaptedFaqs.length} adapted FAQs inserted.`);

      return new Response(JSON.stringify({
        success: true,
        original_count: originalCount,
        deduped_count: dedupedTopics.length,
        adapted_count: adaptedFaqs.length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown phase: ${_phase}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[consolidate] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';

    try {
      const body2 = await req.clone().json().catch(() => ({}));
      const ws = body2.workspace_id;
      if (ws) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        await supabase.from('n8n_workflow_progress').upsert({
          workspace_id: ws,
          workflow_type: 'consolidation',
          status: 'failed',
          details: { message: `Consolidation failed: ${message}`, error: message },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id,workflow_type' });
      }
    } catch (_) { /* best effort */ }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
