import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Domains to skip (directories, social media, not actual businesses)
const SKIP_DOMAINS = [
  // Social media
  'facebook.com', 'instagram.com', 'twitter.com', 'linkedin.com',
  'youtube.com', 'tiktok.com', 'pinterest.com', 'x.com',
  // UK directories
  'yell.com', 'checkatrade.com', 'trustatrader.com', 'mybuilder.com',
  'bark.com', 'ratedpeople.com', 'mylocalservices.co.uk',
  'freeindex.co.uk', 'cylex-uk.co.uk', 'hotfrog.co.uk', 'misterwhat.co.uk',
  'brownbook.net', 'uksmallbusinessdirectory.co.uk', 'thomsonlocal.com',
  'scoot.co.uk', '192.com', 'thebestof.co.uk', 'touchlocal.com',
  // US directories
  'yelp.com', 'yellowpages.com', 'bbb.org', 'angieslist.com',
  'homeadvisor.com', 'thumbtack.com',
  // Review sites
  'tripadvisor.com', 'trustpilot.com', 'reviews.co.uk', 'reviews.io',
  // Job sites
  'indeed.com', 'glassdoor.com', 'reed.co.uk', 'totaljobs.com',
  // General
  'google.com', 'bing.com', 'yahoo.com', 'wikipedia.org',
  'amazon.co.uk', 'amazon.com', 'ebay.co.uk', 'ebay.com',
  'gumtree.com', 'craigslist.org', 'nextdoor.com', 'nextdoor.co.uk',
  // Government
  'gov.uk', 'nhs.uk',
];

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;
const waitUntil = (p: Promise<unknown>) => { try { EdgeRuntime?.waitUntil(p); } catch { /* ignore */ } };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { jobId, workspaceId } = await req.json();
    console.log('[competitor-discover] Starting with Apify:', { jobId, workspaceId });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');
    if (!APIFY_API_KEY) {
      console.error('[competitor-discover] No APIFY_API_KEY configured');
      await supabase.from('competitor_research_jobs').update({
        status: 'error',
        error_message: 'Apify API key not configured. Please add APIFY_API_KEY to secrets.'
      }).eq('id', jobId);
      return new Response(JSON.stringify({ error: 'No Apify API key' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get job details
    const { data: job } = await supabase
      .from('competitor_research_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job) {
      return new Response(JSON.stringify({ error: 'Job not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update status
    await supabase.from('competitor_research_jobs').update({
      status: 'discovering',
      started_at: job.started_at || new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    const industry = job.industry || job.niche_query;
    const location = job.location || job.service_area;

    // Generate UK-focused search queries
    const searchQueries = [
      `${industry} ${location}`,
      `${industry} services ${location}`,
      `${industry} company ${location}`,
      `best ${industry} ${location}`,
      `${industry} near ${location}`,
      `local ${industry} ${location}`,
      `professional ${industry} ${location}`,
    ].join('\n');

    console.log('[competitor-discover] Search queries:', searchQueries);

    // Call Apify Google Search Scraper
    console.log('[competitor-discover] Calling Apify Google Search Scraper...');
    const apifyResponse = await fetch(
      `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: searchQueries,
          maxPagesPerQuery: 2,        // First 2 pages of Google results
          resultsPerPage: 20,         // 20 results per page
          countryCode: 'gb',          // UK Google
          languageCode: 'en',
          mobileResults: false,
          includeUnfilteredResults: false,
        }),
      }
    );

    if (!apifyResponse.ok) {
      const errorText = await apifyResponse.text();
      console.error('[competitor-discover] Apify error:', errorText);
      await supabase.from('competitor_research_jobs').update({
        status: 'error',
        error_message: `Apify API error: ${apifyResponse.status}`
      }).eq('id', jobId);
      throw new Error(`Apify API error: ${apifyResponse.status}`);
    }

    const apifyResults = await apifyResponse.json();
    console.log('[competitor-discover] Apify returned', apifyResults.length, 'result sets');

    // Extract unique competitor URLs
    const discoveredUrls = new Map<string, Record<string, unknown>>();

    for (const resultSet of apifyResults) {
      const searchQuery = resultSet.searchQuery?.term || '';
      
      for (const result of resultSet.organicResults || []) {
        const url = result.url;
        if (!url) continue;

        // Extract and normalize domain
        let domain: string;
        try {
          const urlObj = new URL(url);
          domain = urlObj.hostname.replace('www.', '').toLowerCase();
        } catch {
          continue;
        }

        // Skip directory sites and social media
        if (SKIP_DOMAINS.some(skip => domain.includes(skip))) {
          console.log(`[competitor-discover] Skipping directory/social: ${domain}`);
          continue;
        }

        // Skip if already found
        if (discoveredUrls.has(domain)) {
          continue;
        }

        // Check if UK domain
        const isUkDomain = domain.endsWith('.co.uk') || domain.endsWith('.uk');

        console.log(`[competitor-discover] Found: ${domain} ${isUkDomain ? '(UK)' : ''}`);

        discoveredUrls.set(domain, {
          workspace_id: workspaceId,
          job_id: jobId,
          url: url,
          domain: domain,
          business_name: result.title || null,
          description: result.description || null,
          discovery_source: 'apify_google_search',
          discovery_query: searchQuery,
          is_valid: true,
          status: 'approved',
          scrape_status: 'pending',
        });
      }
    }

    console.log(`[competitor-discover] Total unique competitors: ${discoveredUrls.size}`);

    // Insert discovered sites
    if (discoveredUrls.size > 0) {
      const sites = Array.from(discoveredUrls.values());
      
      const { error: insertError } = await supabase
        .from('competitor_sites')
        .upsert(sites, { 
          onConflict: 'job_id,domain',
          ignoreDuplicates: true 
        });

      if (insertError) {
        console.error('[competitor-discover] Insert error:', insertError);
      }
    }

    // Update job
    await supabase.from('competitor_research_jobs').update({
      sites_discovered: discoveredUrls.size,
      sites_approved: discoveredUrls.size,
      status: discoveredUrls.size > 0 ? 'scraping' : 'error',
      error_message: discoveredUrls.size === 0 ? 'No competitor sites found' : null,
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Trigger scraping phase
    if (discoveredUrls.size > 0) {
      waitUntil(
        supabase.functions.invoke('competitor-scrape', { body: { jobId, workspaceId } })
      );
    }

    return new Response(JSON.stringify({
      success: true,
      sitesDiscovered: discoveredUrls.size,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[competitor-discover] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
