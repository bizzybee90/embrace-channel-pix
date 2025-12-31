import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { siteId, jobId, workspaceId, nicheQuery, serviceArea } = await req.json();
    console.log('Per-site FAQ generation started:', { siteId, jobId });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get site content
    const { data: site } = await supabase
      .from('competitor_sites')
      .select('*')
      .eq('id', siteId)
      .single();

    if (!site || !site.content_extracted) {
      console.log('No content for site:', siteId);
      return new Response(JSON.stringify({ success: false, error: 'No content' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Generating FAQs for ${site.domain} (${site.content_extracted.length} chars)`);

    // Generate FAQs from this single site
    const faqPrompt = `You are analyzing a competitor website in the "${nicheQuery}" industry${serviceArea ? ` in ${serviceArea}` : ''}.

Based on the website content below from ${site.domain}, extract valuable FAQ questions and answers.

REQUIREMENTS:
1. Generate 15-25 FAQ entries from this content
2. Categories: Pricing, Services, Process, Scheduling, Guarantees, Materials, Insurance, Cancellation, Availability, General
3. Make answers helpful and complete (2-4 sentences each)
4. Focus on questions real customers would ask
5. Extract specific details like prices, timeframes, policies when mentioned

Output as a JSON array with objects containing:
- "question": The FAQ question
- "answer": A helpful answer based on the content
- "category": One of the categories above

WEBSITE CONTENT FROM ${site.domain}:
${site.content_extracted}

Respond with ONLY a valid JSON array:`;

    let generatedFaqs: Array<{ question: string; answer: string; category: string }> = [];

    // Try Lovable AI first
    if (LOVABLE_API_KEY) {
      try {
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'You are an expert FAQ extractor. Output valid JSON only.' },
              { role: 'user', content: faqPrompt }
            ],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || '';
          
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            generatedFaqs = JSON.parse(jsonMatch[0]);
          }
        } else {
          console.error('Lovable AI failed:', aiResponse.status);
        }
      } catch (aiError) {
        console.error('Lovable AI error:', aiError);
      }
    }

    // Fallback to OpenAI
    if (generatedFaqs.length === 0 && OPENAI_API_KEY) {
      try {
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are an expert FAQ extractor. Output valid JSON only.' },
              { role: 'user', content: faqPrompt }
            ],
          }),
        });

        if (openaiResponse.ok) {
          const openaiData = await openaiResponse.json();
          const content = openaiData.choices?.[0]?.message?.content || '';
          
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            generatedFaqs = JSON.parse(jsonMatch[0]);
          }
        }
      } catch (openaiError) {
        console.error('OpenAI error:', openaiError);
      }
    }

    if (generatedFaqs.length === 0) {
      console.log('No FAQs generated for site:', site.domain);
      return new Response(JSON.stringify({ success: false, generated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Generated ${generatedFaqs.length} FAQs for ${site.domain}`);

    // Get existing FAQs to check for duplicates
    const { data: existingFaqs } = await supabase
      .from('faq_database')
      .select('question')
      .eq('workspace_id', workspaceId);

    const existingQuestions = new Set(
      (existingFaqs || []).map(f => f.question.toLowerCase().trim())
    );

    // Filter unique FAQs
    const newFaqs = generatedFaqs.filter(faq => 
      !existingQuestions.has(faq.question.toLowerCase().trim())
    );

    let insertedCount = 0;

    if (newFaqs.length > 0) {
      const faqsToInsert = newFaqs.map(faq => ({
        workspace_id: workspaceId,
        question: faq.question,
        answer: faq.answer,
        category: faq.category || 'General',
        is_active: true,
        is_own_content: false,
        is_industry_standard: false,
        generation_source: 'competitor_research',
        source_company: site.domain,
        source_url: site.url,
        priority: 5,
      }));

      const { error: insertError } = await supabase
        .from('faq_database')
        .insert(faqsToInsert);

      if (!insertError) {
        insertedCount = faqsToInsert.length;
      } else {
        console.error('FAQ insert error:', insertError);
      }
    }

    // Store as candidates for audit
    const candidatesToInsert = generatedFaqs.map(faq => ({
      job_id: jobId,
      site_id: siteId,
      workspace_id: workspaceId,
      question: faq.question,
      answer: faq.answer,
      category: faq.category,
      source_domain: site.domain,
      status: existingQuestions.has(faq.question.toLowerCase().trim()) ? 'duplicate' : 'merged',
    }));

    await supabase.from('competitor_faq_candidates').insert(candidatesToInsert);

    // Update site with FAQ count
    await supabase.from('competitor_sites').update({
      faqs_generated: generatedFaqs.length,
    }).eq('id', siteId);

    // Update job totals
    const { data: jobData } = await supabase
      .from('competitor_research_jobs')
      .select('faqs_generated, faqs_added')
      .eq('id', jobId)
      .single();

    await supabase.from('competitor_research_jobs').update({
      faqs_generated: (jobData?.faqs_generated || 0) + generatedFaqs.length,
      faqs_added: (jobData?.faqs_added || 0) + insertedCount,
    }).eq('id', jobId);

    console.log(`Site ${site.domain}: ${generatedFaqs.length} generated, ${insertedCount} added`);

    return new Response(JSON.stringify({
      success: true,
      site: site.domain,
      generated: generatedFaqs.length,
      added: insertedCount,
      duplicates: generatedFaqs.length - newFaqs.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Per-site FAQ error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
