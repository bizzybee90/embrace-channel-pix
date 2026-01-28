import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FUNCTION_NAME = 'refine-competitor-faqs'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { jobId, workspaceId } = await req.json()
    
    console.log(`[${FUNCTION_NAME}] Starting refinement for job:`, jobId)
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY')
    
    if (!GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY not configured')
    }

    // =========================================
    // STEP 1: Get voice profile for refinement
    // =========================================
    
    const { data: voiceProfile } = await supabase
      .from('voice_profiles')
      .select('voice_dna')
      .eq('workspace_id', workspaceId)
      .single()

    // =========================================
    // STEP 2: Get business info
    // =========================================
    
    const { data: businessProfile } = await supabase
      .from('business_profile')
      .select('business_name, industry')
      .eq('workspace_id', workspaceId)
      .single()

    // =========================================
    // STEP 3: Get unrefined FAQs
    // =========================================
    
    const { data: rawFaqs, error: faqsError } = await supabase
      .from('competitor_faqs_raw')
      .select('*')
      .eq('job_id', jobId)
      .eq('is_refined', false)
      .limit(20)

    if (faqsError) {
      console.error(`[${FUNCTION_NAME}] FAQs fetch error:`, faqsError)
      throw new Error(`Failed to fetch FAQs: ${faqsError.message}`)
    }

    if (!rawFaqs || rawFaqs.length === 0) {
      // All done - mark job complete
      console.log(`[${FUNCTION_NAME}] All FAQs refined, completing job`)
      
      // Count final FAQs
      const { count: faqCount } = await supabase
        .from('faq_database')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('source', 'competitor_research')
      
      await supabase.from('competitor_research_jobs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        faqs_refined: faqCount || 0
      }).eq('id', jobId)
      
      // Update workspace status
      await supabase.from('workspaces').update({
        knowledge_base_status: 'completed'
      }).eq('id', workspaceId)
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Refinement complete',
        totalFaqs: faqCount || 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`[${FUNCTION_NAME}] Refining ${rawFaqs.length} FAQs`)

    // =========================================
    // STEP 4: Batch refine FAQs
    // =========================================
    
    const voiceDna = voiceProfile?.voice_dna || {}
    const businessName = businessProfile?.business_name || 'the business'
    
    const refinePrompt = `Rewrite these competitor FAQs to sound like ${businessName}.

VOICE PROFILE:
- Greetings: ${JSON.stringify(voiceDna.openers || ['Hi'])}
- Sign-offs: ${JSON.stringify(voiceDna.closers || ['Thanks'])}
- Tone: ${JSON.stringify(voiceDna.tone_keywords || ['friendly', 'professional'])}

FAQs TO REWRITE:
${rawFaqs.map((f, i) => `${i + 1}. Q: ${f.question}\n   A: ${f.answer}`).join('\n\n')}

RULES:
- Keep the factual information but adjust tone to match voice profile
- Remove competitor-specific details (names, addresses, specific prices)
- Use generic pricing like "contact us for a quote" unless it's industry-standard
- Match the voice profile above
- Keep answers concise (2-3 sentences max)

Return ONLY a valid JSON array with the same number of items in the same order:
[
  {"question": "...", "answer": "...", "category": "..."},
  ...
]`

    let refinedFaqs: any[] = []
    
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: refinePrompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 4000
            }
          })
        }
      )
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[${FUNCTION_NAME}] Gemini error:`, errorText)
        throw new Error(`Gemini API error: ${response.status}`)
      }
      
      const data = await response.json()
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
      
      const cleanJson = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim()
      
      refinedFaqs = JSON.parse(cleanJson)
    } catch (e) {
      console.error(`[${FUNCTION_NAME}] Refinement error:`, e)
      // Mark as refined anyway to avoid infinite loop
      for (const faq of rawFaqs) {
        await supabase.from('competitor_faqs_raw')
          .update({ is_refined: true, skipped_reason: 'refinement_failed' })
          .eq('id', faq.id)
      }
      
      // Continue with remaining
      await supabase.functions.invoke('refine-competitor-faqs', {
        body: { jobId, workspaceId }
      })
      
      return new Response(JSON.stringify({
        success: false,
        error: 'Refinement failed, skipping batch'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // =========================================
    // STEP 5: Store refined FAQs
    // =========================================
    
    let storedCount = 0
    
    for (let i = 0; i < Math.min(refinedFaqs.length, rawFaqs.length); i++) {
      const faq = refinedFaqs[i]
      const original = rawFaqs[i]
      
      if (!faq?.question || !faq?.answer) {
        await supabase.from('competitor_faqs_raw')
          .update({ is_refined: true, skipped_reason: 'invalid_refinement' })
          .eq('id', original.id)
        continue
      }
      
      try {
        // Store in faq_database
        const { error: insertError } = await supabase.from('faq_database').insert({
          workspace_id: workspaceId,
          question: faq.question,
          answer: faq.answer,
          category: faq.category || original?.category || 'general',
          source: 'competitor_research',
          source_url: original?.source_url,
          priority: 5  // Lower than own website (10)
        })
        
        if (insertError) {
          console.error(`[${FUNCTION_NAME}] FAQ insert error:`, insertError)
          await supabase.from('competitor_faqs_raw')
            .update({ is_refined: true, skipped_reason: 'insert_failed' })
            .eq('id', original.id)
        } else {
          storedCount++
          await supabase.from('competitor_faqs_raw')
            .update({ is_refined: true })
            .eq('id', original.id)
        }
      } catch (e) {
        console.error(`[${FUNCTION_NAME}] Error storing FAQ:`, e)
        await supabase.from('competitor_faqs_raw')
          .update({ is_refined: true, skipped_reason: 'error' })
          .eq('id', original.id)
      }
    }
    
    // Mark any remaining originals as refined
    for (let i = refinedFaqs.length; i < rawFaqs.length; i++) {
      await supabase.from('competitor_faqs_raw')
        .update({ is_refined: true, skipped_reason: 'not_in_response' })
        .eq('id', rawFaqs[i].id)
    }

    console.log(`[${FUNCTION_NAME}] Stored ${storedCount} refined FAQs`)

    // Check if more to process
    const { count } = await supabase
      .from('competitor_faqs_raw')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('is_refined', false)
    
    if (count && count > 0) {
      // More FAQs - trigger self again
      console.log(`[${FUNCTION_NAME}] ${count} FAQs remaining, continuing...`)
      
      await supabase.functions.invoke('refine-competitor-faqs', {
        body: { jobId, workspaceId }
      })
    } else {
      // All done - mark job complete
      console.log(`[${FUNCTION_NAME}] All done, completing job`)
      
      const { count: totalFaqCount } = await supabase
        .from('faq_database')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('source', 'competitor_research')
      
      await supabase.from('competitor_research_jobs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        faqs_refined: totalFaqCount || 0
      }).eq('id', jobId)
      
      await supabase.from('workspaces').update({
        knowledge_base_status: 'completed'
      }).eq('id', workspaceId)
    }

    return new Response(JSON.stringify({
      success: true,
      faqsRefined: storedCount,
      remainingFaqs: count || 0
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
