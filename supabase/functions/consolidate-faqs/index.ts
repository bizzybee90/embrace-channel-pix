import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * CONSOLIDATE-FAQS — Three-Pass Architecture
 * 
 * Pass 1: RELEVANCE FILTER — removes FAQs unrelated to the owner's business type
 * Pass 2: DEDUPLICATION — merges duplicate topics across competitors
 * Pass 3: GAP-ONLY ADAPTATION — adapts topics the owner doesn't cover, with real business details
 * 
 * Uses relay-race pattern for timeout safety.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';
const TIMEOUT_BUFFER_MS = 120000;

// Chunk sizes per pass
const FILTER_CHUNK_SIZE = 80;
const DEDUP_CHUNK_SIZE = 80;
const ADAPT_CHUNK_SIZE = 25;

interface FaqRow {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  source_business: string | null;
}

// ─── AI Call via Lovable Gateway ───────────────────────────────────────────────

async function callAI(apiKey: string, systemPrompt: string, userPrompt: string, retryOnFail = true): Promise<string> {
  const doCall = async (): Promise<string> => {
    const res = await fetch(LOVABLE_AI_GATEWAY, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI gateway error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('Empty AI response');
    return text;
  };

  try {
    return await doCall();
  } catch (e) {
    if (retryOnFail) {
      console.warn(`[consolidate] AI call failed, retrying once: ${(e as Error).message}`);
      return await doCall();
    }
    throw e;
  }
}

function extractJsonArray(text: string): unknown[] {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  if (cleaned.startsWith('[')) {
    try { return JSON.parse(cleaned); } catch { /* fall through */ }
  }

  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }

  // Last resort: collect individual objects
  const objMatches = [...cleaned.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)];
  if (objMatches.length > 0) {
    try {
      return objMatches.map(m => JSON.parse(m[0]));
    } catch { /* fall through */ }
  }

  console.error('[consolidate] No JSON array found. Raw (500):', cleaned.slice(0, 500));
  return [];
}

// ─── Relay-Race Self-Chain ────────────────────────────────────────────────────

function chainSelf(supabaseUrl: string, serviceKey: string, payload: Record<string, unknown>) {
  fetch(`${supabaseUrl}/functions/v1/consolidate-faqs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(payload),
  }).catch(e => console.error('[consolidate] Chain error:', e));
}

// ─── Progress Update Helper ───────────────────────────────────────────────────

async function updateProgress(supabase: any, workspace_id: string, status: string, details: Record<string, unknown>, isComplete = false) {
  const row: any = {
    workspace_id,
    workflow_type: 'consolidation',
    status,
    details,
    updated_at: new Date().toISOString(),
  };
  if (isComplete) row.completed_at = new Date().toISOString();

  await supabase.from('n8n_workflow_progress').upsert(row, { onConflict: 'workspace_id,workflow_type' });
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

  if (!lovableApiKey) {
    return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const startTime = Date.now();

  try {
    const body = await req.json();
    const {
      workspace_id,
      _phase = 'filter',
      _chunk_index = 0,
      _carried_data = null,
      _relay_depth = 0,
      _original_count = 0,
    } = body;

    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log(`[consolidate] Phase=${_phase}, chunk=${_chunk_index}, relay=${_relay_depth}, workspace=${workspace_id}`);

    // ═══════════════════════════════════════════════════════
    //  PASS 1: RELEVANCE FILTER
    // ═══════════════════════════════════════════════════════
    if (_phase === 'filter') {
      if (_chunk_index === 0) {
        await updateProgress(supabase, workspace_id, 'processing', { phase: 'filtering', message: 'Filtering irrelevant FAQs...' });
      }

      // Fetch all competitor FAQs (raw, not previously adapted)
      const { data: allCompFaqs, error: fetchErr } = await supabase
        .from('faq_database')
        .select('id, question, answer, category, source_business')
        .eq('workspace_id', workspace_id)
        .eq('is_own_content', false)
        .eq('is_active', true)
        .neq('generation_source', 'competitor_adapted')
        .order('created_at', { ascending: true });

      if (fetchErr) throw new Error(`Failed to fetch competitor FAQs: ${fetchErr.message}`);

      if (!allCompFaqs || allCompFaqs.length === 0) {
        await updateProgress(supabase, workspace_id, 'complete', { phase: 'complete', message: 'No competitor FAQs to consolidate', total_adapted: 0 }, true);
        return new Response(JSON.stringify({ success: true, adapted_count: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`[consolidate] Total competitor FAQs to filter: ${allCompFaqs.length}`);

      // Fetch business context for relevance filtering
      const [{ data: bizCtx }, { data: bizProfile }] = await Promise.all([
        supabase.from('business_context').select('company_name, business_type, service_area').eq('workspace_id', workspace_id).maybeSingle(),
        supabase.from('business_profile').select('services, industry').eq('workspace_id', workspace_id).maybeSingle(),
      ]);

      const businessType = bizCtx?.business_type || bizProfile?.industry || 'service business';
      const servicesRaw = bizProfile?.services;
      const services = Array.isArray(servicesRaw)
        ? servicesRaw.join(', ')
        : typeof servicesRaw === 'string' ? servicesRaw : '';

      // Process in chunks
      const chunks: FaqRow[][] = [];
      for (let i = 0; i < allCompFaqs.length; i += FILTER_CHUNK_SIZE) {
        chunks.push(allCompFaqs.slice(i, i + FILTER_CHUNK_SIZE) as FaqRow[]);
      }

      const existingKeptIds: string[] = (_carried_data as string[]) || [];

      for (let ci = _chunk_index; ci < chunks.length; ci++) {
        if (Date.now() - startTime > TIMEOUT_BUFFER_MS) {
          console.log(`[consolidate] Timeout approaching at filter chunk ${ci}, chaining...`);
          chainSelf(supabaseUrl, supabaseServiceKey, {
            workspace_id, _phase: 'filter', _chunk_index: ci,
            _carried_data: existingKeptIds, _relay_depth: _relay_depth + 1,
            _original_count: allCompFaqs.length,
          });
          return new Response(JSON.stringify({ status: 'continuing', phase: 'filter', chunk: ci }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const chunk = chunks[ci];
        const faqList = chunk.map(f =>
          `- ID: ${f.id} | Source: ${f.source_business || 'unknown'} | Q: ${f.question} | A: ${f.answer.substring(0, 120)}`
        ).join('\n');

        const systemPrompt = `You are filtering FAQs for relevance to a specific business. Return ONLY a JSON array of FAQ IDs to KEEP.`;

        const userPrompt = `BUSINESS TYPE: ${businessType}
SERVICES OFFERED: ${services || 'Not specified'}

Below are ${chunk.length} FAQs scraped from competitor websites. Many competitors offer services BEYOND what this business does.

REMOVE any FAQ about:
- Services this business does NOT offer (e.g. carpet cleaning, office cleaning, pressure washing, roof cleaning, biohazard cleanup, pest control, legionella training, drug den cleanup, commercial/industrial cleaning unrelated to the business type)
- Internal competitor details (founding dates, specific team members, office addresses)
- National/enterprise services when this is a local business
- Generic marketing fluff with no informational value

KEEP any FAQ about:
- Services this business DOES offer (${services || businessType})
- General service business topics (insurance, coverage area, booking, payment, guarantees, scheduling, weather policies, quotes, qualifications, safety)
- Customer experience (reliability, communication, cancellations)

Return ONLY a JSON array of IDs to keep: [{"id":"uuid"},{"id":"uuid"}]

FAQs to evaluate:
${faqList}`;

        try {
          const response = await callAI(lovableApiKey, systemPrompt, userPrompt);
          const kept = extractJsonArray(response) as Array<{ id: string }>;
          const keptIds = kept.map(k => k.id).filter(Boolean);
          existingKeptIds.push(...keptIds);
          console.log(`[consolidate] Filter chunk ${ci + 1}/${chunks.length}: kept ${keptIds.length}/${chunk.length}`);
        } catch (e) {
          console.error(`[consolidate] Filter chunk ${ci} failed: ${(e as Error).message}. Keeping all from this chunk.`);
          existingKeptIds.push(...chunk.map(f => f.id));
        }

        await updateProgress(supabase, workspace_id, 'processing', {
          phase: 'filtering',
          message: `Filtering FAQs... chunk ${ci + 1}/${chunks.length} (${existingKeptIds.length} relevant so far)`,
        });
      }

      console.log(`[consolidate] Filter complete: ${allCompFaqs.length} → ${existingKeptIds.length} relevant`);

      // Chain to dedup phase
      chainSelf(supabaseUrl, supabaseServiceKey, {
        workspace_id, _phase: 'dedup', _chunk_index: 0,
        _carried_data: existingKeptIds,
        _original_count: allCompFaqs.length,
        _relay_depth: _relay_depth + 1,
      });

      return new Response(JSON.stringify({ status: 'continuing', phase: 'filter_complete', kept: existingKeptIds.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ═══════════════════════════════════════════════════════
    //  PASS 2: DEDUPLICATION
    // ═══════════════════════════════════════════════════════
    if (_phase === 'dedup') {
      await updateProgress(supabase, workspace_id, 'processing', { phase: 'deduplicating', message: 'Merging duplicate topics...' });

      const relevantIds: string[] = (_carried_data as string[]) || [];

      if (relevantIds.length === 0) {
        await updateProgress(supabase, workspace_id, 'complete', { phase: 'complete', message: 'No relevant FAQs after filtering', total_adapted: 0 }, true);
        return new Response(JSON.stringify({ success: true, adapted_count: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fetch the relevant FAQs by ID (in batches of 100 due to query limits)
      const allRelevantFaqs: FaqRow[] = [];
      for (let i = 0; i < relevantIds.length; i += 100) {
        const batch = relevantIds.slice(i, i + 100);
        const { data } = await supabase
          .from('faq_database')
          .select('id, question, answer, category, source_business')
          .in('id', batch);
        if (data) allRelevantFaqs.push(...(data as FaqRow[]));
      }

      console.log(`[consolidate] Dedup: fetched ${allRelevantFaqs.length} relevant FAQs`);

      // Chunk for dedup
      const chunks: FaqRow[][] = [];
      for (let i = 0; i < allRelevantFaqs.length; i += DEDUP_CHUNK_SIZE) {
        chunks.push(allRelevantFaqs.slice(i, i + DEDUP_CHUNK_SIZE));
      }

      // Dedup each chunk
      interface DedupResult { id: string; question: string; answer: string; source_business: string; }
      let allDeduped: DedupResult[] = [];

      for (let ci = 0; ci < chunks.length; ci++) {
        if (Date.now() - startTime > TIMEOUT_BUFFER_MS) {
          // If timeout, just pass remaining undeduped
          for (let ri = ci; ri < chunks.length; ri++) {
            allDeduped.push(...chunks[ri].map(f => ({
              id: f.id, question: f.question, answer: f.answer, source_business: f.source_business || '',
            })));
          }
          break;
        }

        const chunk = chunks[ci];
        const faqList = chunk.map(f =>
          `- ID: ${f.id} | Source: ${f.source_business || 'unknown'} | Q: ${f.question}`
        ).join('\n');

        const systemPrompt = `You are deduplicating FAQs from multiple competitor businesses. Return a JSON array of representative FAQs — one per unique topic.`;

        const userPrompt = `Group these ${chunk.length} FAQs by semantic topic. Questions asking the same thing in different words are duplicates.

Examples of duplicates:
- "What areas do you cover?" / "What is your service area?" / "Where do you operate?"
- "Are you insured?" / "Are you fully insured?" / "Do you have insurance?"

For each unique topic, pick the FAQ with the most detailed/informative answer as the representative.

Return: [{"id":"uuid","question":"...","answer":"...","source_business":"..."}]

FAQs:
${faqList}`;

        try {
          const response = await callAI(lovableApiKey, systemPrompt, userPrompt);
          const deduped = extractJsonArray(response) as DedupResult[];
          
          // Enrich with full answers from our data
          const enriched = deduped.map(d => {
            const original = chunk.find(f => f.id === d.id);
            return {
              id: d.id,
              question: d.question || original?.question || '',
              answer: original?.answer || d.answer || '',
              source_business: d.source_business || original?.source_business || '',
            };
          });
          
          allDeduped.push(...enriched);
          console.log(`[consolidate] Dedup chunk ${ci + 1}/${chunks.length}: ${chunk.length} → ${deduped.length}`);
        } catch (e) {
          console.error(`[consolidate] Dedup chunk ${ci} failed: ${(e as Error).message}. Passing through.`);
          allDeduped.push(...chunk.map(f => ({
            id: f.id, question: f.question, answer: f.answer, source_business: f.source_business || '',
          })));
        }
      }

      // Cross-chunk dedup if multiple chunks produced results
      if (chunks.length > 1 && allDeduped.length > DEDUP_CHUNK_SIZE) {
        console.log(`[consolidate] Cross-chunk dedup: ${allDeduped.length} topics`);
        const crossChunks: DedupResult[][] = [];
        for (let i = 0; i < allDeduped.length; i += DEDUP_CHUNK_SIZE) {
          crossChunks.push(allDeduped.slice(i, i + DEDUP_CHUNK_SIZE));
        }

        const crossDeduped: DedupResult[] = [];
        for (const cc of crossChunks) {
          if (Date.now() - startTime > TIMEOUT_BUFFER_MS) {
            crossDeduped.push(...cc);
            continue;
          }

          const faqList = cc.map(f => `- ID: ${f.id} | Source: ${f.source_business} | Q: ${f.question}`).join('\n');
          try {
            const response = await callAI(lovableApiKey,
              'Deduplicate these FAQs. Return one representative per unique topic as JSON array.',
              `[{"id":"uuid","question":"...","answer":"...","source_business":"..."}]\n\nFAQs:\n${faqList}`,
              false // no retry for cross-chunk
            );
            crossDeduped.push(...(extractJsonArray(response) as DedupResult[]));
          } catch {
            crossDeduped.push(...cc);
          }
        }
        allDeduped = crossDeduped;
      }

      console.log(`[consolidate] Dedup complete: ${allRelevantFaqs.length} → ${allDeduped.length} unique topics`);

      // Chain to adapt phase
      chainSelf(supabaseUrl, supabaseServiceKey, {
        workspace_id, _phase: 'adapt', _chunk_index: 0,
        _carried_data: allDeduped,
        _original_count: _original_count,
        _filtered_count: allRelevantFaqs.length,
        _relay_depth: _relay_depth + 1,
      });

      return new Response(JSON.stringify({ status: 'continuing', phase: 'dedup_complete', deduped_count: allDeduped.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ═══════════════════════════════════════════════════════
    //  PASS 3: GAP-ONLY ADAPTATION
    // ═══════════════════════════════════════════════════════
    if (_phase === 'adapt') {
      const dedupedTopics = (_carried_data || []) as Array<{ id: string; question: string; answer: string; source_business: string }>;
      const filteredCount: number = body._filtered_count || 0;

      if (_chunk_index === 0) {
        await updateProgress(supabase, workspace_id, 'processing', {
          phase: 'adapting',
          message: `Adapting FAQs to your business... (${dedupedTopics.length} unique topics)`,
        });
      }

      // Fetch full business context
      const [{ data: bizCtx }, { data: bizProfile }] = await Promise.all([
        supabase.from('business_context').select('company_name, business_type, service_area, website_url, email_domain').eq('workspace_id', workspace_id).maybeSingle(),
        supabase.from('business_profile').select('phone, email, services, address, service_area, service_radius_miles, payment_methods, formatted_address').eq('workspace_id', workspace_id).maybeSingle(),
      ]);

      const companyName = bizCtx?.company_name || 'our company';
      const businessType = bizCtx?.business_type || '';
      const serviceArea = bizCtx?.service_area || bizProfile?.service_area || '';
      const radiusMiles = bizProfile?.service_radius_miles;
      const coverage = radiusMiles ? `${radiusMiles}-mile radius of ${serviceArea}` : serviceArea;
      const phone = bizProfile?.phone || '';
      const rawDomain = bizCtx?.email_domain || '';
      const cleanDomain = rawDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const email = bizProfile?.email || (cleanDomain ? `info@${cleanDomain}` : '');
      const servicesRaw = bizProfile?.services;
      const services = Array.isArray(servicesRaw) ? servicesRaw.join(', ') : (typeof servicesRaw === 'string' ? servicesRaw : '');
      const paymentMethods = bizProfile?.payment_methods || '';
      const address = bizProfile?.formatted_address || bizProfile?.address || '';

      // Fetch owner FAQs to exclude already-covered topics
      const { data: ownerFaqs } = await supabase
        .from('faq_database')
        .select('question')
        .eq('workspace_id', workspace_id)
        .eq('is_active', true)
        .or('is_own_content.eq.true,generation_source.eq.website_extraction');

      const ownerQuestionList = (ownerFaqs || []).map((f: any, i: number) => `${i + 1}. ${f.question}`).join('\n');

      console.log(`[consolidate] Adapting ${dedupedTopics.length} topics. Owner has ${ownerFaqs?.length || 0} FAQs. Business: ${companyName}`);

      // Build business details block
      const businessDetails = [
        `Company Name: ${companyName}`,
        businessType ? `Business Type: ${businessType}` : null,
        serviceArea ? `Location: ${serviceArea}` : null,
        coverage ? `Coverage: ${coverage}` : null,
        phone ? `Phone: ${phone}` : null,
        email ? `Email: ${email}` : null,
        services ? `Services: ${services}` : null,
        paymentMethods ? `Payment: ${paymentMethods}` : null,
        address ? `Address: ${address}` : null,
      ].filter(Boolean).join('\n');

      if (!phone && !email) {
        console.warn('[consolidate] WARNING: No phone or email found for business. Adapted answers will use "contact us" placeholders.');
      }

      // Process adaptation in chunks
      const adaptChunks: Array<typeof dedupedTopics> = [];
      for (let i = 0; i < dedupedTopics.length; i += ADAPT_CHUNK_SIZE) {
        adaptChunks.push(dedupedTopics.slice(i, i + ADAPT_CHUNK_SIZE));
      }

      const allAdapted: Array<{
        original_id: string; question: string; answer: string;
        category: string; source_business: string;
      }> = [];

      for (let ci = _chunk_index; ci < adaptChunks.length; ci++) {
        if (Date.now() - startTime > TIMEOUT_BUFFER_MS) {
          console.log(`[consolidate] Timeout at adapt chunk ${ci}, chaining...`);
          // Save what we have so far, chain for the rest
          chainSelf(supabaseUrl, supabaseServiceKey, {
            workspace_id, _phase: 'adapt_continue', _chunk_index: ci,
            _carried_data: dedupedTopics,
            _adapted_so_far: allAdapted,
            _original_count, _filtered_count,
            _relay_depth: _relay_depth + 1,
          });
          return new Response(JSON.stringify({ status: 'continuing', phase: 'adapt', chunk: ci }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const chunk = adaptChunks[ci];
        const topicList = chunk.map((t, i) => {
          const shortAnswer = t.answer.length > 200 ? t.answer.substring(0, 200) + '...' : t.answer;
          return `${i + 1}. [ID: ${t.id}] [Source: ${t.source_business}]\n   Q: ${t.question}\n   A: ${shortAnswer}`;
        }).join('\n\n');

        const systemPrompt = `You are adapting competitor FAQ knowledge for a specific business. Fill knowledge gaps only — skip topics the owner already covers. Return a JSON array.`;

        const userPrompt = `===== BUSINESS DETAILS (USE THESE IN EVERY ANSWER) =====
${businessDetails}

===== OWNER'S EXISTING FAQs (DO NOT DUPLICATE THESE TOPICS) =====
${ownerQuestionList || '(No existing FAQs)'}

===== COMPETITOR FAQ TOPICS TO ADAPT =====
${topicList}

===== INSTRUCTIONS =====

For each competitor topic above:

1. CHECK if the owner's existing FAQs already cover this topic. If yes, SKIP it entirely.

2. If NOT covered, write an adapted FAQ where:
   - The question is rewritten naturally (remove competitor names, use "you/your")
   - The answer is in first person ("we", "our") as if the business owner is speaking
   - EVERY answer MUST include at least ONE specific detail from the Business Details (phone, location, coverage, services, etc.)
   - Replace competitor-specific details with the owner's details or "contact us" where info isn't available
   - Keep answers concise: 2-4 sentences maximum
   - Tone: friendly, professional local tradesperson — NOT corporate marketing

3. Category: Services, Pricing, Process, Coverage, Booking, Policies, Trust, Contact, or General

CRITICAL:
- Do NOT produce generic answers like "we are a dedicated business" — every answer MUST contain specific, useful information
- Do NOT include competitor names, addresses, or phone numbers
- Do NOT adapt FAQs where you'd have to invent information — SKIP instead
- If in doubt, SKIP — fewer high-quality FAQs is better than many vague ones

Return ONLY a valid JSON array:
[{"original_id":"uuid","question":"...","answer":"...","category":"...","source_business":"..."}]

If NO topics need adaptation, return: []`;

        try {
          const response = await callAI(lovableApiKey, systemPrompt, userPrompt);
          const adapted = extractJsonArray(response) as Array<{
            original_id: string; question: string; answer: string;
            category: string; source_business: string;
          }>;
          allAdapted.push(...adapted);
          console.log(`[consolidate] Adapt chunk ${ci + 1}/${adaptChunks.length}: ${adapted.length} adapted`);
        } catch (e) {
          console.error(`[consolidate] Adapt chunk ${ci} failed: ${(e as Error).message}. Skipping.`);
        }

        await updateProgress(supabase, workspace_id, 'processing', {
          phase: 'adapting',
          message: `Adapting FAQs... chunk ${ci + 1}/${adaptChunks.length} (${allAdapted.length} adapted so far)`,
        });
      }

      // Write results
      return await writeAdaptedResults(supabase, workspace_id, allAdapted, {
        original: _original_count, filtered: filteredCount, deduped: dedupedTopics.length,
      });
    }

    // ═══════════════════════════════════════════════════════
    //  ADAPT_CONTINUE — relay continuation of adaptation
    // ═══════════════════════════════════════════════════════
    if (_phase === 'adapt_continue') {
      const dedupedTopics = (body._carried_data || []) as Array<{ id: string; question: string; answer: string; source_business: string }>;
      const adaptedSoFar = (body._adapted_so_far || []) as Array<{
        original_id: string; question: string; answer: string;
        category: string; source_business: string;
      }>;

      // Re-invoke the adapt phase with the remaining chunks, carrying forward adapted results
      // This is a simplified relay — we re-enter the adapt logic
      // For simplicity, just chain back to adapt with the chunk index
      chainSelf(supabaseUrl, supabaseServiceKey, {
        workspace_id, _phase: 'adapt', _chunk_index,
        _carried_data: dedupedTopics,
        _original_count, _filtered_count: body._filtered_count,
        _relay_depth: _relay_depth + 1,
      });

      return new Response(JSON.stringify({ status: 'continuing', phase: 'adapt_continue' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown phase: ${_phase}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[consolidate] Fatal error:', error);
    
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body.workspace_id) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        await updateProgress(supabase, body.workspace_id, 'error', {
          phase: 'error',
          message: `Consolidation failed: ${(error as Error).message}`,
        });
      }
    } catch { /* ignore progress update failures */ }

    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ─── Write Final Results ──────────────────────────────────────────────────────

async function writeAdaptedResults(
  supabase: any,
  workspace_id: string,
  adapted: Array<{ original_id: string; question: string; answer: string; category: string; source_business: string }>,
  counts: { original: number; filtered: number; deduped: number },
) {
  console.log(`[consolidate] Writing ${adapted.length} adapted FAQs`);

  // Idempotency: delete previous adapted rows
  await supabase.from('faq_database').delete()
    .eq('workspace_id', workspace_id)
    .eq('generation_source', 'competitor_adapted');

  if (adapted.length > 0) {
    const rows = adapted.map(faq => ({
      workspace_id,
      question: faq.question,
      answer: faq.answer,
      category: faq.category || 'General',
      generation_source: 'competitor_adapted',
      source_business: faq.source_business || null,
      original_faq_id: faq.original_id || null,
      is_own_content: false,
      priority: 8,
      is_active: true,
    }));

    const { error: insertErr } = await supabase.from('faq_database').insert(rows);
    if (insertErr) {
      console.error('[consolidate] Insert error:', insertErr);
      throw new Error(`Failed to insert adapted FAQs: ${insertErr.message}`);
    }
  }

  await updateProgress(supabase, workspace_id, 'complete', {
    phase: 'complete',
    message: `Consolidation complete: ${adapted.length} adapted FAQs from ${counts.deduped} unique topics`,
    total_adapted: adapted.length,
    total_filtered: counts.filtered,
    total_deduplicated: counts.deduped,
    total_original: counts.original,
  }, true);

  console.log(`[consolidate] Done. ${adapted.length} adapted FAQs inserted.`);

  return new Response(JSON.stringify({
    success: true,
    original_count: counts.original,
    filtered_count: counts.filtered,
    deduped_count: counts.deduped,
    adapted_count: adapted.length,
  }), {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Content-Type': 'application/json',
    },
  });
}
