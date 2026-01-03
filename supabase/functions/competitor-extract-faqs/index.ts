import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 5; // Process 5 pages at a time

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;
const waitUntil = (p: Promise<unknown>) => { try { EdgeRuntime?.waitUntil(p); } catch { /* ignore */ } };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { jobId, workspaceId } = await req.json();
    console.log('[extract-faqs] Starting:', { jobId });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Use Claude (Anthropic) for FAQ extraction
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      console.error('[extract-faqs] No ANTHROPIC_API_KEY configured');
      await supabase.from('competitor_research_jobs').update({
        status: 'error',
        error_message: 'Anthropic API key not configured'
      }).eq('id', jobId);
      return new Response(JSON.stringify({ error: 'No Anthropic API key' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

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

    // Get pages that haven't been processed yet (with site info)
    const { data: pages } = await supabase
      .from('competitor_pages')
      .select('*, site:competitor_sites(business_name, url, job_id)')
      .eq('site.job_id', jobId)
      .eq('faqs_extracted', false)
      .gt('word_count', 100)
      .limit(BATCH_SIZE);

    if (!pages || pages.length === 0) {
      // No more pages - move to deduplication
      console.log('[extract-faqs] No more pages, moving to deduplication');
      await supabase.from('competitor_research_jobs').update({
        status: 'deduplicating',
      }).eq('id', jobId);
      
      waitUntil(
        supabase.functions.invoke('competitor-dedupe-faqs', { body: { jobId, workspaceId } })
      );
      
      return new Response(JSON.stringify({ success: true, complete: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[extract-faqs] Processing ${pages.length} pages with Claude`);

    let totalFaqsExtracted = 0;

    for (const page of pages) {
      console.log(`[extract-faqs] Processing: ${page.url}`);

      try {
        const industry = job.industry || job.niche_query || 'business';
        
        // Call Claude to extract FAQs
        const prompt = `Extract FAQs from this ${industry} business website content.

WEBSITE: ${page.site?.business_name || 'Unknown'}
PAGE TYPE: ${page.page_type}
URL: ${page.url}

CONTENT:
${page.content?.substring(0, 8000) || ''}

Extract 5-15 question-answer pairs that would help someone considering this type of service.
Focus on: pricing, services offered, process, policies, guarantees, coverage area, booking.

Return ONLY a valid JSON array with no other text:
[
  {"question": "What services do you offer?", "answer": "We offer...", "category": "services"},
  {"question": "How much does it cost?", "answer": "Prices start from...", "category": "pricing"}
]

Categories: services, pricing, process, policies, coverage, trust, booking, faq
Return ONLY the JSON array, no explanation, no markdown code blocks.`;

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }],
        });

        const content = response.content[0];
        if (content.type !== 'text') {
          console.log('[extract-faqs] Non-text response');
          await supabase.from('competitor_pages').update({
            faqs_extracted: true,
            faq_count: 0,
          }).eq('id', page.id);
          continue;
        }

        // Parse JSON response
        let faqs;
        try {
          let text = content.text.trim();
          // Remove markdown code blocks if present
          text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (!jsonMatch) {
            console.log('[extract-faqs] No JSON array found in response');
            await supabase.from('competitor_pages').update({
              faqs_extracted: true,
              faq_count: 0,
            }).eq('id', page.id);
            continue;
          }
          faqs = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          console.error('[extract-faqs] JSON parse error:', parseError);
          await supabase.from('competitor_pages').update({
            faqs_extracted: true,
            faq_count: 0,
          }).eq('id', page.id);
          continue;
        }

        if (!Array.isArray(faqs)) {
          console.log('[extract-faqs] Response is not an array');
          await supabase.from('competitor_pages').update({
            faqs_extracted: true,
            faq_count: 0,
          }).eq('id', page.id);
          continue;
        }

        console.log(`[extract-faqs] Extracted ${faqs.length} FAQs from ${page.url}`);

        // Store extracted FAQs
        let pageFaqCount = 0;
        for (const faq of faqs) {
          if (!faq.question || !faq.answer) continue;
          if (faq.question.length < 10 || faq.answer.length < 20) continue;

          const { error } = await supabase.from('competitor_faqs_raw').insert({
            workspace_id: workspaceId,
            job_id: jobId,
            site_id: page.site_id,
            page_id: page.id,
            question: faq.question.substring(0, 500),
            answer: faq.answer.substring(0, 2000),
            category: faq.category || 'general',
            source_url: page.url,
            source_business: page.site?.business_name || null,
            is_duplicate: false,
            is_refined: false,
          });

          if (!error) {
            pageFaqCount++;
            totalFaqsExtracted++;
          }
        }

        // Mark page as processed
        await supabase.from('competitor_pages').update({
          faqs_extracted: true,
          faq_count: pageFaqCount,
        }).eq('id', page.id);

      } catch (err) {
        console.error(`[extract-faqs] Error processing ${page.url}:`, err);
        // Mark as processed anyway to avoid infinite loop
        await supabase.from('competitor_pages').update({
          faqs_extracted: true,
          faq_count: 0,
        }).eq('id', page.id);
      }

      // Rate limiting - wait between Claude calls
      await new Promise(r => setTimeout(r, 500));
    }

    // Update job progress
    const { data: currentJob } = await supabase
      .from('competitor_research_jobs')
      .select('faqs_extracted')
      .eq('id', jobId)
      .single();

    await supabase.from('competitor_research_jobs').update({
      faqs_extracted: (currentJob?.faqs_extracted || 0) + totalFaqsExtracted,
      faqs_generated: (currentJob?.faqs_extracted || 0) + totalFaqsExtracted,
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Check if more pages to process
    const { count: remainingCount } = await supabase
      .from('competitor_pages')
      .select('*, site:competitor_sites!inner(job_id)', { count: 'exact', head: true })
      .eq('site.job_id', jobId)
      .eq('faqs_extracted', false)
      .gt('word_count', 100);

    if (remainingCount && remainingCount > 0) {
      // Continue extraction
      waitUntil(
        supabase.functions.invoke('competitor-extract-faqs', { body: { jobId, workspaceId } })
      );
    } else {
      // Move to deduplication
      await supabase.from('competitor_research_jobs').update({
        status: 'deduplicating',
      }).eq('id', jobId);
      
      waitUntil(
        supabase.functions.invoke('competitor-dedupe-faqs', { body: { jobId, workspaceId } })
      );
    }

    return new Response(JSON.stringify({
      success: true,
      pagesProcessed: pages.length,
      faqsExtracted: totalFaqsExtracted,
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
