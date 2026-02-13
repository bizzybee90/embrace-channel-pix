import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'process-own-website-scrape';

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

// Claude Tool Definition for structured FAQ extraction
const FAQ_EXTRACTION_TOOL = {
  name: 'extract_faqs',
  description: 'Extracts structured Q&A pairs from website content for a UK service business',
  input_schema: {
    type: 'object',
    properties: {
      faqs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'Concise question a customer would ask, max 15 words' },
            answer: { type: 'string', description: 'Direct answer with UK context (£, British spelling)' },
            category: { 
              type: 'string', 
              enum: ['services', 'pricing', 'process', 'coverage', 'trust', 'booking', 'policies'],
            },
            source_type: { type: 'string', enum: ['explicit', 'implied'] },
            confidence: { type: 'integer', minimum: 0, maximum: 100 }
          },
          required: ['question', 'answer', 'category', 'source_type', 'confidence']
        }
      }
    },
    required: ['faqs']
  }
};

// =========================================
// Location page detection
// =========================================

// Common UK town/area patterns in URLs
const LOCATION_URL_PATTERNS = [
  // /service-townname or /service-town-name
  /\/[a-z]+-(?:cleaning|washing|services?)-[a-z]/i,
  // /window-cleaning-dunstable, /gutter-cleaning-hitchin etc
  /\/(?:window|gutter|fascia|soffit|conservatory|roof|solar|panel|pressure|jet|driveway|patio)[- ](?:cleaning|washing|maintenance)[- ][a-z]/i,
  // /areas/townname or /locations/townname
  /\/(?:areas?|locations?|towns?|cities?)\//i,
  // /near-me variants
  /\/near[- ]me/i,
  // /townname-window-cleaning (reversed pattern)  
  /\/[a-z]+-(?:window|gutter|fascia|pressure)[- ](?:cleaning|washing)/i,
];

function isLocationPage(url: string): boolean {
  const path = new URL(url).pathname.toLowerCase();
  return LOCATION_URL_PATTERNS.some(pattern => pattern.test(path));
}

function getLocationGroup(url: string): string {
  // Extract the service type from URL to group location pages
  const path = new URL(url).pathname.toLowerCase();
  // e.g. /window-cleaning-dunstable -> "window-cleaning"
  const match = path.match(/\/([\w-]+?)-([\w-]+?)$/);
  if (match) {
    // Check if last segment looks like a town (not a service word)
    const serviceWords = ['cleaning', 'washing', 'services', 'service', 'maintenance', 'repair'];
    if (!serviceWords.includes(match[2])) {
      return match[1]; // return the service prefix as group
    }
  }
  return 'location';
}

function filterLocationPages(pages: Array<{ url: string; [key: string]: any }>): {
  kept: typeof pages;
  skipped: typeof pages;
} {
  const locationPages: typeof pages = [];
  const nonLocationPages: typeof pages = [];

  for (const page of pages) {
    if (isLocationPage(page.url)) {
      locationPages.push(page);
    } else {
      nonLocationPages.push(page);
    }
  }

  if (locationPages.length <= 2) {
    // Few location pages, keep all
    return { kept: pages, skipped: [] };
  }

  // Group by service type and keep max 2 representative pages
  const groups = new Map<string, typeof pages>();
  for (const page of locationPages) {
    const group = getLocationGroup(page.url);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(page);
  }

  const keptLocation: typeof pages = [];
  const skippedLocation: typeof pages = [];

  for (const [, groupPages] of groups) {
    // Sort by content length desc (prefer pages with most content)
    groupPages.sort((a, b) => (b.content_markdown?.length || 0) - (a.content_markdown?.length || 0));
    keptLocation.push(...groupPages.slice(0, 2));
    skippedLocation.push(...groupPages.slice(2));
  }

  console.log(`[${FUNCTION_NAME}] Location pages: ${locationPages.length} total, keeping ${keptLocation.length}, skipping ${skippedLocation.length}`);

  return {
    kept: [...nonLocationPages, ...keptLocation],
    skipped: skippedLocation,
  };
}

// =========================================
// Post-extraction consolidation
// =========================================

async function consolidateFaqs(
  supabase: any,
  workspaceId: string,
  jobId: string
): Promise<{ before: number; after: number; contradictions: number }> {
  console.log(`[${FUNCTION_NAME}] Starting AI-powered post-extraction consolidation...`);

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

  // Fetch all active own-content FAQs
  const { data: faqs, error } = await supabase
    .from('faq_database')
    .select('id, question, answer, category, quality_score, source_type, source_page_url')
    .eq('workspace_id', workspaceId)
    .eq('is_own_content', true)
    .eq('is_active', true)
    .order('quality_score', { ascending: false });

  if (error || !faqs || faqs.length < 2) {
    console.log(`[${FUNCTION_NAME}] No consolidation needed (${faqs?.length || 0} FAQs)`);
    return { before: faqs?.length || 0, after: faqs?.length || 0, contradictions: 0 };
  }

  const beforeCount = faqs.length;

  // If 25 or fewer, skip AI consolidation (already lean)
  if (faqs.length <= 25) {
    console.log(`[${FUNCTION_NAME}] FAQ count already lean (${faqs.length}), skipping AI consolidation`);
    await supabase.from('scraping_jobs').update({ faqs_stored: faqs.length }).eq('id', jobId);
    await supabase.from('business_context').update({ website_faqs_generated: faqs.length }).eq('workspace_id', workspaceId);
    return { before: beforeCount, after: beforeCount, contradictions: 0 };
  }

  // If no LOVABLE_API_KEY, fall back to lightweight text dedup
  if (!LOVABLE_API_KEY) {
    console.log(`[${FUNCTION_NAME}] No LOVABLE_API_KEY, falling back to text-based dedup`);
    return fallbackTextDedup(supabase, faqs, workspaceId, jobId);
  }

  // Build FAQ list for AI
  const faqList = faqs.map((faq: any) =>
    `[ID: ${faq.id}] [Source: ${faq.source_type}] [Page: ${faq.source_page_url || 'unknown'}] [Category: ${faq.category}]\nQ: ${faq.question}\nA: ${faq.answer}`
  ).join('\n\n---\n\n');

  const consolidationPrompt = `You are a knowledge base editor for a service business. You have ${faqs.length} FAQs extracted from the business's own website. Many are semantic duplicates extracted from different pages.

Produce the FINAL, CANONICAL set of FAQs following these rules:

## 1. MERGE SEMANTIC DUPLICATES
Group questions that ask the same thing in different words. Examples:
- "What areas do you cover?" / "What is your service area?" / "Where do you operate?"
- "How much does it cost?" / "What are your prices?"
- "Do you cover [Town A]?" / "Do you serve [Town B]?" (same question, different location)
For each group, produce ONE FAQ with the clearest question and most accurate answer.

## 2. PRIORITISE AUTHORITY
When answers conflict, use this priority:
- HIGHEST: FAQ page (/faq, /faqs) — the business owner's deliberate answers
- HIGH: Terms/policy pages
- MEDIUM: Dedicated service pages, homepage
- LOW: Location/area pages — often generic SEO content

## 3. RESOLVE CONTRADICTIONS
- PREFER SPECIFIC over VAGUE: "15-mile radius of Birmingham" beats "West Midlands" beats "across the UK"
- PREFER RESTRICTIVE over PERMISSIVE: "Card payments only" beats "all payment methods"
- PREFER FAQ PAGE over ALL OTHERS

## 4. ENRICH WHERE VALUABLE
If a non-FAQ page adds genuinely useful specific detail, merge it INTO the canonical answer. Don't keep both.

## 5. REMOVE LOW-VALUE FAQs
Delete any FAQ that: is marketing fluff as a question, is location-specific but contains zero location-specific info, would never be asked by a real customer, or restates another FAQ.

## 6. CATEGORY ASSIGNMENT
Assign each to: Services, Process, Pricing, Coverage, Booking, Policies, Trust, or Contact

## 7. TARGET
Aim for 20-25 final FAQs. Every FAQ must pass: "Is this a distinct question a real customer would actually ask?"

## OUTPUT FORMAT
Return ONLY a valid JSON array. No markdown, no explanation.
Each object: {"keep_id": "original ID or null", "question": "text", "answer": "text", "category": "Category", "action": "keep|rewrite", "merged_from_ids": ["id1","id2"]}

Here are all ${faqs.length} FAQs:

${faqList}`;

  try {
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are a precise knowledge base editor. Return only valid JSON arrays. No markdown formatting, no code fences, no explanation.' },
          { role: 'user', content: consolidationPrompt }
        ],
        temperature: 0.1,
        max_tokens: 8000
      })
    });

    if (!aiResponse.ok) {
      console.error(`[${FUNCTION_NAME}] AI consolidation failed: ${aiResponse.status}`);
      return fallbackTextDedup(supabase, faqs, workspaceId, jobId);
    }

    const aiResult = await aiResponse.json();
    const responseText = aiResult.choices?.[0]?.message?.content || '';

    // Parse response
    let consolidatedFaqs;
    try {
      const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      consolidatedFaqs = JSON.parse(cleanJson);
    } catch {
      console.error(`[${FUNCTION_NAME}] Failed to parse AI response, falling back`);
      return fallbackTextDedup(supabase, faqs, workspaceId, jobId);
    }

    // Safety checks
    if (!Array.isArray(consolidatedFaqs) || consolidatedFaqs.length === 0) {
      console.error(`[${FUNCTION_NAME}] AI returned empty result, aborting`);
      return fallbackTextDedup(supabase, faqs, workspaceId, jobId);
    }
    if (consolidatedFaqs.length < 10) {
      console.warn(`[${FUNCTION_NAME}] AI returned only ${consolidatedFaqs.length} FAQs — too few, aborting`);
      return fallbackTextDedup(supabase, faqs, workspaceId, jobId);
    }
    if (consolidatedFaqs.length >= faqs.length) {
      console.warn(`[${FUNCTION_NAME}] AI returned ${consolidatedFaqs.length} from ${faqs.length} — no reduction, skipping`);
      await supabase.from('scraping_jobs').update({ faqs_stored: faqs.length }).eq('id', jobId);
      await supabase.from('business_context').update({ website_faqs_generated: faqs.length }).eq('workspace_id', workspaceId);
      return { before: beforeCount, after: beforeCount, contradictions: 0 };
    }

    console.log(`[${FUNCTION_NAME}] AI consolidated ${faqs.length} → ${consolidatedFaqs.length} FAQs`);

    // Collect IDs to keep and items to rewrite
    const keepIds = new Set<string>();
    const rewriteItems: any[] = [];

    for (const item of consolidatedFaqs) {
      if (item.keep_id && item.action === 'keep') {
        keepIds.add(item.keep_id);
      } else if (item.action === 'rewrite') {
        rewriteItems.push(item);
        if (item.keep_id) keepIds.add(item.keep_id);
      }
      if (item.merged_from_ids?.length > 1) {
        console.log(`[${FUNCTION_NAME}] Merged ${item.merged_from_ids.length} FAQs → "${item.question}"`);
      }
    }

    // Deactivate FAQs not in keep list
    const deactivateIds = faqs
      .map((f: any) => f.id)
      .filter((id: string) => !keepIds.has(id));

    if (deactivateIds.length > 0) {
      for (let i = 0; i < deactivateIds.length; i += 50) {
        const batch = deactivateIds.slice(i, i + 50);
        await supabase.from('faq_database').update({ is_active: false }).in('id', batch);
      }
      console.log(`[${FUNCTION_NAME}] Deactivated ${deactivateIds.length} duplicate/low-quality FAQs`);
    }

    // Update rewritten/merged FAQs
    for (const item of rewriteItems) {
      if (item.keep_id) {
        await supabase.from('faq_database').update({
          question: item.question,
          answer: item.answer,
          category: item.category
        }).eq('id', item.keep_id);
      } else {
        await supabase.from('faq_database').insert({
          workspace_id: workspaceId,
          question: item.question,
          answer: item.answer,
          category: item.category,
          generation_source: 'own_website',
          source_type: 'merged',
          is_own_content: true,
          is_active: true,
          quality_score: 90,
          priority: 10
        });
      }
    }

    const afterCount = consolidatedFaqs.length;
    console.log(`[${FUNCTION_NAME}] AI consolidation complete: ${beforeCount} → ${afterCount} FAQs`);

    await supabase.from('scraping_jobs').update({ faqs_stored: afterCount }).eq('id', jobId);
    await supabase.from('business_context').update({ website_faqs_generated: afterCount }).eq('workspace_id', workspaceId);

    return { before: beforeCount, after: afterCount, contradictions: 0 };

  } catch (e: any) {
    console.error(`[${FUNCTION_NAME}] AI consolidation error:`, e.message);
    return fallbackTextDedup(supabase, faqs, workspaceId, jobId);
  }
}

// Lightweight text-based fallback dedup (used when AI is unavailable)
function fallbackTextDedup(
  supabase: any,
  faqs: any[],
  workspaceId: string,
  jobId: string
): Promise<{ before: number; after: number; contradictions: number }> {
  return (async () => {
    const beforeCount = faqs.length;
    const idsToDeactivate: string[] = [];
    const seen = new Map<string, typeof faqs[0]>();

    for (const faq of faqs) {
      const normalized = faq.question.toLowerCase()
        .replace(/[?!.,'"]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (seen.has(normalized)) {
        idsToDeactivate.push(faq.id);
      } else {
        seen.set(normalized, faq);
      }
    }

    if (idsToDeactivate.length > 0) {
      for (let i = 0; i < idsToDeactivate.length; i += 50) {
        const batch = idsToDeactivate.slice(i, i + 50);
        await supabase.from('faq_database').update({ is_active: false }).in('id', batch);
      }
    }

    const afterCount = beforeCount - idsToDeactivate.length;
    console.log(`[${FUNCTION_NAME}] Fallback dedup: ${beforeCount} → ${afterCount} FAQs`);

    await supabase.from('scraping_jobs').update({ faqs_stored: afterCount }).eq('id', jobId);
    await supabase.from('business_context').update({ website_faqs_generated: afterCount }).eq('workspace_id', workspaceId);

    return { before: beforeCount, after: afterCount, contradictions: 0 };
  })();
}

// =========================================
// Main serve handler
// =========================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const urlJobId = url.searchParams.get('jobId');
    const payload = await req.json();
    const { workspaceId, datasetId, jobId: bodyJobId, websiteUrl } = payload;
    const jobId = urlJobId ?? bodyJobId;

    if (!jobId) throw new Error('jobId is required');

    console.log(`[${FUNCTION_NAME}] Processing job:`, jobId);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from('scraping_jobs').update({
      status: 'processing',
      apify_dataset_id: datasetId
    }).eq('id', jobId);

    if (datasetId === 'firecrawl') {
      if (!websiteUrl) throw new Error('websiteUrl is required for firecrawl mode');
      EdgeRuntime.waitUntil(processFirecrawl(websiteUrl, jobId, workspaceId));
    } else {
      EdgeRuntime.waitUntil(processDataset(datasetId, jobId, workspaceId));
    }

    return new Response(JSON.stringify({ success: true, message: 'Processing started' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Error:`, error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// =========================================
// Apify dataset processing
// =========================================

async function processDataset(datasetId: string, jobId: string, workspaceId: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY')!;
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;

  try {
    // Fetch scraped pages from Apify
    const datasetResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
    );
    const pages = await datasetResponse.json();
    console.log(`[${FUNCTION_NAME}] Fetched ${pages.length} pages from Apify`);

    await supabase.from('scraping_jobs').update({ total_pages_found: pages.length }).eq('id', jobId);

    // Build page records with type detection
    const pageRecords = pages.map((page: any) => buildPageRecord(page, jobId, workspaceId));

    if (pageRecords.length > 0) {
      await supabase.from('scraped_pages').insert(pageRecords);
    }

    // Phase 2: Filter location pages
    const { kept, skipped } = filterLocationPages(pageRecords);

    // Mark skipped pages
    if (skipped.length > 0) {
      for (const page of skipped) {
        await supabase.from('scraped_pages')
          .update({ status: 'skipped', page_type: 'location_duplicate' })
          .eq('job_id', jobId)
          .eq('url', page.url);
      }
    }

    // Process kept pages
    const { totalFaqsFound, totalFaqsStored } = await processPages(
      kept, jobId, workspaceId, supabase, ANTHROPIC_API_KEY, OPENAI_API_KEY
    );

    // Phase 3: Post-extraction consolidation
    const consolidation = await consolidateFaqs(supabase, workspaceId, jobId);

    await supabase.from('scraping_jobs').update({
      status: 'completed',
      faqs_stored: consolidation.after,
      completed_at: new Date().toISOString()
    }).eq('id', jobId);

    console.log(`[${FUNCTION_NAME}] Job completed. Extracted: ${totalFaqsFound}, after dedup: ${consolidation.after}`);

  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Background processing error:`, error.message);
    await supabase.from('scraping_jobs').update({
      status: 'failed', error_message: error.message
    }).eq('id', jobId);
  }
}

// =========================================
// Firecrawl fallback processing
// =========================================

async function processFirecrawl(websiteUrl: string, jobId: string, workspaceId: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;

  try {
    let baseUrl = websiteUrl.trim();
    if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;
    baseUrl = baseUrl.replace(/\/$/, '');

    if (!FIRECRAWL_API_KEY) throw new Error('Firecrawl connector not configured');

    console.log(`[${FUNCTION_NAME}] Firecrawl fallback starting for:`, baseUrl);

    // Map URLs
    const mapResp = await fetch('https://api.firecrawl.dev/v1/map', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: baseUrl, limit: 2000, includeSubdomains: false }),
    });

    const mapJson = await mapResp.json().catch(() => ({}));
    if (!mapResp.ok) throw new Error(mapJson?.error || `Firecrawl map failed: ${mapResp.status}`);

    const links: string[] = mapJson?.links || mapJson?.data?.links || [];

    // Prioritize money pages
    const priorityPatterns = ['/faq', '/faqs', '/pricing', '/prices', '/cost', '/services', '/service', '/about', '/contact', '/areas', '/coverage', '/booking', '/quote'];
    const normalize = (u: string) => u.toLowerCase();
    const unique = Array.from(new Set(links)).filter((u) => {
      const n = normalize(u);
      return n.startsWith(baseUrl.toLowerCase()) && !n.endsWith('.pdf');
    });

    const prioritized = [...unique].sort((a, b) => {
      const na = normalize(a); const nb = normalize(b);
      const pa = priorityPatterns.findIndex((p) => na.includes(p));
      const pb = priorityPatterns.findIndex((p) => nb.includes(p));
      return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
    });

    const maxPages = 30;
    const targetUrls = prioritized.slice(0, maxPages);

    await supabase.from('scraping_jobs').update({ total_pages_found: targetUrls.length }).eq('id', jobId);

    // Scrape pages
    const scraped: Array<{ url: string; markdown: string; title?: string }> = [];

    const scrapeOne = async (url: string) => {
      const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) return null;
      const data = json?.data ?? json;
      const markdown = data?.markdown ?? '';
      const title = data?.metadata?.title;
      if (!markdown || markdown.length < 200) return null;
      return { url, markdown, title };
    };

    const concurrency = 3;
    for (let i = 0; i < targetUrls.length; i += concurrency) {
      const batch = targetUrls.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(scrapeOne));
      for (const r of results) { if (r) scraped.push(r); }
      await supabase.rpc('increment_scraping_progress', {
        p_job_id: jobId, p_pages_processed: batch.length, p_faqs_found: 0,
      });
    }

    // Store page records
    const pageRecords = scraped.map((page) => ({
      ...buildPageRecord({ url: page.url, markdown: page.markdown, metadata: { title: page.title } }, jobId, workspaceId),
      content_markdown: page.markdown,
    }));

    if (pageRecords.length > 0) {
      await supabase.from('scraped_pages').insert(pageRecords);
    }

    // Phase 2: Filter location pages
    const { kept, skipped } = filterLocationPages(pageRecords);

    if (skipped.length > 0) {
      for (const page of skipped) {
        await supabase.from('scraped_pages')
          .update({ status: 'skipped', page_type: 'location_duplicate' })
          .eq('job_id', jobId)
          .eq('url', page.url);
      }
    }

    // Process kept pages
    const { totalFaqsFound, totalFaqsStored } = await processPages(
      kept, jobId, workspaceId, supabase, ANTHROPIC_API_KEY, OPENAI_API_KEY
    );

    // Phase 3: Post-extraction consolidation
    const consolidation = await consolidateFaqs(supabase, workspaceId, jobId);

    await supabase.from('scraping_jobs').update({
      status: 'completed',
      faqs_stored: consolidation.after,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);

    console.log(`[${FUNCTION_NAME}] Firecrawl job completed. Extracted: ${totalFaqsFound}, after dedup: ${consolidation.after}`);
  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Firecrawl error:`, error?.message ?? error);
    await supabase.from('scraping_jobs').update({
      status: 'failed', error_message: error?.message ?? String(error),
    }).eq('id', jobId);
  }
}

// =========================================
// Shared helpers
// =========================================

function buildPageRecord(page: any, jobId: string, workspaceId: string) {
  const pageUrl = (page.url || '').toLowerCase();
  let pageType = 'other';
  
  if (pageUrl.includes('/faq') || pageUrl.includes('/frequently')) pageType = 'faq';
  else if (pageUrl.includes('/pricing') || pageUrl.includes('/prices') || pageUrl.includes('/cost')) pageType = 'pricing';
  else if (pageUrl.includes('/service')) pageType = 'services';
  else if (pageUrl.includes('/about')) pageType = 'about';
  else if (pageUrl.includes('/contact')) pageType = 'contact';
  else if (pageUrl.includes('/area') || pageUrl.includes('/coverage')) pageType = 'coverage';
  else if (pageUrl.includes('/book') || pageUrl.includes('/quote')) pageType = 'booking';
  else if (pageUrl === page.url?.replace(/\/$/, '') || pageUrl.endsWith('/index')) pageType = 'homepage';

  const content = page.markdown || page.text || '';
  return {
    job_id: jobId,
    workspace_id: workspaceId,
    url: page.url,
    title: page.metadata?.title || page.title,
    page_type: pageType,
    content_markdown: content,
    content_length: content.length,
    status: 'pending'
  };
}

async function processPages(
  pages: any[],
  jobId: string,
  workspaceId: string,
  supabase: any,
  anthropicKey: string,
  openaiKey: string
): Promise<{ totalFaqsFound: number; totalFaqsStored: number }> {
  const priorityOrder = ['faq', 'pricing', 'services', 'homepage', 'coverage', 'about', 'booking', 'contact', 'other'];
  const sortedPages = [...pages].sort((a, b) =>
    priorityOrder.indexOf(a.page_type) - priorityOrder.indexOf(b.page_type)
  );

  const batchSize = 3;
  let totalFaqsFound = 0;
  let totalFaqsStored = 0;

  for (let i = 0; i < sortedPages.length; i += batchSize) {
    const batch = sortedPages.slice(i, i + batchSize);

    const results = await Promise.all(batch.map(async (page) => {
      if (!page.content_markdown || page.content_markdown.length < 200) {
        await supabase.from('scraped_pages')
          .update({ status: 'skipped' })
          .eq('job_id', jobId)
          .eq('url', page.url);
        return { extracted: 0, stored: 0 };
      }

      try {
        const faqs = await extractFaqsWithClaude(anthropicKey, page.content_markdown, page.page_type, page.url);
        const stored = await storeFaqsWithDedup(supabase, openaiKey, faqs, workspaceId, page.url, page.page_type);

        await supabase.from('scraped_pages')
          .update({ status: 'processed', faqs_extracted: faqs.length })
          .eq('job_id', jobId)
          .eq('url', page.url);

        return { extracted: faqs.length, stored };
      } catch (e: any) {
        console.error(`[${FUNCTION_NAME}] Error processing page:`, page.url, e.message);
        await supabase.from('scraped_pages')
          .update({ status: 'failed' })
          .eq('job_id', jobId)
          .eq('url', page.url);
        return { extracted: 0, stored: 0 };
      }
    }));

    const batchExtracted = results.reduce((sum, r) => sum + r.extracted, 0);
    const batchStored = results.reduce((sum, r) => sum + r.stored, 0);
    totalFaqsFound += batchExtracted;
    totalFaqsStored += batchStored;

    await supabase.rpc('increment_scraping_progress', {
      p_job_id: jobId,
      p_pages_processed: batch.length,
      p_faqs_found: batchExtracted
    });

    console.log(`[${FUNCTION_NAME}] Batch ${Math.floor(i / batchSize) + 1}, FAQs so far: ${totalFaqsFound}`);
  }

  return { totalFaqsFound, totalFaqsStored };
}

// Extract FAQs using Claude Tool Use
async function extractFaqsWithClaude(
  apiKey: string, content: string, pageType: string, pageUrl: string
): Promise<any[]> {
  const maxFaqs = pageType === 'faq' ? 20 : pageType === 'pricing' ? 10 : 8;

  const systemPrompt = `You are an expert Content Analyst for BizzyBee, extracting a Knowledge Base from UK service business websites.

CRITICAL VOICE RULE:
- Write ALL answers in FIRST PERSON ("we", "our", "us") as if YOU ARE the business.
- NEVER refer to the business by name in third person.

RULES:
- Focus on FACTS: Prices (in £), Locations, Services, Process, Policies
- Ignore generic marketing fluff
- If this is a FAQ page, extract the EXPLICIT questions and answers
- For other pages, INFER what customers would ask based on content
- British English spelling
- Questions: max 15 words. Answers: direct and useful.
- IMPORTANT: Extract AT MOST ${maxFaqs} high-quality FAQs. Quality over quantity.
- DO NOT fabricate prices, coverage areas, or payment methods not explicitly stated on this page.

IMPORTANT EXTRACTION RULES — APPLY TO ALL BUSINESS TYPES:

1. AVOID CROSS-PAGE TOPIC DUPLICATION:
   - Do NOT generate FAQs about "coverage area", "what areas do you serve", or "do you cover [location]" unless this page is specifically a locations/coverage page (e.g. /locations, /areas-we-cover, /service-areas, /areas, /coverage).
   - Do NOT generate FAQs about payment methods, cancellation policies, scheduling, or appointment/booking processes unless this page is specifically the FAQ page, Terms page, or a dedicated policy page.
   - Do NOT generate FAQs about contact details (phone, email, address) unless this page is specifically the Contact page.
   - Do NOT generate FAQs about pricing/costs unless this page is specifically a pricing page or the FAQ page.
   - These topics have authoritative answers on dedicated pages. Extracting them from every page creates contradictions.

2. FOCUS ON WHAT'S UNIQUE TO THIS PAGE:
   - Extract FAQs about the specific service, product, or topic THIS page is about.
   - If this is a location page (e.g. /locations/luton, /areas/manchester), ONLY extract FAQs about genuinely location-specific facts (e.g. local regulations, area-specific pricing, local conditions). Do NOT extract generic service descriptions with the town name inserted.
   - If a page mostly repeats information from other pages with just the town/area name swapped, extract ONLY the genuinely unique facts — or nothing at all.

3. QUALITY THRESHOLD:
   - Every FAQ you extract should pass this test: "Would a real customer actually ask this specific question?"
   - Do NOT extract marketing statements reworded as questions (e.g. "Why is [service] essential in [town]?" with generic marketing copy as the answer).
   - Do NOT extract questions where the answer is just a rephrasing of the question.

PAGE TYPE: ${pageType}
PAGE URL: ${pageUrl}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 4000,
      system: systemPrompt,
      tools: [FAQ_EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'extract_faqs' },
      messages: [{
        role: 'user',
        content: `Extract up to ${maxFaqs} high-quality FAQs from this page. Only include facts explicitly stated:\n\n${content.substring(0, 8000)}`
      }]
    })
  });

  if (!response.ok) throw new Error(`Claude API error: ${response.status}`);

  const data = await response.json();
  const toolUse = data.content?.find((block: any) => block.type === 'tool_use');
  return toolUse?.input?.faqs || [];
}

// Store FAQs with deduplication
async function storeFaqsWithDedup(
  supabase: any, openaiKey: string, faqs: any[],
  workspaceId: string, sourceUrl: string, pageType: string
): Promise<number> {
  let storedCount = 0;

  for (const faq of faqs) {
    try {
      // Generate embedding
      const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: faq.question })
      });

      const embeddingData = await embeddingResponse.json();
      const embedding = embeddingData.data?.[0]?.embedding;
      if (!embedding) { console.error('Failed to generate embedding'); continue; }

      // Check for duplicates using fixed match_faqs (now queries faq_database)
      const { data: similar } = await supabase.rpc('match_faqs', {
        query_embedding: embedding,
        match_workspace_id: workspaceId,
        match_count: 1,
        match_threshold: 0.95
      });

      if (similar && similar.length > 0) {
        const existing = similar[0];
        const shouldUpdate =
          (faq.source_type === 'explicit' && existing.source_type === 'implied') ||
          (faq.answer.length > (existing.answer?.length || 0) * 1.2);

        if (shouldUpdate) {
          await supabase.from('faq_database')
            .update({
              answer: faq.answer,
              source_type: faq.source_type,
              quality_score: calculateQualityScore(faq, pageType),
              confidence: faq.confidence,
              source_page_url: sourceUrl
            })
            .eq('id', existing.id);
          storedCount++;
        }
        continue;
      }

      // New FAQ - generate full embedding and store
      const fullEmbResp = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: `${faq.question} ${faq.answer}` })
      });

      const fullEmbData = await fullEmbResp.json();
      const fullEmbedding = fullEmbData.data?.[0]?.embedding;

      const { error: insertError } = await supabase.from('faq_database').insert({
        workspace_id: workspaceId,
        question: faq.question,
        answer: faq.answer,
        category: faq.category,
        generation_source: 'own_website',
        source_type: faq.source_type,
        source_page_url: sourceUrl,
        quality_score: calculateQualityScore(faq, pageType),
        confidence: faq.confidence,
        priority: 10,
        is_own_content: true,
        is_active: true,
        embedding: fullEmbedding
      });

      if (insertError) { console.error('FAQ insert error:', insertError.message); continue; }
      storedCount++;
    } catch (e: any) {
      console.error('Error storing FAQ:', e.message);
    }
  }

  return storedCount;
}

function calculateQualityScore(faq: any, pageType: string): number {
  let score = 60;
  if (faq.source_type === 'explicit' || pageType === 'faq') score += 20;
  if (faq.category === 'pricing' && faq.answer.includes('£')) score += 10;
  if (faq.answer.length >= 50) score += 5;

  const nonAnswers = ['contact us', 'get in touch', 'call us', 'please enquire'];
  if (nonAnswers.some(na => faq.answer.toLowerCase().includes(na)) && !faq.answer.includes('£')) score -= 30;
  if (faq.answer.length < 20) score -= 10;

  return Math.max(0, Math.min(100, score));
}
