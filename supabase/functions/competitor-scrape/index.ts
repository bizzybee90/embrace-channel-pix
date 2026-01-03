import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 10; // Scrape 10 sites at a time
const MAX_PAGES_PER_SITE = 5;

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;
const waitUntil = (p: Promise<unknown>) => { try { EdgeRuntime?.waitUntil(p); } catch { /* ignore */ } };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { jobId, workspaceId } = await req.json();
    console.log('[competitor-scrape] Starting:', { jobId });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');
    if (!APIFY_API_KEY) {
      await supabase.from('competitor_research_jobs').update({
        status: 'error',
        error_message: 'Apify API key not configured'
      }).eq('id', jobId);
      return new Response(JSON.stringify({ error: 'No Apify API key' }), {
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

    if (!sites || sites.length === 0) {
      // No more sites to scrape - move to extraction
      console.log('[competitor-scrape] No more sites, moving to extraction');
      await supabase.from('competitor_research_jobs').update({
        status: 'extracting',
        current_scraping_domain: null,
      }).eq('id', jobId);
      
      waitUntil(
        supabase.functions.invoke('competitor-extract-faqs', { body: { jobId, workspaceId } })
      );
      
      return new Response(JSON.stringify({ success: true, complete: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[competitor-scrape] Scraping ${sites.length} sites with Apify`);

    // Mark sites as scraping
    const siteIds = sites.map(s => s.id);
    await supabase.from('competitor_sites')
      .update({ scrape_status: 'scraping' })
      .in('id', siteIds);

    // Update current scraping domain
    await supabase.from('competitor_research_jobs').update({
      current_scraping_domain: sites[0].domain || new URL(sites[0].url).hostname,
    }).eq('id', jobId);

    // Prepare URLs for Apify
    const startUrls = sites.map(site => ({ url: site.url }));

    // Call Apify Website Content Crawler
    console.log('[competitor-scrape] Calling Apify Website Content Crawler...');
    const apifyResponse = await fetch(
      `https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: startUrls,
          maxCrawlPages: MAX_PAGES_PER_SITE * sites.length,
          maxCrawlDepth: 2,
          crawlerType: 'cheerio', // Fast, lightweight scraping
          includeUrlGlobs: [],
          excludeUrlGlobs: [
            '**/privacy**', '**/terms**', '**/cookie**',
            '**/login**', '**/register**', '**/cart**',
            '**/checkout**', '**/*.pdf', '**/*.jpg', '**/*.png'
          ],
        }),
      }
    );

    if (!apifyResponse.ok) {
      const errorText = await apifyResponse.text();
      console.error('[competitor-scrape] Apify error:', errorText);
      
      // Mark sites as failed
      await supabase.from('competitor_sites')
        .update({ scrape_status: 'failed', scrape_error: 'Apify API error' })
        .in('id', siteIds);
      
      throw new Error(`Apify error: ${apifyResponse.status}`);
    }

    const scrapedPages = await apifyResponse.json();
    console.log(`[competitor-scrape] Apify returned ${scrapedPages.length} pages`);

    let pagesStored = 0;

    // Store scraped content
    for (const page of scrapedPages) {
      const content = page.text || '';
      if (content.length < 200) continue; // Skip tiny pages

      const pageUrl = page.url || '';
      
      // Find which site this page belongs to
      let matchingSite = null;
      for (const site of sites) {
        const siteUrlBase = site.url.replace(/\/$/, '').replace(/^https?:\/\//, '').replace(/^www\./, '');
        const pageUrlBase = pageUrl.replace(/^https?:\/\//, '').replace(/^www\./, '');
        if (pageUrlBase.startsWith(siteUrlBase.split('/')[0])) {
          matchingSite = site;
          break;
        }
      }

      // Determine page type
      const urlLower = pageUrl.toLowerCase();
      let pageType = 'other';
      if (urlLower.match(/\.(com|co\.uk|uk)\/?$/)) pageType = 'homepage';
      else if (urlLower.includes('faq')) pageType = 'faq';
      else if (urlLower.includes('service')) pageType = 'services';
      else if (urlLower.includes('price') || urlLower.includes('pricing')) pageType = 'pricing';
      else if (urlLower.includes('about')) pageType = 'about';
      else if (urlLower.includes('contact')) pageType = 'contact';

      const { error } = await supabase.from('competitor_pages').upsert({
        workspace_id: workspaceId,
        site_id: matchingSite?.id || null,
        url: pageUrl,
        page_type: pageType,
        title: page.metadata?.title || '',
        content: content.substring(0, 50000), // Limit size
        word_count: content.split(/\s+/).length,
        faqs_extracted: false,
      }, { onConflict: 'workspace_id,url' });

      if (!error) {
        pagesStored++;
        console.log(`[competitor-scrape] Stored: ${pageUrl} (${pageType})`);
      }
    }

    // Mark sites as completed
    await supabase.from('competitor_sites')
      .update({ 
        scrape_status: 'completed',
        scraped_at: new Date().toISOString(),
      })
      .in('id', siteIds);

    // Update job progress
    const { data: currentJob } = await supabase
      .from('competitor_research_jobs')
      .select('sites_scraped, pages_scraped')
      .eq('id', jobId)
      .single();

    await supabase.from('competitor_research_jobs').update({
      sites_scraped: (currentJob?.sites_scraped || 0) + sites.length,
      pages_scraped: (currentJob?.pages_scraped || 0) + pagesStored,
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
      waitUntil(
        supabase.functions.invoke('competitor-scrape', { body: { jobId, workspaceId } })
      );
    } else {
      // Move to extraction
      await supabase.from('competitor_research_jobs').update({
        status: 'extracting',
        current_scraping_domain: null,
      }).eq('id', jobId);
      
      waitUntil(
        supabase.functions.invoke('competitor-extract-faqs', { body: { jobId, workspaceId } })
      );
    }

    return new Response(JSON.stringify({
      success: true,
      sitesBatch: sites.length,
      pagesStored,
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
