import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'website-scrape';

// Pages to look for (in order of priority)
const TARGET_PAGES = [
  { pattern: /faq|frequently.?asked|help|support/i, name: 'FAQ' },
  { pattern: /about/i, name: 'About' },
  { pattern: /service|what.?we.?do|our.?work/i, name: 'Services' },
  { pattern: /pricing|price|cost|packages/i, name: 'Pricing' },
  { pattern: /contact/i, name: 'Contact' },
];

const MAX_PAGES = 10;
const MAX_CONTENT_LENGTH = 50000; // Characters per page

interface ScrapedPage {
  url: string;
  title: string;
  content: string;
  category: string;
}

interface ExtractedFAQ {
  question: string;
  answer: string;
  category: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let currentStep = 'initializing';

  try {
    // Validate environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!supabaseUrl) throw new Error('SUPABASE_URL environment variable not configured');
    if (!supabaseKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable not configured');
    if (!lovableApiKey) throw new Error('LOVABLE_API_KEY environment variable not configured');

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse and validate input
    currentStep = 'validating_input';
    const body = await req.json();
    
    if (!body.workspace_id) throw new Error('workspace_id is required');
    if (!body.website_url) throw new Error('website_url is required');

    const { workspace_id, website_url } = body;

    // Validate URL format
    let baseUrl: URL;
    try {
      baseUrl = new URL(website_url);
      if (!['http:', 'https:'].includes(baseUrl.protocol)) {
        throw new Error('URL must use http or https protocol');
      }
    } catch (e) {
      throw new Error(`Invalid website URL: ${website_url}`);
    }

    console.log(`[${FUNCTION_NAME}] Starting:`, { workspace_id, website_url: baseUrl.origin });

    // Verify workspace exists
    currentStep = 'verifying_workspace';
    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('id')
      .eq('id', workspace_id)
      .single();

    if (wsError || !workspace) {
      throw new Error(`Workspace not found: ${workspace_id}`);
    }

    // Step 1: Fetch and parse homepage
    currentStep = 'fetching_homepage';
    console.log(`[${FUNCTION_NAME}] Fetching homepage: ${baseUrl.origin}`);
    
    const homepageContent = await fetchPage(baseUrl.origin);
    if (!homepageContent) {
      throw new Error(`Failed to fetch homepage: ${baseUrl.origin}`);
    }

    // Step 2: Extract links from homepage
    currentStep = 'extracting_links';
    const links = extractLinks(homepageContent.html, baseUrl);
    console.log(`[${FUNCTION_NAME}] Found ${links.length} internal links`);

    // Step 3: Identify target pages
    currentStep = 'identifying_pages';
    const pagesToScrape = identifyTargetPages(links, baseUrl);
    console.log(`[${FUNCTION_NAME}] Identified ${pagesToScrape.length} target pages to scrape`);

    // Step 4: Scrape all pages
    currentStep = 'scraping_pages';
    const scrapedPages: ScrapedPage[] = [];

    // Always include homepage
    scrapedPages.push({
      url: baseUrl.origin,
      title: homepageContent.title || 'Homepage',
      content: homepageContent.text,
      category: 'Homepage'
    });

    // Scrape target pages (with rate limiting)
    for (const page of pagesToScrape.slice(0, MAX_PAGES - 1)) {
      try {
        console.log(`[${FUNCTION_NAME}] Scraping: ${page.url}`);
        const pageContent = await fetchPage(page.url);
        
        if (pageContent && pageContent.text.length > 100) {
          scrapedPages.push({
            url: page.url,
            title: pageContent.title || page.category,
            content: pageContent.text,
            category: page.category
          });
        }

        // Rate limit: 500ms between requests
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e: any) {
        console.log(`[${FUNCTION_NAME}] Skipping ${page.url}: ${e.message}`);
      }
    }

    console.log(`[${FUNCTION_NAME}] Successfully scraped ${scrapedPages.length} pages`);

    // Step 5: Extract FAQs using AI
    currentStep = 'extracting_faqs';
    const combinedContent = scrapedPages.map(p => 
      `--- PAGE: ${p.category} (${p.title}) ---\n${p.content}`
    ).join('\n\n');

    console.log(`[${FUNCTION_NAME}] Sending ${combinedContent.length} characters to AI for FAQ extraction`);

    const extractedFaqs = await extractFAQsWithAI(combinedContent, lovableApiKey);
    console.log(`[${FUNCTION_NAME}] AI extracted ${extractedFaqs.length} FAQs`);

    if (extractedFaqs.length === 0) {
      console.log(`[${FUNCTION_NAME}] No FAQs extracted, completing with zero results`);
      return new Response(
        JSON.stringify({
          success: true,
          pages_scraped: scrapedPages.length,
          faqs_created: 0,
          message: 'No FAQs could be extracted from the website content'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 6: Generate embeddings and save FAQs
    currentStep = 'saving_faqs';
    let faqsCreated = 0;

    for (const faq of extractedFaqs) {
      try {
        // Generate embedding
        const embedding = await generateEmbedding(faq.question + ' ' + faq.answer, lovableApiKey);

        // Upsert FAQ
        const { error: insertError } = await supabase
          .from('faqs')
          .upsert({
            workspace_id,
            question: faq.question.slice(0, 500),
            answer: faq.answer.slice(0, 2000),
            category: faq.category,
            source: 'website_scrape',
            embedding,
            created_at: new Date().toISOString()
          }, {
            onConflict: 'workspace_id,question'
          });

        if (insertError) {
          console.log(`[${FUNCTION_NAME}] Failed to save FAQ: ${insertError.message}`);
        } else {
          faqsCreated++;
        }
      } catch (e: any) {
        console.log(`[${FUNCTION_NAME}] Error processing FAQ: ${e.message}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Completed in ${duration}ms:`, {
      pages_scraped: scrapedPages.length,
      faqs_extracted: extractedFaqs.length,
      faqs_created: faqsCreated
    });

    return new Response(
      JSON.stringify({
        success: true,
        pages_scraped: scrapedPages.length,
        faqs_created: faqsCreated,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[${FUNCTION_NAME}] Error at step "${currentStep}":`, error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: FUNCTION_NAME,
        step: currentStep,
        duration_ms: duration
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Fetch and parse a single page
async function fetchPage(url: string): Promise<{ html: string; text: string; title: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BizzyBee/1.0 (Website Scanner for Customer Service)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`Not HTML: ${contentType}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    
    if (!doc) {
      throw new Error('Failed to parse HTML');
    }

    // Remove script and style elements
    const scripts = doc.querySelectorAll('script, style, nav, footer, header');
    scripts.forEach((el: any) => el.remove());

    // Extract title
    const titleEl = doc.querySelector('title');
    const title = titleEl?.textContent?.trim() || '';

    // Extract main content
    const mainContent = doc.querySelector('main, article, .content, #content, .main') || doc.body;
    const text = (mainContent?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CONTENT_LENGTH);

    return { html, text, title };
  } catch (e: any) {
    console.log(`[${FUNCTION_NAME}] fetchPage error for ${url}: ${e.message}`);
    return null;
  }
}

// Extract internal links from HTML
function extractLinks(html: string, baseUrl: URL): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  const links: Set<string> = new Set();
  const anchors = doc.querySelectorAll('a[href]');

  anchors.forEach((a: any) => {
    try {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }

      const fullUrl = new URL(href, baseUrl.origin);
      
      // Only include same-domain links
      if (fullUrl.hostname === baseUrl.hostname) {
        // Normalize: remove trailing slash, fragments, query params
        const normalized = fullUrl.origin + fullUrl.pathname.replace(/\/$/, '');
        links.add(normalized);
      }
    } catch {
      // Invalid URL, skip
    }
  });

  return Array.from(links);
}

// Identify which pages to scrape based on URL patterns
function identifyTargetPages(links: string[], baseUrl: URL): Array<{ url: string; category: string }> {
  const results: Array<{ url: string; category: string; priority: number }> = [];

  for (const link of links) {
    const pathname = new URL(link).pathname.toLowerCase();
    
    for (let i = 0; i < TARGET_PAGES.length; i++) {
      const target = TARGET_PAGES[i];
      if (target.pattern.test(pathname)) {
        results.push({ url: link, category: target.name, priority: i });
        break;
      }
    }
  }

  // Sort by priority and deduplicate by category
  results.sort((a, b) => a.priority - b.priority);
  
  const seen = new Set<string>();
  return results.filter(r => {
    if (seen.has(r.category)) return false;
    seen.add(r.category);
    return true;
  });
}

// Extract FAQs using AI
async function extractFAQsWithAI(content: string, apiKey: string): Promise<ExtractedFAQ[]> {
  const prompt = `You are analyzing a business website to extract FAQ content for a customer service AI.

WEBSITE CONTENT:
${content.slice(0, 40000)}

TASK:
Extract all question-answer pairs that would help answer customer inquiries. Include:
1. Explicit FAQs from the website
2. Implicit Q&As (e.g., "Our hours are 9-5" becomes Q: "What are your hours?" A: "Our hours are 9-5")
3. Service descriptions as Q&As (e.g., "We offer plumbing" becomes Q: "What services do you offer?" A: "We offer plumbing services")
4. Pricing information if available
5. Contact information and policies

OUTPUT FORMAT:
Return a JSON array of objects with: question, answer, category
Categories: General, Services, Pricing, Hours, Contact, Policies, Other

Example:
[
  {"question": "What are your business hours?", "answer": "We are open Monday to Friday, 9am to 5pm.", "category": "Hours"},
  {"question": "What services do you offer?", "answer": "We offer residential and commercial plumbing.", "category": "Services"}
]

Extract 10-30 Q&A pairs. Return ONLY valid JSON array, no other text.`;

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI Gateway error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const aiResponse = data.choices?.[0]?.message?.content;

  if (!aiResponse) {
    throw new Error('AI returned empty response');
  }

  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = aiResponse.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);
    
    if (!Array.isArray(parsed)) {
      throw new Error('AI response is not an array');
    }

    // Validate and clean
    return parsed
      .filter((item: any) => item.question && item.answer)
      .map((item: any) => ({
        question: String(item.question).trim(),
        answer: String(item.answer).trim(),
        category: String(item.category || 'General').trim()
      }));
  } catch (e: any) {
    console.log(`[${FUNCTION_NAME}] Failed to parse AI response: ${e.message}`);
    console.log(`[${FUNCTION_NAME}] Raw response: ${aiResponse.slice(0, 500)}`);
    return [];
  }
}

// Generate embedding for semantic search
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000)
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const embedding = data.data?.[0]?.embedding;

  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Invalid embedding response format');
  }

  return embedding;
}
