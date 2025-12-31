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
    const { jobId, workspaceId } = await req.json();
    console.log('FAQ generation started:', { jobId });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get job info
    const { data: job } = await supabase
      .from('competitor_research_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job) {
      return new Response(JSON.stringify({ error: 'Job not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get all scraped content
    const { data: scrapedSites } = await supabase
      .from('competitor_sites')
      .select('domain, content_extracted')
      .eq('job_id', jobId)
      .eq('status', 'scraped')
      .not('content_extracted', 'is', null);

    if (!scrapedSites || scrapedSites.length === 0) {
      await supabase.from('competitor_research_jobs').update({
        status: 'error',
        error_message: 'No content to analyze',
      }).eq('id', jobId);

      return new Response(JSON.stringify({ error: 'No scraped content' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Generating FAQs from ${scrapedSites.length} scraped sites`);

    // Combine content (limit to avoid token limits)
    let combinedContent = '';
    for (const site of scrapedSites) {
      if (combinedContent.length > 80000) break; // ~20k tokens
      combinedContent += `\n\n=== ${site.domain} ===\n${site.content_extracted?.substring(0, 10000) || ''}`;
    }

    // Generate FAQs using AI
    const faqPrompt = `You are analyzing competitor websites in the "${job.niche_query}" industry${job.service_area ? ` in ${job.service_area}` : ''}.

Based on the website content below, extract and synthesize the most common and valuable FAQ questions and answers that customers ask.

REQUIREMENTS:
1. Generate 30-50 unique FAQ entries
2. Group by categories: Pricing, Services, Process, Scheduling, Guarantees, Materials, Insurance, Cancellation, Availability, Other
3. Synthesize answers from multiple sources - don't just copy verbatim
4. Make answers helpful and complete (2-4 sentences each)
5. Focus on questions that real customers would ask
6. Avoid duplicates or very similar questions

Output as a JSON array with objects containing:
- "question": The FAQ question
- "answer": A synthesized, helpful answer
- "category": One of the categories above

COMPETITOR WEBSITE CONTENT:
${combinedContent}

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
              { role: 'system', content: 'You are an expert FAQ generator. Output valid JSON only.' },
              { role: 'user', content: faqPrompt }
            ],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || '';
          
          // Extract JSON
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

    // Fallback to OpenAI if needed
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
              { role: 'system', content: 'You are an expert FAQ generator. Output valid JSON only.' },
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
      await supabase.from('competitor_research_jobs').update({
        status: 'error',
        error_message: 'Failed to generate FAQs from content',
      }).eq('id', jobId);

      return new Response(JSON.stringify({ error: 'FAQ generation failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Generated ${generatedFaqs.length} FAQs`);

    // Get existing FAQs to check for duplicates
    const { data: existingFaqs } = await supabase
      .from('faq_database')
      .select('question')
      .eq('workspace_id', workspaceId);

    const existingQuestions = new Set(
      (existingFaqs || []).map(f => f.question.toLowerCase().trim())
    );

    // Filter and insert unique FAQs
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

    // Store candidates for audit
    const candidatesToInsert = generatedFaqs.map(faq => ({
      job_id: jobId,
      workspace_id: workspaceId,
      question: faq.question,
      answer: faq.answer,
      category: faq.category,
      status: existingQuestions.has(faq.question.toLowerCase().trim()) ? 'duplicate' : 'merged',
    }));

    await supabase.from('competitor_faq_candidates').insert(candidatesToInsert);

    // Update job as complete
    await supabase.from('competitor_research_jobs').update({
      status: 'completed',
      faqs_generated: generatedFaqs.length,
      faqs_added: insertedCount,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);

    console.log(`Complete: ${generatedFaqs.length} generated, ${insertedCount} added`);

    return new Response(JSON.stringify({
      success: true,
      generated: generatedFaqs.length,
      added: insertedCount,
      duplicates: generatedFaqs.length - newFaqs.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('FAQ generation error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
