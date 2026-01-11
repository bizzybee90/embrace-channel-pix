import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent';
const FIRECRAWL_API = 'https://api.firecrawl.dev/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'competitor-scrape';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY');
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

    if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');
    if (!FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY not configured');

    const body = await req.json();
    console.log(`[${functionName}] Starting:`, { workspace_id: body.workspace_id });

    if (!body.workspace_id) throw new Error('workspace_id is required');

    // Get user's business profile for tailoring
    const { data: profile } = await supabase
      .from('business_profile')
      .select('*')
      .eq('workspace_id', body.workspace_id)
      .single();

    // Get discovered competitors
    const { data: competitors } = await supabase
      .from('competitor_sites')
      .select('*')
      .eq('workspace_id', body.workspace_id)
      .eq('status', 'discovered')
      .limit(20);

    if (!competitors || competitors.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No competitors to scrape', competitors_scraped: 0, faqs_extracted: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[${functionName}] Scraping ${competitors.length} competitors`);

    // Scrape all competitors with Firecrawl
    const scrapedContent: { name: string; url: string; content: string }[] = [];

    for (const comp of competitors) {
      try {
        console.log(`[${functionName}] Scraping: ${comp.url}`);
        
        const scrapeResponse = await fetch(`${FIRECRAWL_API}/scrape`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: comp.url,
            formats: ['markdown'],
            onlyMainContent: true
          })
        });

        if (scrapeResponse.ok) {
          const data = await scrapeResponse.json();
          const markdown = data.data?.markdown || data.markdown || '';
          
          if (markdown.length > 100) {
            scrapedContent.push({
              name: comp.business_name || comp.domain,
              url: comp.url,
              content: markdown.substring(0, 30000)  // Limit per competitor
            });

            // Update status
            await supabase
              .from('competitor_sites')
              .update({ 
                scrape_status: 'scraped',
                scraped_at: new Date().toISOString()
              })
              .eq('id', comp.id);
              
            console.log(`[${functionName}] Scraped successfully: ${comp.url} (${markdown.length} chars)`);
          } else {
            console.log(`[${functionName}] Skipped (too short): ${comp.url}`);
          }
        } else {
          console.error(`[${functionName}] Firecrawl error for ${comp.url}: ${scrapeResponse.status}`);
        }
      } catch (e) {
        console.error(`[${functionName}] Failed to scrape ${comp.url}:`, e);
      }
    }

    console.log(`[${functionName}] Scraped ${scrapedContent.length} competitors, extracting FAQs...`);

    if (scrapedContent.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No content could be scraped', competitors_scraped: 0, faqs_extracted: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send ALL content to Gemini for FAQ extraction
    const competitorText = scrapedContent.map(c => 
      `=== ${c.name} (${c.url}) ===\n${c.content}`
    ).join('\n\n---\n\n');

    const userContext = `
User's Business: ${profile?.business_name || 'Unknown'}
Services: ${JSON.stringify(profile?.services || [])}
Location: ${profile?.formatted_address || profile?.service_area || 'Unknown'}
`;

    const prompt = `You are extracting FAQs from competitor websites for a business.

${userContext}

COMPETITOR WEBSITES:
${competitorText}

Extract FAQs from all competitors. For each FAQ:
1. Rewrite the answer to be about the USER's business (not the competitor)
2. Remove competitor-specific details (names, addresses, specific prices)
3. Keep useful industry information
4. Use general pricing language like "Contact us for a quote" instead of specific prices

Categories: Services, Pricing, Booking, Coverage, Policies, About, Industry

Respond with ONLY a JSON array:
[
  {
    "question": "How much does window cleaning cost?",
    "answer": "Our pricing depends on the size of your property. A typical 3-bedroom house is competitively priced. Contact us for a free, no-obligation quote.",
    "category": "Pricing",
    "source_competitor": "ABC Cleaning",
    "priority": 7
  }
]

Generate 50-100 high-quality FAQs. Prioritize unique, useful information.
Skip generic content that doesn't add value.
DO NOT include competitor names, addresses, or specific prices in answers.`;

    const geminiResponse = await fetch(`${GEMINI_API}?key=${GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 16384
        }
      })
    });

    if (!geminiResponse.ok) {
      throw new Error(`Gemini API error: ${await geminiResponse.text()}`);
    }

    const geminiData = await geminiResponse.json();
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse FAQs
    let faqs: any[];
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found');
      faqs = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`[${functionName}] Parse error:`, responseText.substring(0, 500));
      faqs = [];
    }

    console.log(`[${functionName}] Extracted ${faqs.length} FAQs from Gemini`);

    // Insert FAQs with priority 5-8 (below user's own content)
    const faqsToInsert = faqs.map(faq => ({
      workspace_id: body.workspace_id,
      question: faq.question,
      answer: faq.answer,
      category: faq.category || 'General',
      source: 'competitor',
      priority: Math.min(Math.max(faq.priority || 6, 5), 8),  // Clamp 5-8
      created_at: new Date().toISOString()
    }));

    if (faqsToInsert.length > 0) {
      const { error: insertError } = await supabase.from('faqs').insert(faqsToInsert);
      if (insertError) {
        console.error(`[${functionName}] FAQ insert error:`, insertError);
      }
    }

    // Update business context
    await supabase
      .from('business_context')
      .upsert({
        workspace_id: body.workspace_id,
        knowledge_base_status: 'competitors_scraped',
        updated_at: new Date().toISOString()
      }, { onConflict: 'workspace_id' });

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms: ${faqsToInsert.length} FAQs from ${scrapedContent.length} competitors`);

    return new Response(
      JSON.stringify({ 
        success: true,
        competitors_scraped: scrapedContent.length,
        faqs_extracted: faqsToInsert.length,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[${functionName}] Error:`, error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        function: functionName,
        duration_ms: Date.now() - startTime
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
