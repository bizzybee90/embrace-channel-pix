import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'start-website-scrape';
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
  /areas/i,
  /coverage/i,
];

const MAX_PAGES_TO_SCRAPE = 15;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspace_id, website_url } = await req.json();
    
    if (!workspace_id) throw new Error('workspace_id is required');
    if (!website_url) throw new Error('website_url is required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');

    if (!firecrawlApiKey) throw new Error('FIRECRAWL_API_KEY not configured');

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Normalize URL
    let url = website_url.trim();
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    console.log(`[${FUNCTION_NAME}] Starting for workspace:`, workspace_id, 'URL:', url);

    // =========================================
    // STEP 1: Create or update job record
    // =========================================
    
    const { data: existingJob } = await supabase
      .from('website_scrape_jobs')
      .select('id')
      .eq('workspace_id', workspace_id)
      .eq('website_url', url)
      .single();

    let jobId: string;

    if (existingJob) {
      // Reset existing job
      await supabase
        .from('website_scrape_jobs')
        .update({
          status: 'mapping',
          pages_found: 0,
          pages_scraped: 0,
          pages_extracted: 0,
          faqs_extracted: 0,
          ground_truth_facts: 0,
          priority_pages: [],
          scraped_pages: [],
          error_message: null,
          retry_count: 0,
          started_at: new Date().toISOString(),
          completed_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingJob.id);
      jobId = existingJob.id;
    } else {
      const { data: newJob, error: jobError } = await supabase
        .from('website_scrape_jobs')
        .insert({
          workspace_id,
          website_url: url,
          status: 'mapping',
          started_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (jobError || !newJob) {
        throw new Error(`Failed to create job: ${jobError?.message}`);
      }
      jobId = newJob.id;
    }

    console.log(`[${FUNCTION_NAME}] Job ID:`, jobId);

    // =========================================
    // STEP 2: Discover pages with Firecrawl Map
    // =========================================
    
    let pagesToScrape: string[] = [url];

    try {
      console.log(`[${FUNCTION_NAME}] Mapping site...`);
      
      const mapResponse = await fetch(`${FIRECRAWL_API}/map`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url,
          limit: 100
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
        
        console.log(`[${FUNCTION_NAME}] Selected ${pagesToScrape.length} priority pages`);

        // Update job with discovered pages
        await supabase
          .from('website_scrape_jobs')
          .update({
            pages_found: allLinks.length,
            priority_pages: pagesToScrape,
            status: 'scraping',
            updated_at: new Date().toISOString()
          })
          .eq('id', jobId);
      } else {
        console.warn(`[${FUNCTION_NAME}] Map failed, falling back to single page`);
        await supabase
          .from('website_scrape_jobs')
          .update({
            pages_found: 1,
            priority_pages: [url],
            status: 'scraping',
            updated_at: new Date().toISOString()
          })
          .eq('id', jobId);
      }
    } catch (mapError) {
      console.warn(`[${FUNCTION_NAME}] Map error:`, mapError);
      await supabase
        .from('website_scrape_jobs')
        .update({
          pages_found: 1,
          priority_pages: [url],
          status: 'scraping',
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId);
    }

    // =========================================
    // STEP 3: Scrape pages one by one with progress updates
    // =========================================
    
    const scrapedPages: Array<{ url: string; markdown: string; title: string }> = [];
    
    for (let i = 0; i < pagesToScrape.length; i++) {
      const pageUrl = pagesToScrape[i];
      
      try {
        console.log(`[${FUNCTION_NAME}] Scraping ${i + 1}/${pagesToScrape.length}: ${pageUrl}`);
        
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

        if (scrapeResponse.ok) {
          const scrapeData = await scrapeResponse.json();
          const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';
          const title = scrapeData.data?.metadata?.title || '';

          if (markdown.length >= 50) {
            scrapedPages.push({ url: pageUrl, markdown, title });
          }
        }

        // Update progress after each page
        await supabase
          .from('website_scrape_jobs')
          .update({
            pages_scraped: i + 1,
            scraped_pages: scrapedPages.map(p => ({ url: p.url, title: p.title, chars: p.markdown.length })),
            updated_at: new Date().toISOString()
          })
          .eq('id', jobId);

      } catch (scrapeError) {
        console.warn(`[${FUNCTION_NAME}] Error scraping ${pageUrl}:`, scrapeError);
      }
    }

    console.log(`[${FUNCTION_NAME}] Scraped ${scrapedPages.length} pages successfully`);

    if (scrapedPages.length === 0) {
      await supabase
        .from('website_scrape_jobs')
        .update({
          status: 'failed',
          error_message: 'Could not extract meaningful content from website',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId);

      throw new Error('Could not extract meaningful content from website');
    }

    // Update status to extracting
    await supabase
      .from('website_scrape_jobs')
      .update({
        status: 'extracting',
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);

    // =========================================
    // STEP 4: Trigger FAQ extraction (async)
    // =========================================
    
    // Combine all page content
    const combinedMarkdown = scrapedPages.map(page => {
      const pagePath = new URL(page.url).pathname || '/';
      return `\n\n## PAGE: ${page.title || pagePath}\nURL: ${page.url}\n\n${page.markdown}`;
    }).join('\n\n---\n');

    // Call the extraction function
    const extractResponse = await supabase.functions.invoke('extract-website-faqs', {
      body: {
        job_id: jobId,
        workspace_id,
        website_url: url,
        combined_markdown: combinedMarkdown,
        pages_count: scrapedPages.length
      }
    });

    if (extractResponse.error) {
      console.error(`[${FUNCTION_NAME}] Extraction invoke error:`, extractResponse.error);
    }

    // =========================================
    // Return immediately - extraction continues async
    // =========================================
    
    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        status: 'extracting',
        pages_found: pagesToScrape.length,
        pages_scraped: scrapedPages.length,
        message: 'Scraping complete, extracting FAQs...'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Error:`, error.message);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: FUNCTION_NAME
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
