import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'kb-discover-competitors';
const FIRECRAWL_API = 'https://api.firecrawl.dev/v1';

// Directories and aggregators to exclude
const DIRECTORY_DOMAINS = [
  'yelp.com', 'yell.com', 'checkatrade.com', 'trustatrader.com', 'bark.com',
  'mybuilder.com', 'ratedpeople.com', 'freeindex.co.uk', 'thomsonlocal.com',
  'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com', 'youtube.com',
  'pinterest.com', 'tiktok.com', 'reddit.com', 'wikipedia.org', 'amazon.com',
  'ebay.com', 'gumtree.com', 'craigslist.org', 'nextdoor.com', 'trustpilot.com',
  'google.com', 'apple.com', 'microsoft.com', 'gov.uk', 'nhs.uk',
  'which.co.uk', 'moneysupermarket.com', 'comparethemarket.com'
];

interface DiscoveredCompetitor {
  company_name: string;
  website_url: string;
  domain: string;
  description?: string;
  source_query: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!firecrawlApiKey) throw new Error('FIRECRAWL_API_KEY not configured');

    const { job_id, workspace_id, niche_query, service_area, target_count = 15, exclude_domains = [] } = await req.json();

    if (!job_id) throw new Error('job_id is required');
    if (!workspace_id) throw new Error('workspace_id is required');
    if (!niche_query) throw new Error('niche_query is required');

    console.log(`[${FUNCTION_NAME}] Discovering competitors for job:`, job_id);

    // Update job status
    await supabase
      .from('competitor_research_jobs')
      .update({
        status: 'discovering',
        heartbeat_at: new Date().toISOString()
      })
      .eq('id', job_id);

    // Load user's own website to exclude
    const { data: profile } = await supabase
      .from('business_profile')
      .select('website, search_keywords')
      .eq('workspace_id', workspace_id)
      .single();

    const ownDomain = profile?.website ? extractDomain(profile.website) : null;
    const searchKeywords = profile?.search_keywords || [];

    // Build search queries
    const queries: string[] = [];
    
    // Main query
    queries.push(`${niche_query}${service_area ? ` in ${service_area}` : ''}`);
    
    // Query with "near me" variation
    queries.push(`${niche_query} services${service_area ? ` ${service_area}` : ''}`);
    
    // Use search keywords from website analysis
    for (const keyword of searchKeywords.slice(0, 2)) {
      if (keyword !== niche_query) {
        queries.push(`${keyword}${service_area ? ` ${service_area}` : ''}`);
      }
    }

    console.log(`[${FUNCTION_NAME}] Running ${queries.length} search queries`);

    // Execute searches in parallel
    const allCompetitors: DiscoveredCompetitor[] = [];
    const excludeSet = new Set([
      ...DIRECTORY_DOMAINS,
      ...exclude_domains.map((d: string) => d.toLowerCase()),
      ...(ownDomain ? [ownDomain.toLowerCase()] : [])
    ]);

    const searchPromises = queries.map(async (query) => {
      try {
        const response = await fetch(`${FIRECRAWL_API}/search`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query,
            limit: 10,
            scrapeOptions: { formats: [] } // Just get URLs, no content
          })
        });

        if (!response.ok) {
          console.warn(`[${FUNCTION_NAME}] Search failed for "${query}": ${response.status}`);
          return [];
        }

        const data = await response.json();
        const results = data.data || [];

        return results.map((result: any) => ({
          company_name: result.title || extractDomain(result.url),
          website_url: result.url,
          domain: extractDomain(result.url),
          description: result.description,
          source_query: query
        }));
      } catch (err) {
        console.warn(`[${FUNCTION_NAME}] Search error for "${query}":`, err);
        return [];
      }
    });

    const searchResults = await Promise.all(searchPromises);
    
    for (const results of searchResults) {
      allCompetitors.push(...results);
    }

    // Deduplicate by domain and filter excluded
    const seenDomains = new Set<string>();
    const validCompetitors = allCompetitors.filter(comp => {
      const domain = comp.domain.toLowerCase();
      
      // Skip if already seen
      if (seenDomains.has(domain)) return false;
      seenDomains.add(domain);
      
      // Skip directories and excluded domains
      if (isExcludedDomain(domain, excludeSet)) return false;
      
      // Skip if it's the user's own website
      if (ownDomain && domain === ownDomain.toLowerCase()) return false;
      
      return true;
    }).slice(0, target_count);

    console.log(`[${FUNCTION_NAME}] Found ${validCompetitors.length} valid competitors from ${allCompetitors.length} total`);

    // Insert competitors into database
    if (validCompetitors.length > 0) {
      const sitesToInsert = validCompetitors.map(comp => ({
        job_id,
        workspace_id,
        domain: comp.domain,
        url: comp.website_url,
        business_name: comp.company_name,
        description: comp.description,
        discovery_query: comp.source_query,
        discovery_source: 'firecrawl_search',
        status: 'approved', // Ready for mining
        scrape_status: 'pending',
        discovered_at: new Date().toISOString()
      }));

      const { error: insertError } = await supabase
        .from('competitor_sites')
        .insert(sitesToInsert);

      if (insertError) {
        console.error(`[${FUNCTION_NAME}] Insert error:`, insertError);
      }
    }

    // Update job with discovery results
    await supabase
      .from('competitor_research_jobs')
      .update({
        status: 'sites_ready',
        sites_discovered: validCompetitors.length,
        sites_approved: validCompetitors.length,
        search_queries: queries,
        heartbeat_at: new Date().toISOString()
      })
      .eq('id', job_id);

    // Update workspace status
    await supabase
      .from('workspaces')
      .update({ knowledge_base_status: 'competitors_discovered' })
      .eq('id', workspace_id);

    const duration = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Completed in ${duration}ms: ${validCompetitors.length} competitors`);

    return new Response(
      JSON.stringify({
        success: true,
        job_id,
        competitors_found: validCompetitors.length,
        competitors: validCompetitors.map(c => ({
          domain: c.domain,
          name: c.company_name,
          url: c.website_url
        })),
        queries_used: queries,
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

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isExcludedDomain(domain: string, excludeSet: Set<string>): boolean {
  const lowerDomain = domain.toLowerCase();
  
  // Direct match
  if (excludeSet.has(lowerDomain)) return true;
  
  // Check if domain ends with excluded domain (e.g., "business.facebook.com")
  for (const excluded of excludeSet) {
    if (lowerDomain.endsWith('.' + excluded) || lowerDomain === excluded) {
      return true;
    }
  }
  
  return false;
}
