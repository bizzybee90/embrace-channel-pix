import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FUNCTION_NAME = 'extract-competitor-faqs'
const MAX_ITERATIONS = 50; // Max 500 pages total (10 per batch)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { jobId, workspaceId, iteration = 0 } = await req.json()
    
    console.log(`[${FUNCTION_NAME}] Starting extraction (iteration ${iteration}):`, jobId)

    // =========================================
    // GUARD 1: Max iterations check
    // =========================================
    if (iteration >= MAX_ITERATIONS) {
      console.log(`[${FUNCTION_NAME}] Max iterations reached, stopping`);
      return new Response(JSON.stringify({
        success: true,
        message: 'Max iterations reached',
        stopped: true
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY')
    
    if (!GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY not configured')
    }

    // =========================================
    // GUARD 2: Check job status before proceeding
    // =========================================
    const { data: job } = await supabase
      .from('competitor_research_jobs')
      .select('status')
      .eq('id', jobId)
      .single();

    if (!job || ['completed', 'cancelled', 'failed', 'error'].includes(job.status)) {
      console.log(`[${FUNCTION_NAME}] Job not active (${job?.status}), stopping`);
      return new Response(JSON.stringify({
        success: true,
        message: `Job is ${job?.status || 'not found'}`,
        stopped: true
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // =========================================
    // STEP 1: Get unprocessed pages
    // =========================================
    
    const { data: pages, error: pagesError } = await supabase
      .from('competitor_pages')
      .select('*')
      .eq('job_id', jobId)
      .eq('faqs_extracted', false)
      .limit(10)  // Process 10 at a time to avoid timeout

    if (pagesError) {
      console.error(`[${FUNCTION_NAME}] Pages fetch error:`, pagesError)
      throw new Error(`Failed to fetch pages: ${pagesError.message}`)
    }

    if (!pages || pages.length === 0) {
      // All pages processed - move to refinement
      console.log(`[${FUNCTION_NAME}] All pages processed, moving to refinement`)
      
      await supabase.from('competitor_research_jobs').update({
        status: 'refining',
        heartbeat_at: new Date().toISOString()
      }).eq('id', jobId)
      
      // Trigger refinement (without await to not block)
      supabase.functions.invoke('refine-competitor-faqs', {
        body: { jobId, workspaceId, iteration: 0 }
      }).catch(err => console.error(`[${FUNCTION_NAME}] Refinement invoke error:`, err));
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Extraction complete, refinement started' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`[${FUNCTION_NAME}] Processing ${pages.length} pages`)

    // =========================================
    // STEP 2: Extract FAQs from each page
    // =========================================
    
    let totalFaqsExtracted = 0
    
    for (const page of pages) {
      if (!page.content || page.content.length < 100) {
        await supabase.from('competitor_pages')
          .update({ faqs_extracted: true, faq_count: 0 })
          .eq('id', page.id)
        continue
      }
      
      const extractPrompt = `Extract FAQs from this competitor website content.

URL: ${page.url}
CONTENT:
${page.content.substring(0, 6000)}

Extract questions that customers would commonly ask, and answers based on the content.
Focus on: pricing, services, process, coverage area, policies, guarantees.

Return ONLY a valid JSON array:
[
  {"question": "Do you offer X?", "answer": "Yes, we...", "category": "services"},
  {"question": "How much does X cost?", "answer": "Prices start from...", "category": "pricing"}
]

Categories: services, pricing, process, coverage, policies, trust, booking
If no FAQs can be extracted, return an empty array: []`

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: extractPrompt }] }],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 2000
              }
            })
          }
        )
        
        if (!response.ok) {
          const errorText = await response.text()
          console.error(`[${FUNCTION_NAME}] Gemini error for ${page.url}:`, errorText)
          // Mark as processed to avoid infinite retry
          await supabase.from('competitor_pages')
            .update({ faqs_extracted: true, faq_count: 0 })
            .eq('id', page.id)
          continue
        }
        
        const data = await response.json()
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
        
        // Parse JSON
        const cleanJson = responseText
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim()
        
        let faqs: any[] = []
        try {
          faqs = JSON.parse(cleanJson)
        } catch (e) {
          console.warn(`[${FUNCTION_NAME}] JSON parse error for ${page.url}`)
          faqs = []
        }
        
        if (Array.isArray(faqs) && faqs.length > 0) {
          // Get site_id for this page
          let siteId: string | null = null
          try {
            const domain = new URL(page.url).hostname.replace(/^www\./, '').toLowerCase()
            const { data: site } = await supabase
              .from('competitor_sites')
              .select('id')
              .eq('job_id', jobId)
              .eq('domain', domain)
              .single()
            siteId = site?.id || null
          } catch {}
          
          const faqInserts = faqs.map((faq: any) => ({
            job_id: jobId,
            workspace_id: workspaceId,
            site_id: siteId,
            source_url: page.url,
            question: faq.question,
            answer: faq.answer,
            category: faq.category || 'general',
            is_refined: false
          }))
          
          const { error: insertError } = await supabase
            .from('competitor_faqs_raw')
            .insert(faqInserts)
          
          if (insertError) {
            console.error(`[${FUNCTION_NAME}] FAQ insert error:`, insertError)
          } else {
            totalFaqsExtracted += faqs.length
          }
        }
        
        // Mark page as processed (ALWAYS, even if no FAQs found)
        await supabase.from('competitor_pages')
          .update({ faqs_extracted: true, faq_count: faqs.length })
          .eq('id', page.id)
          
      } catch (e) {
        console.error(`[${FUNCTION_NAME}] Error for page ${page.url}:`, e)
        // Mark as processed to avoid infinite retry
        await supabase.from('competitor_pages')
          .update({ faqs_extracted: true, faq_count: 0 })
          .eq('id', page.id)
      }
      
      // Small delay between API calls
      await new Promise(r => setTimeout(r, 500))
    }

    console.log(`[${FUNCTION_NAME}] Extracted ${totalFaqsExtracted} FAQs from ${pages.length} pages`)

    // Update job count
    const { data: currentJob } = await supabase
      .from('competitor_research_jobs')
      .select('faqs_extracted')
      .eq('id', jobId)
      .single()
    
    await supabase.from('competitor_research_jobs').update({
      faqs_extracted: (currentJob?.faqs_extracted || 0) + totalFaqsExtracted,
      heartbeat_at: new Date().toISOString()
    }).eq('id', jobId)

    // Check if more pages to process
    const { count } = await supabase
      .from('competitor_pages')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('faqs_extracted', false)
    
    if (count && count > 0) {
      // More pages - trigger self again WITH iteration counter
      console.log(`[${FUNCTION_NAME}] ${count} pages remaining, continuing (iteration ${iteration + 1})...`)
      
      supabase.functions.invoke('extract-competitor-faqs', {
        body: { jobId, workspaceId, iteration: iteration + 1 }
      }).catch(err => console.error(`[${FUNCTION_NAME}] Self-invoke error:`, err));
    } else {
      // Done - trigger refinement
      console.log(`[${FUNCTION_NAME}] All pages done, triggering refinement`)
      
      await supabase.from('competitor_research_jobs').update({
        status: 'refining',
        heartbeat_at: new Date().toISOString()
      }).eq('id', jobId)
      
      supabase.functions.invoke('refine-competitor-faqs', {
        body: { jobId, workspaceId, iteration: 0 }
      }).catch(err => console.error(`[${FUNCTION_NAME}] Refinement invoke error:`, err));
    }

    return new Response(JSON.stringify({
      success: true,
      pagesProcessed: pages.length,
      faqsExtracted: totalFaqsExtracted,
      remainingPages: count || 0,
      iteration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error(`[${FUNCTION_NAME}] Error:`, error)
    return new Response(JSON.stringify({
      success: false,
      error: String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
