import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 5;
const MAX_RUNTIME_MS = 25000;

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;
const waitUntil = (p: Promise<unknown>) => { try { EdgeRuntime?.waitUntil(p); } catch { /* ignore */ } };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const { jobId, workspaceId } = await req.json();
    console.log('[extract-faqs] Starting:', { jobId });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      await supabase.from('competitor_research_jobs').update({
        status: 'error', error_message: 'No Lovable API key'
      }).eq('id', jobId);
      return new Response(JSON.stringify({ error: 'No Lovable API key' }), {
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

    await supabase.from('competitor_research_jobs').update({
      status: 'extracting',
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Get pages to extract from (join with sites to get business_name)
    const { data: pages } = await supabase
      .from('competitor_pages')
      .select('*, site:competitor_sites!inner(business_name, url, job_id)')
      .eq('site.job_id', jobId)
      .eq('faqs_extracted', false)
      .gt('word_count', 100)
      .limit(BATCH_SIZE);

    console.log(`[extract-faqs] Processing ${pages?.length || 0} pages`);

    let faqsExtracted = 0;

    for (const page of pages || []) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) break;

      console.log(`[extract-faqs] Extracting from: ${page.url}`);

      try {
        const industry = job.industry || job.niche_query || 'business';
        const prompt = `Extract FAQs from this ${industry} business website content.

WEBSITE: ${page.site?.business_name || 'Unknown'}
PAGE TYPE: ${page.page_type}
CONTENT:
${page.content?.substring(0, 8000) || ''}

Extract 5-15 question-answer pairs that would help someone considering this service.
Focus on: pricing, services, process, policies, coverage area, guarantees.

Return ONLY valid JSON array:
[
  {
    "question": "What services do you offer?",
    "answer": "We offer...",
    "category": "services"
  }
]

Categories: services, pricing, process, policies, coverage, trust, booking, faq

Return ONLY the JSON array, no explanation.`;

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
          console.error('[extract-faqs] AI error:', response.status);
          continue;
        }

        const aiData = await response.json();
        const content = aiData.choices?.[0]?.message?.content;
        if (!content) continue;

        // Parse JSON
        let faqs;
        try {
          const text = content.trim();
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (!jsonMatch) continue;
          faqs = JSON.parse(jsonMatch[0]);
        } catch {
          console.error('[extract-faqs] JSON parse error');
          continue;
        }

        // Insert FAQs
        for (const faq of faqs) {
          if (!faq.question || !faq.answer) continue;
          if (faq.question.length < 10 || faq.answer.length < 20) continue;

          await supabase.from('competitor_faqs_raw').insert({
            workspace_id: workspaceId,
            job_id: jobId,
            site_id: page.site_id,
            page_id: page.id,
            question: faq.question.substring(0, 500),
            answer: faq.answer.substring(0, 2000),
            category: faq.category || 'general',
            source_url: page.url,
            source_business: page.site?.business_name,
          });

          faqsExtracted++;
        }

        // Mark page as processed
        await supabase.from('competitor_pages').update({
          faqs_extracted: true,
          faq_count: faqs.length,
        }).eq('id', page.id);

      } catch (err) {
        console.error(`[extract-faqs] Error: ${page.url}`, err);
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 500));
    }

    // Update job
    const { data: currentJob } = await supabase
      .from('competitor_research_jobs')
      .select('faqs_extracted')
      .eq('id', jobId)
      .single();

    await supabase.from('competitor_research_jobs').update({
      faqs_extracted: (currentJob?.faqs_extracted || 0) + faqsExtracted,
      faqs_generated: (currentJob?.faqs_extracted || 0) + faqsExtracted,
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Check if more pages
    const { count: remainingCount } = await supabase
      .from('competitor_pages')
      .select('*, site:competitor_sites!inner(job_id)', { count: 'exact', head: true })
      .eq('site.job_id', jobId)
      .eq('faqs_extracted', false)
      .gt('word_count', 100);

    if (remainingCount && remainingCount > 0) {
      waitUntil(supabase.functions.invoke('competitor-extract-faqs', { body: { jobId, workspaceId } }));
    } else {
      // Move to deduplication
      await supabase.from('competitor_research_jobs').update({
        status: 'deduplicating'
      }).eq('id', jobId);
      waitUntil(supabase.functions.invoke('competitor-dedupe-faqs', { body: { jobId, workspaceId } }));
    }

    return new Response(JSON.stringify({
      success: true,
      faqsExtracted,
      remaining: remainingCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[extract-faqs] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
