import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Scrape up to 10 sites per invocation to stay within timeout limits
const SITES_PER_BATCH = 10;
const MAX_PAGES_PER_SITE = 5;
const MAX_ITERATIONS = 20; // Prevent infinite loops - max 200 sites total

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId, workspaceId, nicheQuery, serviceArea, iteration = 0 } = await req.json();
    console.log('[scrape-worker] Starting:', { jobId, iteration });

    // =========================================
    // GUARD 1: Max iterations check
    // =========================================
    if (iteration >= MAX_ITERATIONS) {
      console.log('[scrape-worker] Max iterations reached, stopping');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Max iterations reached',
        stopped: true 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: 'Firecrawl not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // =========================================
    // GUARD 2: Check job status before processing
    // =========================================
    const { data: job } = await supabase
      .from('competitor_research_jobs')
      .select('status')
      .eq('id', jobId)
      .single();

    if (!job || ['completed', 'cancelled', 'failed', 'error'].includes(job.status)) {
      console.log('[scrape-worker] Job not active, stopping:', job?.status);
      return new Response(JSON.stringify({ 
        success: true, 
        message: `Job is ${job?.status || 'not found'}`,
        stopped: true 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // =========================================
    // GUARD 3: Get ONLY pending sites (not already scraped)
    // Use scrape_status = 'pending' to avoid re-processing
    // =========================================
    const { data: pendingSites, error: sitesError } = await supabase
      .from('competitor_sites')
      .select('*')
      .eq('job_id', jobId)
      .eq('status', 'approved')
      .eq('scrape_status', 'pending')  // CRITICAL: Only pending sites
      .limit(SITES_PER_BATCH);

    if (sitesError || !pendingSites || pendingSites.length === 0) {
      console.log('[scrape-worker] No pending sites');
      
      // Check if ALL sites are done (no pending left)
      const { count: stillPending } = await supabase
        .from('competitor_sites')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', jobId)
        .eq('status', 'approved')
        .eq('scrape_status', 'pending');

      if (stillPending === 0) {
        // All sites scraped, trigger FAQ generation (ONLY ONCE)
        console.log('[scrape-worker] All sites done, completing job');
        
        // Get final counts
        const { data: finalJob } = await supabase
          .from('competitor_research_jobs')
          .select('faqs_generated, faqs_added')
          .eq('id', jobId)
          .single();

        const { count: totalFaqs } = await supabase
          .from('faq_database')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('generation_source', 'competitor_research');
        
        await supabase.from('competitor_research_jobs').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          current_scraping_domain: null,
          faqs_extracted: finalJob?.faqs_generated || 0,
          faqs_added: totalFaqs || finalJob?.faqs_added || 0,
        }).eq('id', jobId);
        
        console.log('[scrape-worker] Job marked completed');
      }

      return new Response(JSON.stringify({ success: true, message: 'No pending sites' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[scrape-worker] Scraping ${pendingSites.length} sites (iteration ${iteration})`);

    let scrapedCount = 0;

    for (const site of pendingSites) {
      try {
        console.log('[scrape-worker] Scraping:', site.domain);

        // =========================================
        // GUARD 4: Mark as 'scraping' FIRST to prevent re-pickup
        // =========================================
        await supabase.from('competitor_sites')
          .update({ scrape_status: 'scraping' })
          .eq('id', site.id);

        // Update current scraping domain for UI feedback
        await supabase.from('competitor_research_jobs').update({
          current_scraping_domain: site.domain,
          heartbeat_at: new Date().toISOString()
        }).eq('id', jobId);

        // First, map the site to get key URLs
        const mapResponse = await fetch('https://api.firecrawl.dev/v1/map', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: site.url,
            limit: MAX_PAGES_PER_SITE * 2,
          }),
        });

        let urlsToScrape = [site.url];

        if (mapResponse.ok) {
          const mapData = await mapResponse.json();
          const mappedUrls = mapData.links || [];
          
          // Prioritize FAQ, pricing, services, about pages
          const priorityPatterns = [/faq/i, /price/i, /pricing/i, /service/i, /about/i, /contact/i];
          const priorityUrls = mappedUrls.filter((url: string) => 
            priorityPatterns.some(p => p.test(url))
          );
          const otherUrls = mappedUrls.filter((url: string) => 
            !priorityPatterns.some(p => p.test(url))
          );

          urlsToScrape = [...new Set([site.url, ...priorityUrls, ...otherUrls])].slice(0, MAX_PAGES_PER_SITE);
        }

        console.log(`[scrape-worker] Mapped ${urlsToScrape.length} URLs for ${site.domain}`);

        // Scrape each URL
        let siteContent = '';
        let pagesScraped = 0;

        for (const url of urlsToScrape) {
          try {
            const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
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

            if (scrapeResponse.ok) {
              const scrapeData = await scrapeResponse.json();
              const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';
              
              if (markdown.length > 100) {
                siteContent += `\n\n--- PAGE: ${url} ---\n${markdown.substring(0, 5000)}`;
                pagesScraped++;
              }
            }

            // Small delay between page scrapes
            await new Promise(r => setTimeout(r, 300));

          } catch (pageError) {
            console.error('[scrape-worker] Page scrape error:', url, pageError);
          }
        }

        // =========================================
        // CRITICAL: Update site to 'scraped' or 'error' status
        // This prevents the site from being picked up again
        // =========================================
        const finalStatus = siteContent.length > 100 ? 'scraped' : 'error';
        
        await supabase.from('competitor_sites').update({
          scrape_status: finalStatus,
          pages_scraped: pagesScraped,
          content_extracted: siteContent.substring(0, 50000),
          scraped_at: new Date().toISOString(),
        }).eq('id', site.id);

        if (siteContent.length > 100) {
          scrapedCount++;
          
          // Generate FAQs for this site (fire and forget, but track)
          console.log(`[scrape-worker] Triggering FAQ generation for ${site.domain}`);
          supabase.functions.invoke('competitor-faq-per-site', {
            body: { 
              siteId: site.id, 
              jobId, 
              workspaceId,
              nicheQuery: nicheQuery || '',
              serviceArea: serviceArea || '',
            }
          }).catch(err => console.error('[scrape-worker] Per-site FAQ error:', site.domain, err));
        }

        // Delay between sites
        await new Promise(r => setTimeout(r, 500));

      } catch (siteError) {
        console.error('[scrape-worker] Site scrape error:', site.domain, siteError);
        // Mark as error to prevent infinite retry
        await supabase.from('competitor_sites').update({
          scrape_status: 'error',
          last_error: String(siteError)
        }).eq('id', site.id);
      }
    }

    // Update job progress
    const { data: jobData } = await supabase
      .from('competitor_research_jobs')
      .select('sites_scraped, faqs_extracted')
      .eq('id', jobId)
      .single();

    const newScrapedTotal = (jobData?.sites_scraped || 0) + scrapedCount;

    await supabase.from('competitor_research_jobs').update({
      sites_scraped: newScrapedTotal,
      current_scraping_domain: null,
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Check if there are more pending sites
    const { count: remainingCount } = await supabase
      .from('competitor_sites')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('status', 'approved')
      .eq('scrape_status', 'pending');  // Only count PENDING

    if (remainingCount && remainingCount > 0) {
      // Schedule next batch WITH iteration counter
      console.log(`[scrape-worker] ${remainingCount} sites remaining, scheduling batch ${iteration + 1}`);
      supabase.functions.invoke('competitor-scrape-worker', {
        body: { jobId, workspaceId, nicheQuery, serviceArea, iteration: iteration + 1 }
      }).catch(err => console.error('[scrape-worker] Failed to schedule next batch:', err));
    } else {
      // All done - wait briefly for per-site FAQ jobs, then mark complete
      console.log('[scrape-worker] All sites scraped, finalizing job...');
      
      await new Promise(r => setTimeout(r, 3000));
      
      const { data: finalJob } = await supabase
        .from('competitor_research_jobs')
        .select('faqs_generated, faqs_added')
        .eq('id', jobId)
        .single();

      const { count: totalFaqs } = await supabase
        .from('faq_database')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('generation_source', 'competitor_research');
      
      await supabase.from('competitor_research_jobs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        current_scraping_domain: null,
        faqs_extracted: finalJob?.faqs_generated || 0,
        faqs_added: totalFaqs || finalJob?.faqs_added || 0,
      }).eq('id', jobId);
      
      console.log(`[scrape-worker] Job completed: ${newScrapedTotal} sites, ${totalFaqs} FAQs`);
    }

    return new Response(JSON.stringify({
      success: true,
      scrapedCount,
      remainingCount: remainingCount || 0,
      iteration,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[scrape-worker] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
