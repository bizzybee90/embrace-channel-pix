import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 10;
const MAX_RUNTIME_MS = 25000;

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;
const waitUntil = (p: Promise<unknown>) => { try { EdgeRuntime?.waitUntil(p); } catch { /* ignore */ } };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const { jobId, workspaceId } = await req.json();
    console.log('[refine-faqs] Starting:', { jobId });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    
    if (!LOVABLE_API_KEY || !OPENAI_API_KEY) {
      await supabase.from('competitor_research_jobs').update({
        status: 'error', error_message: 'Missing API keys'
      }).eq('id', jobId);
      return new Response(JSON.stringify({ error: 'Missing API keys' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get job
    const { data: job } = await supabase
      .from('competitor_research_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job || job.status === 'cancelled') {
      return new Response(JSON.stringify({ cancelled: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get business profile or business context
    const { data: profile } = await supabase
      .from('business_profile')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single();

    // Fallback to business_context if no profile
    const { data: businessContext } = await supabase
      .from('business_context')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single();

    const businessInfo = profile || {
      business_name: businessContext?.company_name || 'Our company',
      industry: job.industry || job.niche_query,
      service_area: job.location || job.service_area || businessContext?.service_area,
      services: [],
      usps: [],
      tone_description: 'Professional and friendly',
    };

    await supabase.from('competitor_research_jobs').update({
      status: 'refining',
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Get FAQs to refine
    const { data: faqs } = await supabase
      .from('competitor_faqs_raw')
      .select('*')
      .eq('job_id', jobId)
      .eq('is_duplicate', false)
      .eq('is_refined', false)
      .limit(BATCH_SIZE);

    console.log(`[refine-faqs] Refining ${faqs?.length || 0} FAQs`);

    let faqsRefined = 0;

    for (const faq of faqs || []) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) break;

      try {
        const prompt = `You are rewriting a FAQ to be specific to a business.

BUSINESS CONTEXT:
- Name: ${businessInfo.business_name}
- Industry: ${businessInfo.industry}
- Services: ${JSON.stringify(businessInfo.services || [])}
- Service Area: ${businessInfo.service_area}
- Brand Voice: ${businessInfo.tone_description || 'Professional and friendly'}
- USPs: ${JSON.stringify(businessInfo.usps || [])}

ORIGINAL FAQ (from competitor "${faq.source_business}"):
Q: ${faq.question}
A: ${faq.answer}

TASK:
1. Score relevance (0-10): How relevant is this to OUR business?
2. Rewrite the answer to be specific to OUR business
3. Include OUR details where relevant
4. Match our brand voice
5. Decide priority: 10 if now business-specific, 5 if still generic

Return ONLY valid JSON:
{
  "relevance_score": 8,
  "rewritten_question": "...",
  "rewritten_answer": "...",
  "category": "services",
  "priority": 10,
  "confidence": 0.9
}`;

        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!response.ok) {
          console.error('[refine-faqs] AI error:', response.status);
          continue;
        }

        const aiData = await response.json();
        const content = aiData.choices?.[0]?.message?.content;
        if (!content) continue;

        let refined;
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) continue;
          refined = JSON.parse(jsonMatch[0]);
        } catch {
          console.error('[refine-faqs] JSON parse error');
          continue;
        }

        // Skip low relevance
        if (refined.relevance_score < 3) {
          await supabase.from('competitor_faqs_raw').update({
            is_refined: true
          }).eq('id', faq.id);
          continue;
        }

        // Generate embedding for refined question
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: refined.rewritten_question,
          }),
        });

        if (!embeddingResponse.ok) {
          console.error('[refine-faqs] Embedding error:', embeddingResponse.status);
          continue;
        }

        const embeddingData = await embeddingResponse.json();
        const embedding = embeddingData.data?.[0]?.embedding;

        // Insert into final FAQ database with priority = 5 (competitor research = lower priority)
        const { data: newFaq } = await supabase
          .from('faq_database')
          .insert({
            workspace_id: workspaceId,
            question: refined.rewritten_question.substring(0, 500),
            answer: refined.rewritten_answer.substring(0, 2000),
            category: refined.category || faq.category,
            priority: 5, // COMPETITOR RESEARCH = priority 5 (lower than own website at 10)
            confidence: refined.confidence || 0.8,
            relevance_score: refined.relevance_score / 10,
            source: 'competitor_research', // Mark as competitor research
            source_url: faq.source_url,
            source_business: faq.source_business,
            original_faq_id: faq.id,
            embedding: embedding,
            refined_at: new Date().toISOString(),
            is_active: true,
            is_industry_standard: true, // This is industry knowledge
          })
          .select('id')
          .single();

        // Mark raw FAQ as refined
        await supabase.from('competitor_faqs_raw').update({
          is_refined: true,
          refined_faq_id: newFaq?.id,
        }).eq('id', faq.id);

        faqsRefined++;

      } catch (err) {
        console.error(`[refine-faqs] Error refining FAQ:`, err);
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 300));
    }

    // Update job
    const { data: currentJob } = await supabase
      .from('competitor_research_jobs')
      .select('faqs_refined')
      .eq('id', jobId)
      .single();

    await supabase.from('competitor_research_jobs').update({
      faqs_refined: (currentJob?.faqs_refined || 0) + faqsRefined,
      faqs_added: (currentJob?.faqs_refined || 0) + faqsRefined,
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Check if more to refine
    const { count: remainingCount } = await supabase
      .from('competitor_faqs_raw')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('is_duplicate', false)
      .eq('is_refined', false);

    if (remainingCount && remainingCount > 0) {
      waitUntil(supabase.functions.invoke('competitor-refine-faqs', { body: { jobId, workspaceId } }));
    } else {
      // Complete!
      const { count: totalFaqs } = await supabase
        .from('faq_database')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('source', 'competitor_research');

      await supabase.from('competitor_research_jobs').update({
        status: 'completed',
        faqs_embedded: totalFaqs,
        faqs_added: totalFaqs,
        completed_at: new Date().toISOString(),
      }).eq('id', jobId);

      console.log(`[refine-faqs] COMPLETE! ${totalFaqs} FAQs in database`);
    }

    return new Response(JSON.stringify({
      success: true,
      faqsRefined,
      remaining: remainingCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[refine-faqs] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
