import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CHUNK_SIZE = 80;
const GEMINI_MODEL = 'gemini-2.5-flash';

interface FaqRow {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  source_business: string | null;
}

interface DedupedTopic {
  question: string;
  answer: string;
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
        maxOutputTokens: 8192,
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
  console.log(`[consolidate] Gemini response length: ${text.length}, first 200 chars: ${text.slice(0, 200)}`);
  return text;
}

function extractJsonArray(text: string): unknown[] {
  // If the entire response is already a JSON array, parse directly
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch (_) { /* fall through */ }
  }
  // Try to find a JSON array in the response
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array found in AI response');
  return JSON.parse(match[0]);
}

async function deduplicateChunk(apiKey: string, faqs: FaqRow[]): Promise<DedupedTopic[]> {
  const faqList = faqs.map((f, i) => 
    `${i + 1}. [ID: ${f.id}] [Source: ${f.source_business || 'unknown'}] Q: ${f.question}\nA: ${f.answer}`
  ).join('\n\n');

  const prompt = `You are deduplicating FAQ entries from multiple competitor businesses.

Here are ${faqs.length} FAQ entries:

${faqList}

Group these by topic. For groups of duplicates/near-duplicates, keep only the single best representative (most complete, most useful answer). Return ONLY a JSON array of unique topics:

[
  {
    "question": "the best version of the question",
    "answer": "the best version of the answer",
    "category": "a short category label or null",
    "source_business": "business name from the best entry",
    "source_faq_id": "the ID of the best entry"
  }
]

Return ONLY the JSON array, no other text.`;

  const response = await callGemini(apiKey, prompt);
  const parsed = extractJsonArray(response) as DedupedTopic[];
  return parsed;
}

async function deduplicateFaqs(apiKey: string, faqs: FaqRow[]): Promise<DedupedTopic[]> {
  if (faqs.length <= CHUNK_SIZE) {
    return deduplicateChunk(apiKey, faqs);
  }

  // Process in chunks
  const allDeduped: DedupedTopic[] = [];
  for (let i = 0; i < faqs.length; i += CHUNK_SIZE) {
    const chunk = faqs.slice(i, i + CHUNK_SIZE);
    console.log(`[consolidate] Dedup chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(faqs.length / CHUNK_SIZE)}, size=${chunk.length}`);
    const deduped = await deduplicateChunk(apiKey, chunk);
    allDeduped.push(...deduped);
  }

  // If we had multiple chunks, do a final cross-chunk dedup pass
  if (allDeduped.length > CHUNK_SIZE) {
    console.log(`[consolidate] Cross-chunk dedup pass, ${allDeduped.length} topics`);
    // Convert DedupedTopic[] to FaqRow[] format for the dedup function
    const asFaqRows: FaqRow[] = allDeduped.map(t => ({
      id: t.source_faq_id,
      question: t.question,
      answer: t.answer,
      category: t.category,
      source_business: t.source_business,
    }));
    return deduplicateChunk(apiKey, asFaqRows);
  }

  return allDeduped;
}

async function adaptGaps(
  apiKey: string,
  dedupedTopics: DedupedTopic[],
  ownerFaqs: { question: string; answer: string }[],
  businessInfo: string
): Promise<AdaptedFaq[]> {
  const ownerList = ownerFaqs.map((f, i) =>
    `${i + 1}. Q: ${f.question}\nA: ${f.answer}`
  ).join('\n\n');

  const competitorList = dedupedTopics.map((t, i) =>
    `${i + 1}. [ID: ${t.source_faq_id}] [Source: ${t.source_business || 'unknown'}] Q: ${t.question}\nA: ${t.answer}`
  ).join('\n\n');

  const prompt = `You are adapting competitor knowledge for a business. ${businessInfo}

Here are the owner's existing FAQs (AUTHORITATIVE — these topics are already covered, do NOT duplicate them):

${ownerList}

Here are deduplicated competitor FAQ topics from other businesses in the same industry:

${competitorList}

For each topic NOT already covered by the owner's FAQs, produce an adapted version using the owner's business context. Do NOT produce adapted versions for topics the owner already covers.

Write in first person ('we', 'our'). Replace competitor names, addresses, phone numbers, and specific prices with the owner's details or 'contact us for a quote' where appropriate.

Return ONLY a JSON array of adapted FAQs (empty array [] if all topics are already covered):

[
  {
    "question": "adapted question in first person",
    "answer": "adapted answer using the owner's business details, first person voice",
    "category": "a short category label or null",
    "source_business": "original competitor business name",
    "source_faq_id": "the ID from the competitor topic"
  }
]

Return ONLY the JSON array, no other text.`;

  const response = await callGemini(apiKey, prompt);
  const parsed = extractJsonArray(response) as AdaptedFaq[];
  return parsed;
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

  try {
    const { workspace_id } = await req.json();
    if (!workspace_id) {
      return new Response(
        JSON.stringify({ error: 'workspace_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update progress: starting
    await supabase.from('n8n_workflow_progress').upsert({
      workspace_id,
      workflow_type: 'consolidation',
      status: 'deduplicating',
      details: { message: 'Starting FAQ consolidation — deduplicating competitor FAQs' },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,workflow_type' });

    // Fetch business context
    const { data: bizCtx } = await supabase
      .from('business_context')
      .select('company_name, business_type, service_area')
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    const { data: bizProfile } = await supabase
      .from('business_profile')
      .select('phone, services, address, service_area, service_radius_miles')
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    // Build dynamic business info string
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

    console.log(`[consolidate] workspace=${workspace_id}, businessInfo=${businessInfo}`);

    // Fetch competitor FAQs (is_own_content = false, active)
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
      console.log('[consolidate] No competitor FAQs found, nothing to consolidate');
      await supabase.from('n8n_workflow_progress').upsert({
        workspace_id,
        workflow_type: 'consolidation',
        status: 'complete',
        details: { message: 'No competitor FAQs to consolidate', adapted_count: 0 },
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,workflow_type' });

      return new Response(
        JSON.stringify({ success: true, adapted_count: 0, message: 'No competitor FAQs found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[consolidate] Found ${competitorFaqs.length} competitor FAQs to deduplicate`);

    // Pass 1: Deduplicate
    const dedupedTopics = await deduplicateFaqs(googleApiKey, competitorFaqs as FaqRow[]);
    console.log(`[consolidate] Deduplication complete: ${competitorFaqs.length} → ${dedupedTopics.length} unique topics`);

    // Update progress: adapting
    await supabase.from('n8n_workflow_progress').upsert({
      workspace_id,
      workflow_type: 'consolidation',
      status: 'adapting',
      details: {
        message: `Deduplication complete (${dedupedTopics.length} unique topics). Adapting gap topics...`,
        deduped_count: dedupedTopics.length,
        original_count: competitorFaqs.length,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,workflow_type' });

    // Fetch owner FAQs (only authoritative sources, NOT our own previous adapted output)
    const { data: ownerFaqs, error: ownerErr } = await supabase
      .from('faq_database')
      .select('question, answer')
      .eq('workspace_id', workspace_id)
      .eq('is_active', true)
      .neq('generation_source', 'competitor_adapted');

    if (ownerErr) throw new Error(`Failed to fetch owner FAQs: ${ownerErr.message}`);

    console.log(`[consolidate] Owner has ${ownerFaqs?.length || 0} authoritative FAQs`);

    // Pass 2: Gap-only adaptation
    const adaptedFaqs = await adaptGaps(
      googleApiKey,
      dedupedTopics,
      ownerFaqs || [],
      businessInfo
    );

    console.log(`[consolidate] Adaptation complete: ${adaptedFaqs.length} gap-filling FAQs produced`);

    // Idempotency: delete previous adapted rows
    const { error: deleteErr } = await supabase
      .from('faq_database')
      .delete()
      .eq('workspace_id', workspace_id)
      .eq('generation_source', 'competitor_adapted');

    if (deleteErr) {
      console.error('[consolidate] Failed to delete old adapted FAQs:', deleteErr);
    }

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

      const { error: insertErr } = await supabase
        .from('faq_database')
        .insert(rows);

      if (insertErr) throw new Error(`Failed to insert adapted FAQs: ${insertErr.message}`);
    }

    // Update progress: complete
    await supabase.from('n8n_workflow_progress').upsert({
      workspace_id,
      workflow_type: 'consolidation',
      status: 'complete',
      details: {
        message: `Consolidation complete: ${adaptedFaqs.length} gap-filling FAQs created from ${dedupedTopics.length} unique competitor topics`,
        original_count: competitorFaqs.length,
        deduped_count: dedupedTopics.length,
        adapted_count: adaptedFaqs.length,
      },
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,workflow_type' });

    console.log(`[consolidate] Done. ${adaptedFaqs.length} adapted FAQs inserted.`);

    return new Response(
      JSON.stringify({
        success: true,
        original_count: competitorFaqs.length,
        deduped_count: dedupedTopics.length,
        adapted_count: adaptedFaqs.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[consolidate] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Try to update progress with failure
    try {
      const { workspace_id } = await req.clone().json().catch(() => ({ workspace_id: null }));
      if (workspace_id) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        await supabase.from('n8n_workflow_progress').upsert({
          workspace_id,
          workflow_type: 'consolidation',
          status: 'failed',
          details: { message: `Consolidation failed: ${message}`, error: message },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id,workflow_type' });
      }
    } catch (_) { /* best effort */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
