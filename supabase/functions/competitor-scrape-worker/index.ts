import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Scrape up to 10 sites per invocation to stay within timeout limits
const SITES_PER_BATCH = 10;
const MAX_PAGES_PER_SITE = 5;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId, workspaceId, nicheQuery, serviceArea } = await req.json();
    console.log('Competitor scrape worker started:', { jobId });

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

    // Get pending sites to scrape
    const { data: pendingSites, error: sitesError } = await supabase
      .from('competitor_sites')
      .select('*')
      .eq('job_id', jobId)
      .eq('status', 'approved')
      .limit(SITES_PER_BATCH);

    if (sitesError || !pendingSites || pendingSites.length === 0) {
      console.log('No more sites to scrape');
      
      // Check if all sites are done
      const { count } = await supabase
        .from('competitor_sites')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', jobId)
        .eq('status', 'approved');

      if (count === 0) {
        // All sites scraped, trigger FAQ generation
        await supabase.from('competitor_research_jobs').update({
          status: 'generating',
        }).eq('id', jobId);

        supabase.functions.invoke('competitor-faq-generate', {
          body: { jobId, workspaceId }
        }).catch(err => console.error('Failed to start FAQ generation:', err));
      }

      return new Response(JSON.stringify({ success: true, message: 'No pending sites' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Scraping ${pendingSites.length} sites`);

    let scrapedCount = 0;
    let totalContent = '';

    for (const site of pendingSites) {
      try {
        console.log('Scraping:', site.domain);

        // Update current scraping domain for UI feedback
        await supabase.from('competitor_research_jobs').update({
          current_scraping_domain: site.domain,
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

        console.log(`Mapped ${urlsToScrape.length} URLs for ${site.domain}`);

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
            console.error('Page scrape error:', url, pageError);
          }
        }

        // Update site record
        await supabase.from('competitor_sites').update({
          status: siteContent.length > 100 ? 'scraped' : 'error',
          pages_scraped: pagesScraped,
          content_extracted: siteContent.substring(0, 50000), // Limit stored content
          scraped_at: new Date().toISOString(),
        }).eq('id', site.id);

        if (siteContent.length > 100) {
          scrapedCount++;
          totalContent += `\n\n=== COMPETITOR: ${site.domain} ===\n${siteContent}`;

          // Generate FAQs immediately for this site (don't await - fire and forget)
          console.log(`Triggering FAQ generation for ${site.domain}`);
          supabase.functions.invoke('competitor-faq-per-site', {
            body: { 
              siteId: site.id, 
              jobId, 
              workspaceId,
              nicheQuery: nicheQuery || '',
              serviceArea: serviceArea || '',
            }
          }).catch(err => console.error('Per-site FAQ error:', site.domain, err));
        }

        // Delay between sites
        await new Promise(r => setTimeout(r, 500));

      } catch (siteError) {
        console.error('Site scrape error:', site.domain, siteError);
        await supabase.from('competitor_sites').update({
          status: 'error',
        }).eq('id', site.id);
      }
    }

    // Update job progress
    const { data: jobData } = await supabase
      .from('competitor_research_jobs')
      .select('sites_scraped')
      .eq('id', jobId)
      .single();

    const newScrapedTotal = (jobData?.sites_scraped || 0) + scrapedCount;

    await supabase.from('competitor_research_jobs').update({
      sites_scraped: newScrapedTotal,
      current_scraping_domain: null, // Clear current site after batch
    }).eq('id', jobId);

    // Check if there are more sites to scrape
    const { count: remainingCount } = await supabase
      .from('competitor_sites')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('status', 'approved');

    if (remainingCount && remainingCount > 0) {
      // Schedule next batch
      console.log(`${remainingCount} sites remaining, scheduling next batch`);
      supabase.functions.invoke('competitor-scrape-worker', {
        body: { jobId, workspaceId, nicheQuery, serviceArea }
      }).catch(err => console.error('Failed to schedule next batch:', err));
    } else {
      // All done - FAQs were generated per-site, now do final summary
      console.log('All sites scraped, completing job');
      
      // Wait a bit for per-site FAQ generation to complete
      await new Promise(r => setTimeout(r, 3000));
      
      await supabase.from('competitor_research_jobs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        current_scraping_domain: null,
      }).eq('id', jobId);
    }

    return new Response(JSON.stringify({
      success: true,
      scrapedCount,
      remainingCount: remainingCount || 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Scrape worker error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
