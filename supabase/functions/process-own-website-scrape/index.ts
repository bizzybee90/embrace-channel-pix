import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'process-own-website-scrape';

// Edge runtime provides this globally; declare for TypeScript.
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
            question: { 
              type: 'string', 
              description: 'Concise question a customer would ask, max 15 words' 
            },
            answer: { 
              type: 'string', 
              description: 'Direct answer with UK context (£, British spelling)' 
            },
            category: { 
              type: 'string', 
              enum: ['services', 'pricing', 'process', 'coverage', 'trust', 'booking', 'policies'],
              description: 'Category of the FAQ'
            },
            source_type: { 
              type: 'string', 
              enum: ['explicit', 'implied'],
              description: 'explicit if found in a Q&A section, implied if inferred from text'
            },
            confidence: { 
              type: 'integer', 
              minimum: 0, 
              maximum: 100,
              description: 'Confidence score 0-100'
            }
          },
          required: ['question', 'answer', 'category', 'source_type', 'confidence']
        }
      }
    },
    required: ['faqs']
  }
};

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

    if (!jobId) {
      throw new Error('jobId is required');
    }

    console.log(`[${FUNCTION_NAME}] Processing job:`, jobId);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Update status immediately
    await supabase.from('scraping_jobs').update({
      status: 'processing',
      apify_dataset_id: datasetId
    }).eq('id', jobId);

    // Start background processing (don't block webhook response)
    // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
    if (datasetId === 'firecrawl') {
      if (!websiteUrl) throw new Error('websiteUrl is required for firecrawl mode');
      EdgeRuntime.waitUntil(processFirecrawl(websiteUrl, jobId, workspaceId));
    } else {
      EdgeRuntime.waitUntil(processDataset(datasetId, jobId, workspaceId));
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Processing started' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Error:`, error.message);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Background processing function
async function processDataset(datasetId: string, jobId: string, workspaceId: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY')!;
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;

  try {
    console.log(`[${FUNCTION_NAME}] Starting background processing for dataset:`, datasetId);

    // =========================================
    // STEP 1: Fetch scraped pages from Apify
    // =========================================
    
    const datasetResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
    );
    
    const pages = await datasetResponse.json();
    
    console.log(`[${FUNCTION_NAME}] Fetched ${pages.length} pages from Apify`);

    // Update total pages found
    await supabase.from('scraping_jobs').update({
      total_pages_found: pages.length
    }).eq('id', jobId);

    // =========================================
    // STEP 2: Store pages and identify page types
    // =========================================
    
    const pageRecords = pages.map((page: any) => {
      const pageUrl = page.url?.toLowerCase() || '';
      let pageType = 'other';
      
      if (pageUrl.includes('/faq') || pageUrl.includes('/frequently')) pageType = 'faq';
      else if (pageUrl.includes('/pricing') || pageUrl.includes('/prices') || pageUrl.includes('/cost')) pageType = 'pricing';
      else if (pageUrl.includes('/service')) pageType = 'services';
      else if (pageUrl.includes('/about')) pageType = 'about';
      else if (pageUrl.includes('/contact')) pageType = 'contact';
      else if (pageUrl.includes('/area') || pageUrl.includes('/coverage')) pageType = 'coverage';
      else if (pageUrl.includes('/book') || pageUrl.includes('/quote')) pageType = 'booking';
      else if (pageUrl === page.url?.replace(/\/$/, '') || pageUrl.endsWith('/index')) pageType = 'homepage';
      
      return {
        job_id: jobId,
        workspace_id: workspaceId,
        url: page.url,
        title: page.metadata?.title || page.title,
        page_type: pageType,
        content_markdown: page.markdown || page.text,
        content_length: (page.markdown || page.text || '').length,
        status: 'pending'
      };
    });
    
    if (pageRecords.length > 0) {
      await supabase.from('scraped_pages').insert(pageRecords);
    }

    // =========================================
    // STEP 3: Process pages in batches
    // =========================================
    
    // Prioritize high-value pages first
    const priorityOrder = ['faq', 'pricing', 'services', 'homepage', 'coverage', 'about', 'booking', 'contact', 'other'];
    const sortedPages = [...pageRecords].sort((a, b) => 
      priorityOrder.indexOf(a.page_type) - priorityOrder.indexOf(b.page_type)
    );
    
    const batchSize = 3; // Process 3 pages concurrently
    let totalFaqsFound = 0;
    let totalFaqsStored = 0;
    
    for (let i = 0; i < sortedPages.length; i += batchSize) {
      const batch = sortedPages.slice(i, i + batchSize);
      
      const results = await Promise.all(batch.map(async (page) => {
        if (!page.content_markdown || page.content_markdown.length < 200) {
          // Skip pages with little content
          await supabase.from('scraped_pages')
            .update({ status: 'skipped' })
            .eq('job_id', jobId)
            .eq('url', page.url);
          return { extracted: 0, stored: 0 };
        }
        
        try {
          // Extract FAQs using Claude Tool Use
          const faqs = await extractFaqsWithClaude(
            ANTHROPIC_API_KEY,
            page.content_markdown,
            page.page_type,
            page.url
          );
          
          // Store FAQs with deduplication and quality scoring
          const stored = await storeFaqsWithDedup(
            supabase,
            OPENAI_API_KEY,
            faqs,
            workspaceId,
            page.url,
            page.page_type
          );
          
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
      
      // Update progress
      const batchExtracted = results.reduce((sum, r) => sum + r.extracted, 0);
      const batchStored = results.reduce((sum, r) => sum + r.stored, 0);
      totalFaqsFound += batchExtracted;
      totalFaqsStored += batchStored;
      
      await supabase.rpc('increment_scraping_progress', {
        p_job_id: jobId,
        p_pages_processed: batch.length,
        p_faqs_found: batchExtracted
      });

      console.log(`[${FUNCTION_NAME}] Processed batch ${Math.floor(i/batchSize) + 1}, total FAQs: ${totalFaqsFound}`);
    }

    // =========================================
    // STEP 4: Mark job complete
    // =========================================
    
    await supabase.from('scraping_jobs').update({
      status: 'completed',
      faqs_stored: totalFaqsStored,
      completed_at: new Date().toISOString()
    }).eq('id', jobId);

    console.log(`[${FUNCTION_NAME}] Job completed. FAQs found: ${totalFaqsFound}, stored: ${totalFaqsStored}`);

  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Background processing error:`, error.message);
    await supabase.from('scraping_jobs').update({
      status: 'failed',
      error_message: error.message
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
    // Normalize URL
    let baseUrl = websiteUrl.trim();
    if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;
    baseUrl = baseUrl.replace(/\/$/, '');

    if (!FIRECRAWL_API_KEY) {
      throw new Error('Firecrawl connector not configured');
    }

    console.log(`[${FUNCTION_NAME}] Firecrawl fallback starting for:`, baseUrl);

    // Map URLs
    const mapResp = await fetch('https://api.firecrawl.dev/v1/map', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: baseUrl,
        limit: 2000,
        includeSubdomains: false,
      }),
    });

    const mapJson = await mapResp.json().catch(() => ({}));
    if (!mapResp.ok) {
      throw new Error(mapJson?.error || `Firecrawl map failed: ${mapResp.status}`);
    }

    const links: string[] = mapJson?.links || mapJson?.data?.links || [];

    // Prioritize “money pages” first, then cap.
    const priorityPatterns = [
      '/faq', '/faqs', '/pricing', '/prices', '/cost', '/services', '/service', '/about', '/contact', '/areas', '/coverage', '/booking', '/quote'
    ];

    const normalize = (u: string) => u.toLowerCase();
    const unique = Array.from(new Set(links)).filter((u) => {
      const n = normalize(u);
      return n.startsWith(baseUrl.toLowerCase()) && !n.endsWith('.pdf');
    });

    const prioritized = [...unique].sort((a, b) => {
      const na = normalize(a);
      const nb = normalize(b);
      const pa = priorityPatterns.findIndex((p) => na.includes(p));
      const pb = priorityPatterns.findIndex((p) => nb.includes(p));
      const ra = pa === -1 ? 999 : pa;
      const rb = pb === -1 ? 999 : pb;
      return ra - rb;
    });

    const maxPages = 30;
    const targetUrls = prioritized.slice(0, maxPages);

    await supabase.from('scraping_jobs').update({
      total_pages_found: targetUrls.length,
    }).eq('id', jobId);

    // Scrape pages
    const scraped: Array<{ url: string; markdown: string; title?: string }>
      = [];

    const scrapeOne = async (url: string) => {
      const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
        }),
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
      for (const r of results) {
        if (r) scraped.push(r);
      }
      await supabase.rpc('increment_scraping_progress', {
        p_job_id: jobId,
        p_pages_processed: batch.length,
        p_faqs_found: 0,
      });
    }

    // Store pages as scraped_pages (same as Apify path)
    const pageRecords = scraped.map((page) => {
      const pageUrl = page.url?.toLowerCase() || '';
      let pageType = 'other';
      if (pageUrl.includes('/faq') || pageUrl.includes('/frequently')) pageType = 'faq';
      else if (pageUrl.includes('/pricing') || pageUrl.includes('/prices') || pageUrl.includes('/cost')) pageType = 'pricing';
      else if (pageUrl.includes('/service')) pageType = 'services';
      else if (pageUrl.includes('/about')) pageType = 'about';
      else if (pageUrl.includes('/contact')) pageType = 'contact';
      else if (pageUrl.includes('/area') || pageUrl.includes('/coverage')) pageType = 'coverage';
      else if (pageUrl.includes('/book') || pageUrl.includes('/quote')) pageType = 'booking';
      else if (pageUrl === page.url?.replace(/\/$/, '') || pageUrl.endsWith('/index')) pageType = 'homepage';

      return {
        job_id: jobId,
        workspace_id: workspaceId,
        url: page.url,
        title: page.title ?? null,
        page_type: pageType,
        content_markdown: page.markdown,
        content_length: page.markdown.length,
        status: 'pending',
      };
    });

    if (pageRecords.length > 0) {
      await supabase.from('scraped_pages').insert(pageRecords);
    }

    // Extract + store FAQs reusing existing helpers
    const priorityOrder = ['faq', 'pricing', 'services', 'homepage', 'coverage', 'about', 'booking', 'contact', 'other'];
    const sortedPages = [...pageRecords].sort((a, b) =>
      priorityOrder.indexOf(a.page_type) - priorityOrder.indexOf(b.page_type)
    );

    const batchSize = 3;
    let totalFaqsFound = 0;
    let totalFaqsStored = 0;

    for (let i = 0; i < sortedPages.length; i += batchSize) {
      const batch = sortedPages.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async (page) => {
        try {
          const faqs = await extractFaqsWithClaude(
            ANTHROPIC_API_KEY,
            page.content_markdown,
            page.page_type,
            page.url
          );

          const stored = await storeFaqsWithDedup(
            supabase,
            OPENAI_API_KEY,
            faqs,
            workspaceId,
            page.url,
            page.page_type
          );

          await supabase.from('scraped_pages')
            .update({ status: 'processed', faqs_extracted: faqs.length })
            .eq('job_id', jobId)
            .eq('url', page.url);

          return { extracted: faqs.length, stored };
        } catch (e: any) {
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
        p_pages_processed: 0,
        p_faqs_found: batchExtracted,
      });

      console.log(`[${FUNCTION_NAME}] Firecrawl extracted batch ${Math.floor(i / batchSize) + 1}, total FAQs: ${totalFaqsFound}`);
    }

    await supabase.from('scraping_jobs').update({
      status: 'completed',
      faqs_stored: totalFaqsStored,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);

    console.log(`[${FUNCTION_NAME}] Firecrawl job completed. FAQs found: ${totalFaqsFound}, stored: ${totalFaqsStored}`);
  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Firecrawl background processing error:`, error?.message ?? error);
    await supabase.from('scraping_jobs').update({
      status: 'failed',
      error_message: error?.message ?? String(error),
    }).eq('id', jobId);
  }
}

// Extract FAQs using Claude Tool Use (structured output)
async function extractFaqsWithClaude(
  apiKey: string,
  content: string,
  pageType: string,
  pageUrl: string
): Promise<any[]> {
  
  const systemPrompt = `You are an expert Content Analyst for BizzyBee, extracting a Knowledge Base from UK service business websites.

CRITICAL VOICE RULE:
- Write ALL answers in FIRST PERSON ("we", "our", "us") as if YOU ARE the business.
- NEVER refer to the business by name in the third person. 
- Instead of "MAC Cleaning offers..." write "We offer..."
- Instead of "They provide..." write "We provide..."
- Instead of "The company uses..." write "We use..."

RULES:
- Focus on FACTS: Prices (in £), Locations, Services, Process, Policies
- Ignore generic marketing fluff ("We're the best!")
- If this is a FAQ page (pageType: faq), extract the EXPLICIT questions and answers
- For other pages, INFER what questions customers would ask based on the content
- All answers should use British English spelling
- Keep questions concise (max 15 words)
- Keep answers direct and useful

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
        content: `Extract FAQs from this page content:\n\n${content.substring(0, 8000)}`
      }]
    })
  });
  
  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Find the tool use response
  const toolUse = data.content?.find((block: any) => block.type === 'tool_use');
  
  if (toolUse && toolUse.input?.faqs) {
    return toolUse.input.faqs;
  }
  
  return [];
}

// Store FAQs with deduplication and quality scoring
async function storeFaqsWithDedup(
  supabase: any,
  openaiKey: string,
  faqs: any[],
  workspaceId: string,
  sourceUrl: string,
  pageType: string
): Promise<number> {
  
  let storedCount = 0;
  
  for (const faq of faqs) {
    try {
      // Generate embedding for deduplication
      const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: faq.question
        })
      });
      
      const embeddingData = await embeddingResponse.json();
      const embedding = embeddingData.data?.[0]?.embedding;

      if (!embedding) {
        console.error('Failed to generate embedding for FAQ');
        continue;
      }

      // Check for duplicates (similarity > 0.95)
      const { data: similar } = await supabase.rpc('match_faqs', {
        query_embedding: embedding,
        match_workspace_id: workspaceId,
        match_count: 1,
        match_threshold: 0.95
      });
      
      if (similar && similar.length > 0) {
        // Duplicate found - check if we should update
        const existing = similar[0];
        
        // Update if: new is explicit and old is implied, OR new answer is longer
        const shouldUpdate = 
          (faq.source_type === 'explicit' && existing.source_type === 'implied') ||
          (faq.answer.length > (existing.answer?.length || 0) * 1.2);
        
        if (shouldUpdate) {
          const qualityScore = calculateQualityScore(faq, pageType);
          
          await supabase.from('faq_database')
            .update({
              answer: faq.answer,
              source_type: faq.source_type,
              quality_score: qualityScore,
              confidence: faq.confidence,
              source_page_url: sourceUrl
            })
            .eq('id', existing.id);
          
          storedCount++;
        }
        // Otherwise skip (duplicate)
        continue;
      }
      
      // New FAQ - calculate quality score and store
      const qualityScore = calculateQualityScore(faq, pageType);
      
      // Generate full embedding for FAQ (question + answer)
      const fullEmbeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: `${faq.question} ${faq.answer}`
        })
      });
      
      const fullEmbeddingData = await fullEmbeddingResponse.json();
      const fullEmbedding = fullEmbeddingData.data?.[0]?.embedding;
      
      const { error: insertError } = await supabase.from('faq_database').insert({
        workspace_id: workspaceId,
        question: faq.question,
        answer: faq.answer,
        category: faq.category,
        generation_source: 'own_website',
        source_type: faq.source_type,
        source_page_url: sourceUrl,
        quality_score: qualityScore,
        confidence: faq.confidence,
        priority: 10, // Own website = highest priority
        is_own_content: true,
        is_active: true,
        embedding: fullEmbedding
      });
      
      if (insertError) {
        console.error('FAQ insert error:', insertError.message);
        continue;
      }
      
      storedCount++;
      
    } catch (e: any) {
      console.error('Error storing FAQ:', e.message);
    }
  }
  
  return storedCount;
}

// Calculate quality score based on various factors
function calculateQualityScore(faq: any, pageType: string): number {
  let score = 60; // Base score
  
  // +20 if from explicit FAQ page
  if (faq.source_type === 'explicit' || pageType === 'faq') {
    score += 20;
  }
  
  // +10 if pricing with actual price
  if (faq.category === 'pricing' && faq.answer.includes('£')) {
    score += 10;
  }
  
  // +5 if answer is substantial (50+ chars)
  if (faq.answer.length >= 50) {
    score += 5;
  }
  
  // -30 if answer is a non-answer
  const nonAnswers = ['contact us', 'get in touch', 'call us', 'please enquire'];
  if (nonAnswers.some(na => faq.answer.toLowerCase().includes(na)) && !faq.answer.includes('£')) {
    score -= 30;
  }
  
  // -10 if very short answer (under 20 chars)
  if (faq.answer.length < 20) {
    score -= 10;
  }
  
  // Cap at 0-100
  return Math.max(0, Math.min(100, score));
}
