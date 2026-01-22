import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'website-scrape';
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const FIRECRAWL_API = 'https://api.firecrawl.dev/v1';

// Priority pages to scrape for FAQ extraction
const PRIORITY_PAGE_PATTERNS = [
  /faq/i,
  /frequently.asked/i,
  /questions/i,
  /help/i,
  /support/i,
  /about/i,
  /services/i,
  /pricing/i,
  /price/i,
  /rates/i,
  /contact/i,
  /policy/i,
  /terms/i,
  /how.it.works/i,
  /booking/i,
];

const MAX_PAGES_TO_SCRAPE = 10;

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

interface PageContent {
  url: string;
  markdown: string;
  title?: string;
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

    const { workspace_id, website_url, multi_page = true } = body;

    // Validate URL format
    let url = website_url.trim();
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    console.log(`[${FUNCTION_NAME}] Starting:`, { workspace_id, website_url: url, multi_page });

    // -------------------------------------------------------------------------
    // Step 1: Discover pages with Firecrawl Map (if multi-page enabled)
    // -------------------------------------------------------------------------
    let pagesToScrape: string[] = [url];

    if (multi_page) {
      console.log(`[${FUNCTION_NAME}] Mapping site for priority pages...`);
      
      try {
        const mapResponse = await fetch(`${FIRECRAWL_API}/map`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url,
            limit: 100 // Get up to 100 URLs to filter
          })
        });

        if (mapResponse.ok) {
          const mapData = await mapResponse.json();
          const allLinks: string[] = mapData.links || mapData.data?.links || [];
          
          console.log(`[${FUNCTION_NAME}] Found ${allLinks.length} pages on site`);

          // Filter to priority pages
          const priorityPages = allLinks.filter(link => 
            PRIORITY_PAGE_PATTERNS.some(pattern => pattern.test(link))
          );

          // Always include homepage + priority pages, up to max
          const uniquePages = [...new Set([url, ...priorityPages])];
          pagesToScrape = uniquePages.slice(0, MAX_PAGES_TO_SCRAPE);
          
          console.log(`[${FUNCTION_NAME}] Selected ${pagesToScrape.length} priority pages:`, 
            pagesToScrape.map(p => new URL(p).pathname)
          );
        } else {
          console.warn(`[${FUNCTION_NAME}] Map failed, falling back to single page`);
        }
      } catch (mapError) {
        console.warn(`[${FUNCTION_NAME}] Map error, falling back to single page:`, mapError);
      }
    }

    // -------------------------------------------------------------------------
    // Step 2: Scrape all selected pages in parallel
    // -------------------------------------------------------------------------
    console.log(`[${FUNCTION_NAME}] Scraping ${pagesToScrape.length} pages...`);
    
    const scrapePromises = pagesToScrape.map(async (pageUrl): Promise<PageContent | null> => {
      try {
        const scrapeResponse = await fetch(`${FIRECRAWL_API}/scrape`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: pageUrl,
            formats: ['markdown'],
            onlyMainContent: true
          })
        });

        if (!scrapeResponse.ok) {
          console.warn(`[${FUNCTION_NAME}] Failed to scrape ${pageUrl}: ${scrapeResponse.status}`);
          return null;
        }

        const scrapeData = await scrapeResponse.json();
        const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';
        const title = scrapeData.data?.metadata?.title || '';

        if (markdown.length < 50) {
          return null;
        }

        return { url: pageUrl, markdown, title };
      } catch (err) {
        console.warn(`[${FUNCTION_NAME}] Error scraping ${pageUrl}:`, err);
        return null;
      }
    });

    const scrapedPages = (await Promise.all(scrapePromises)).filter(Boolean) as PageContent[];
    
    if (scrapedPages.length === 0) {
      throw new Error('Could not extract meaningful content from website');
    }

    // Combine all page content with section headers
    const combinedMarkdown = scrapedPages.map(page => {
      const pagePath = new URL(page.url).pathname || '/';
      return `\n\n## PAGE: ${page.title || pagePath}\nURL: ${page.url}\n\n${page.markdown}`;
    }).join('\n\n---\n');

    const totalChars = combinedMarkdown.length;
    console.log(`[${FUNCTION_NAME}] Scraped ${scrapedPages.length} pages, ${totalChars} total characters`);

    // -------------------------------------------------------------------------
    // Step 3: Extract FAQs and business info with Gemini
    // -------------------------------------------------------------------------
    const prompt = `You are analyzing a business website (multiple pages). Extract FAQs and business information.

WEBSITE CONTENT (${scrapedPages.length} pages):
${combinedMarkdown.substring(0, 120000)}

Extract the following:

1. **Business Details**: Name, services, service area, contact info, opening hours
2. **FAQs**: Any explicit Q&A sections from any page
3. **Implicit FAQs**: Turn service descriptions, pricing info, policies into Q&A format

For FAQs, create questions customers would actually ask, with answers based on the website content.
Since you have multiple pages, you should find MORE FAQs than a single-page scrape.

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

Generate 20-50 high-quality FAQs. Focus on:
- Services offered (from services pages)
- Pricing (from pricing pages)
- Coverage area
- Booking process
- Policies (cancellation, payment, from policy pages)
- Frequently asked questions (from FAQ pages)
- About the company (from about pages)
- Unique selling points`;

    const geminiResponse = await fetch(`${GEMINI_API}?key=${googleApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 16384 // Increased for more FAQs
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

    console.log(`[${FUNCTION_NAME}] Extracted ${extractedData.faqs?.length || 0} FAQs from ${scrapedPages.length} pages`);

    // -------------------------------------------------------------------------
    // Step 4: Save FAQs with priority 10 (gold standard)
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
    // Step 5: Update business profile
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
    // Step 6: Update business context
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
    console.log(`[${FUNCTION_NAME}] Completed in ${duration}ms: ${faqsCreated} FAQs from ${scrapedPages.length} pages`);

    return new Response(
      JSON.stringify({
        success: true,
        pages_scraped: scrapedPages.length,
        pages_found: pagesToScrape.length,
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