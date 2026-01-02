import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 5;
const MAX_PAGES_PER_SITE = 5;
const MAX_RUNTIME_MS = 25000;

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;
const waitUntil = (p: Promise<unknown>) => { try { EdgeRuntime?.waitUntil(p); } catch { /* ignore */ } };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const { jobId, workspaceId } = await req.json();
    console.log('[competitor-scrape] Starting:', { jobId });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    if (!FIRECRAWL_API_KEY) {
      await supabase.from('competitor_research_jobs').update({
        status: 'error', error_message: 'No Firecrawl API key'
      }).eq('id', jobId);
      return new Response(JSON.stringify({ error: 'No Firecrawl key' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get job
    const { data: job } = await supabase
      .from('competitor_research_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job || job.status === 'cancelled') {
      return new Response(JSON.stringify({ cancelled: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await supabase.from('competitor_research_jobs').update({
      status: 'scraping',
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Get sites to scrape
    const { data: sites } = await supabase
      .from('competitor_sites')
      .select('*')
      .eq('job_id', jobId)
      .eq('scrape_status', 'pending')
      .limit(BATCH_SIZE);

    console.log(`[competitor-scrape] Scraping ${sites?.length || 0} sites`);

    let sitesScraped = 0;
    let pagesScraped = 0;

    for (const site of sites || []) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) break;

      console.log(`[competitor-scrape] Scraping: ${site.url}`);

      // Update current scraping domain
      await supabase.from('competitor_research_jobs').update({
        current_scraping_domain: site.domain || new URL(site.url).hostname,
      }).eq('id', jobId);

      await supabase.from('competitor_sites').update({
        scrape_status: 'scraping'
      }).eq('id', site.id);

      try {
        // Use Firecrawl map to discover pages
        const mapResponse = await fetch('https://api.firecrawl.dev/v1/map', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: site.url,
            limit: 20,
          }),
        });

        if (!mapResponse.ok) {
          throw new Error(`Map failed: ${mapResponse.status}`);
        }

        const mapData = await mapResponse.json();
        let pages = mapData.links || [site.url];

        // Prioritize important pages
        const priorityPatterns = ['/faq', '/services', '/pricing', '/about', '/contact', '/price'];
        pages = pages.sort((a: string, b: string) => {
          const aScore = priorityPatterns.some(p => a.toLowerCase().includes(p)) ? 0 : 1;
          const bScore = priorityPatterns.some(p => b.toLowerCase().includes(p)) ? 0 : 1;
          return aScore - bScore;
        }).slice(0, MAX_PAGES_PER_SITE);

        // Scrape each page
        for (const pageUrl of pages) {
          if (Date.now() - startTime > MAX_RUNTIME_MS) break;

          try {
            const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                url: pageUrl,
                formats: ['markdown'],
                onlyMainContent: true,
              }),
            });

            if (!scrapeResponse.ok) continue;

            const scrapeData = await scrapeResponse.json();
            const content = scrapeData.data?.markdown || '';
            const title = scrapeData.data?.metadata?.title || '';

            if (content.length < 100) continue;

            // Determine page type
            const urlLower = pageUrl.toLowerCase();
            let pageType = 'other';
            if (urlLower === site.url || urlLower.endsWith('/')) pageType = 'homepage';
            else if (urlLower.includes('faq')) pageType = 'faq';
            else if (urlLower.includes('service')) pageType = 'services';
            else if (urlLower.includes('price') || urlLower.includes('pricing')) pageType = 'pricing';
            else if (urlLower.includes('about')) pageType = 'about';
            else if (urlLower.includes('contact')) pageType = 'contact';

            // Store page
            await supabase.from('competitor_pages').upsert({
              workspace_id: workspaceId,
              site_id: site.id,
              url: pageUrl,
              page_type: pageType,
              title,
              content: content.substring(0, 50000),
              word_count: content.split(/\s+/).length,
            }, { onConflict: 'workspace_id,url' });

            pagesScraped++;

          } catch (err) {
            console.error(`[competitor-scrape] Page error: ${pageUrl}`, err);
          }

          // Small delay between pages
          await new Promise(r => setTimeout(r, 500));
        }

        // Update site status
        await supabase.from('competitor_sites').update({
          scrape_status: 'completed',
          pages_scraped: pages.length,
          pages_found: mapData.links?.length || 0,
          scraped_at: new Date().toISOString(),
          has_faq_page: pages.some((p: string) => p.toLowerCase().includes('faq')),
          has_pricing_page: pages.some((p: string) => p.toLowerCase().includes('price')),
        }).eq('id', site.id);

        sitesScraped++;

      } catch (err) {
        console.error(`[competitor-scrape] Site error: ${site.url}`, err);
        await supabase.from('competitor_sites').update({
          scrape_status: 'failed',
          scrape_error: String(err).substring(0, 200),
        }).eq('id', site.id);
      }
    }

    // Update job progress
    const { data: currentJob } = await supabase
      .from('competitor_research_jobs')
      .select('sites_scraped, pages_scraped')
      .eq('id', jobId)
      .single();

    await supabase.from('competitor_research_jobs').update({
      sites_scraped: (currentJob?.sites_scraped || 0) + sitesScraped,
      pages_scraped: (currentJob?.pages_scraped || 0) + pagesScraped,
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Check if more sites to scrape
    const { count: remainingCount } = await supabase
      .from('competitor_sites')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('scrape_status', 'pending');

    if (remainingCount && remainingCount > 0) {
      // Continue scraping
      waitUntil(supabase.functions.invoke('competitor-scrape', { body: { jobId, workspaceId } }));
    } else {
      // Move to extraction phase
      await supabase.from('competitor_research_jobs').update({
        status: 'extracting',
        current_scraping_domain: null,
      }).eq('id', jobId);
      waitUntil(supabase.functions.invoke('competitor-extract-faqs', { body: { jobId, workspaceId } }));
    }

    return new Response(JSON.stringify({
      success: true,
      sitesScraped,
      pagesScraped,
      remaining: remainingCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[competitor-scrape] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
