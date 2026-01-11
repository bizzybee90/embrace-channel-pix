import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'website-scrape';
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent';
const FIRECRAWL_API = 'https://api.firecrawl.dev/v1';

interface ExtractedData {
  business_info: {
    name?: string;
    services?: string[];
    service_area?: string;
    phone?: string;
    email?: string;
    opening_hours?: string;
  };
  faqs: Array<{
    question: string;
    answer: string;
    category: string;
  }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Validate environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const googleApiKey = Deno.env.get('GOOGLE_API_KEY');
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase environment variables not configured');
    }
    if (!googleApiKey) throw new Error('GOOGLE_API_KEY not configured');
    if (!firecrawlApiKey) throw new Error('FIRECRAWL_API_KEY not configured');

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse and validate input
    const body = await req.json();
    
    if (!body.workspace_id) throw new Error('workspace_id is required');
    if (!body.website_url) throw new Error('website_url is required');

    const { workspace_id, website_url } = body;

    // Validate URL format
    let url = website_url.trim();
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    console.log(`[${FUNCTION_NAME}] Starting:`, { workspace_id, website_url: url });

    // -------------------------------------------------------------------------
    // Step 1: Scrape website with Firecrawl
    // -------------------------------------------------------------------------
    console.log(`[${FUNCTION_NAME}] Scraping with Firecrawl...`);
    
    const scrapeResponse = await fetch(`${FIRECRAWL_API}/scrape`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true
      })
    });

    if (!scrapeResponse.ok) {
      const errorText = await scrapeResponse.text();
      console.error(`[${FUNCTION_NAME}] Firecrawl error:`, errorText);
      throw new Error(`Firecrawl error: ${scrapeResponse.status}`);
    }

    const scrapeData = await scrapeResponse.json();
    const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';

    if (!markdown || markdown.length < 100) {
      throw new Error('Could not extract meaningful content from website');
    }

    console.log(`[${FUNCTION_NAME}] Scraped ${markdown.length} characters`);

    // -------------------------------------------------------------------------
    // Step 2: Extract FAQs and business info with Gemini Pro
    // -------------------------------------------------------------------------
    const prompt = `You are analyzing a business website. Extract FAQs and business information.

WEBSITE CONTENT:
${markdown.substring(0, 100000)}

Extract the following:

1. **Business Details**: Name, services, service area, contact info, opening hours
2. **FAQs**: Any explicit Q&A sections
3. **Implicit FAQs**: Turn service descriptions, pricing info, policies into Q&A format

For FAQs, create questions customers would actually ask, with answers based on the website content.

Respond with JSON in this exact format:
{
  "business_info": {
    "name": "...",
    "services": ["..."],
    "service_area": "...",
    "phone": "...",
    "email": "...",
    "opening_hours": "..."
  },
  "faqs": [
    {
      "question": "What services do you offer?",
      "answer": "We offer...",
      "category": "Services"
    }
  ]
}

Generate 15-30 high-quality FAQs. Focus on:
- Services offered
- Pricing (if mentioned)
- Coverage area
- Booking process
- Policies (cancellation, payment)
- Unique selling points`;

    const geminiResponse = await fetch(`${GEMINI_API}?key=${googleApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192
        }
      })
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      throw new Error(`Gemini API error: ${errorText}`);
    }

    const geminiData = await geminiResponse.json();
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON response
    let extractedData: ExtractedData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      extractedData = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`[${FUNCTION_NAME}] Parse error:`, responseText.substring(0, 500));
      throw new Error('Failed to parse extraction response');
    }

    console.log(`[${FUNCTION_NAME}] Extracted ${extractedData.faqs?.length || 0} FAQs`);

    // -------------------------------------------------------------------------
    // Step 3: Save FAQs with priority 10 (gold standard)
    // -------------------------------------------------------------------------
    const faqsToInsert = (extractedData.faqs || []).map((faq) => ({
      workspace_id,
      question: faq.question.slice(0, 500),
      answer: faq.answer.slice(0, 2000),
      category: faq.category || 'General',
      source: 'user_website',
      priority: 10,  // Gold standard - highest priority
      created_at: new Date().toISOString()
    }));

    let faqsCreated = 0;
    if (faqsToInsert.length > 0) {
      const { error: insertError, data: insertedFaqs } = await supabase
        .from('faqs')
        .upsert(faqsToInsert, { onConflict: 'workspace_id,question' })
        .select('id');

      if (insertError) {
        console.error(`[${FUNCTION_NAME}] FAQ insert error:`, insertError);
      } else {
        faqsCreated = insertedFaqs?.length || 0;
      }
    }

    // -------------------------------------------------------------------------
    // Step 4: Update business profile
    // -------------------------------------------------------------------------
    if (extractedData.business_info) {
      const bi = extractedData.business_info;
      await supabase
        .from('business_profile')
        .upsert({
          workspace_id,
          business_name: bi.name || body.business_name || 'My Business',
          services: bi.services || [],
          service_area: bi.service_area,
          phone: bi.phone,
          email: bi.email,
          website: url,
          updated_at: new Date().toISOString()
        }, { onConflict: 'workspace_id' });
    }

    // -------------------------------------------------------------------------
    // Step 5: Update business context
    // -------------------------------------------------------------------------
    await supabase
      .from('business_context')
      .upsert({
        workspace_id,
        website_url: url,
        knowledge_base_status: 'website_scraped',
        website_faqs_generated: faqsCreated,
        updated_at: new Date().toISOString()
      }, { onConflict: 'workspace_id' });

    const duration = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Completed in ${duration}ms: ${faqsCreated} FAQs created`);

    return new Response(
      JSON.stringify({
        success: true,
        faqs_extracted: faqsCreated,
        business_info: extractedData.business_info,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[${FUNCTION_NAME}] Error:`, error.message);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: FUNCTION_NAME,
        duration_ms: duration
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
