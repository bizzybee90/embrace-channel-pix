import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LocationData {
  displayName: string;
  placeId?: string;
  countryCode?: string;
  postcode?: string;
  lat?: number;
  lng?: number;
  radius?: number;
}

interface DiscoveredCompetitor {
  company_name: string;
  website_url: string;
  domain: string;
  source: string;
}

// Comprehensive list of directories and aggregators to exclude
const DIRECTORY_DOMAINS = [
  // UK directories
  'yell.com', 'checkatrade.com', 'bark.com', 'mybuilder.com', 'rated.people.com',
  'freeindex.co.uk', 'cylex-uk.co.uk', 'hotfrog.co.uk', 'thebestof.co.uk',
  'scoot.co.uk', 'thomsonlocal.com', 'misterwhat.co.uk', 'brownbook.net',
  'uksmallbusinessdirectory.co.uk', 'businessmagnet.co.uk', 'approved-business.co.uk',
  'yalwa.co.uk', 'businesslist.co.uk', 'applegate.co.uk', 'tuugo.co.uk',
  'fyple.co.uk', 'bizdb.co.uk', '118.com', '192.com', 'locallife.co.uk',
  
  // US directories
  'thumbtack.com', 'homeadvisor.com', 'angi.com', 'angieslist.com', 'houzz.com',
  'yellowpages.com', 'whitepages.com', 'manta.com', 'bbb.org', 'superpages.com',
  'dexknows.com', 'local.com', 'chamberofcommerce.com', 'spoke.com',
  
  // Global directories & review sites
  'yelp.com', 'yelp.co.uk', 'trustpilot.com', 'tripadvisor.com', 'google.com',
  'gumtree.com', 'craigslist.org', 'nextdoor.com', 'facebook.com', 'instagram.com',
  'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'pinterest.com', 'tiktok.com',
  'maps.google.com', 'amazon.com', 'ebay.com', 'ebay.co.uk', 'etsy.com',
  
  // Job sites
  'indeed.com', 'indeed.co.uk', 'glassdoor.com', 'glassdoor.co.uk', 'reed.co.uk',
  'totaljobs.com', 'cv-library.co.uk', 'monster.co.uk', 'ziprecruiter.com',
  
  // News/Wiki/Gov
  'wikipedia.org', 'gov.uk', 'bbc.com', 'bbc.co.uk', 'theguardian.com',
  'telegraph.co.uk', 'dailymail.co.uk', 'mirror.co.uk', 'express.co.uk',
  
  // Generic platforms
  'wix.com', 'squarespace.com', 'weebly.com', 'wordpress.com', 'blogger.com',
  'medium.com', 'substack.com', 'github.com', 'gitlab.com',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      jobId, 
      workspaceId, 
      nicheQuery, 
      serviceArea, 
      locationData,
      targetCount = 15, 
      excludeDomains = [] 
    } = await req.json();
    
    console.log('Competitor discovery started:', { jobId, nicheQuery, serviceArea, targetCount });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

    if (!FIRECRAWL_API_KEY) {
      console.error('FIRECRAWL_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'Firecrawl not configured - cannot search for competitors' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Update job status
    await supabase.from('competitor_research_jobs').update({
      status: 'discovering',
      started_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Parse location data for geo-filtering
    const parsedLocation: LocationData = locationData || parseServiceArea(serviceArea);
    const countryCode = parsedLocation.countryCode || 'GB';
    const isUK = countryCode === 'GB';
    const searchLang = isUK ? 'en-GB' : 'en-US';

    console.log('Location context:', { parsedLocation, countryCode, isUK });

    // Build exclusion set
    const allExcludeDomains = new Set([...DIRECTORY_DOMAINS, ...excludeDomains]);

    // Build search queries - these go to REAL Google search via Firecrawl
    const locationName = parsedLocation.displayName || serviceArea;
    const searchQueries = [
      `${nicheQuery} ${locationName}`,
      `${nicheQuery} services ${locationName}`,
      `best ${nicheQuery} near ${locationName}`,
      `local ${nicheQuery} ${locationName}`,
    ];

    // Add country-specific queries
    if (isUK) {
      searchQueries.push(`${nicheQuery} ${locationName} site:.co.uk`);
    }

    console.log('Search queries:', searchQueries);

    const discoveredCompetitors: DiscoveredCompetitor[] = [];
    const seenDomains = new Set<string>();

    // Run Firecrawl searches - this searches REAL Google results
    for (const query of searchQueries) {
      if (discoveredCompetitors.length >= targetCount * 2) break; // Get extra for filtering

      console.log(`Searching: "${query}"`);

      try {
        const searchResponse = await fetch('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            limit: 15,
            country: countryCode.toLowerCase(),
            lang: searchLang,
          }),
        });

        if (!searchResponse.ok) {
          const errorText = await searchResponse.text();
          console.error(`Firecrawl search failed for "${query}":`, searchResponse.status, errorText);
          continue;
        }

        const searchData = await searchResponse.json();
        const results = searchData.data || [];

        console.log(`Query "${query}" returned ${results.length} results`);

        for (const result of results) {
          try {
            const url = result.url;
            if (!url) continue;

            const domain = extractDomain(url);
            
            // Skip if already seen
            if (seenDomains.has(domain)) continue;
            
            // Skip directories and excluded domains
            if (isExcludedDomain(domain, allExcludeDomains)) {
              console.log(`Skipping directory/excluded: ${domain}`);
              continue;
            }

            // Skip obvious wrong-country domains for UK searches
            if (isUK) {
              if (domain.endsWith('.com.au') || domain.endsWith('.nz') || 
                  domain.endsWith('.ca') || domain.endsWith('.us')) {
                console.log(`Skipping non-UK domain: ${domain}`);
                continue;
              }
            }

            seenDomains.add(domain);
            discoveredCompetitors.push({
              company_name: result.title || domain,
              website_url: url,
              domain,
              source: query,
            });

            console.log(`Found: ${result.title || domain} (${domain})`);

          } catch (urlError) {
            console.error('Error processing URL:', result.url, urlError);
          }
        }

        // Small delay between searches to avoid rate limits
        await new Promise(r => setTimeout(r, 300));

      } catch (searchError) {
        console.error(`Search error for "${query}":`, searchError);
      }
    }

    console.log(`Total discovered: ${discoveredCompetitors.length} competitors`);

    // Limit to target count
    const finalCompetitors = discoveredCompetitors.slice(0, targetCount);

    console.log(`Final approved: ${finalCompetitors.length} competitors`);

    // Insert sites into database
    if (finalCompetitors.length > 0) {
      const sitesToInsert = finalCompetitors.map(site => ({
        job_id: jobId,
        workspace_id: workspaceId,
        domain: site.domain,
        url: site.website_url,
        title: site.company_name,
        description: `Found via search: ${site.source}`,
        status: 'approved',
        is_directory: false,
      }));

      const { error: insertError } = await supabase.from('competitor_sites').insert(sitesToInsert);
      if (insertError) {
        console.error('Error inserting sites:', insertError);
      }
    }

    // Update job progress
    await supabase.from('competitor_research_jobs').update({
      sites_discovered: discoveredCompetitors.length,
      sites_approved: finalCompetitors.length,
      status: finalCompetitors.length > 0 ? 'scraping' : 'error',
      error_message: finalCompetitors.length === 0 
        ? `No competitor sites found for "${nicheQuery}" in ${locationName}. Try adjusting your search terms.` 
        : null,
    }).eq('id', jobId);

    // Scraping is now handled by n8n workflow - no need to trigger scrape worker
    if (finalCompetitors.length > 0) {
      console.log('Sites discovered and ready for n8n scraping pipeline');
    }

    return new Response(JSON.stringify({
      success: true,
      discovered: discoveredCompetitors.length,
      approved: finalCompetitors.length,
      countryCode,
      locationVerified: locationName,
      queries: searchQueries,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Discovery error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Check if domain should be excluded
function isExcludedDomain(domain: string, excludeSet: Set<string>): boolean {
  // Direct match
  if (excludeSet.has(domain)) return true;
  
  // Check if domain contains any excluded pattern
  for (const excluded of excludeSet) {
    if (domain.includes(excluded) || excluded.includes(domain)) {
      return true;
    }
  }
  
  // Check for common directory patterns in domain name
  const directoryPatterns = [
    'directory', 'listing', 'finder', 'search', 'compare',
    'reviews', 'ratings', 'quotes', 'near-me', 'nearme',
    'local-', '-local', 'find-', '-finder', 'best-',
  ];
  
  for (const pattern of directoryPatterns) {
    if (domain.includes(pattern)) return true;
  }
  
  return false;
}

// Helper to extract domain from URL
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
}

// Parse service area string into structured location data
function parseServiceArea(serviceArea: string): LocationData {
  if (!serviceArea) return { displayName: '' };
  
  // Parse "Luton, Bedfordshire (20 miles)" format
  const radiusMatch = serviceArea.match(/^(.+?)\s*\((\d+)\s*miles?\)$/i);
  const name = radiusMatch ? radiusMatch[1].trim() : serviceArea;
  const radius = radiusMatch ? parseInt(radiusMatch[2], 10) : undefined;
  
  // Try to detect country from common UK/US patterns
  let countryCode = 'GB'; // Default to UK
  const lowerName = name.toLowerCase();
  
  // US state abbreviations or common US cities
  const usIndicators = [
    'california', 'texas', 'florida', 'new york', 'illinois',
    ', ca', ', tx', ', fl', ', ny', ', il', ', az', ', wa',
    'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia',
  ];
  
  if (usIndicators.some(ind => lowerName.includes(ind))) {
    countryCode = 'US';
  }
  
  return {
    displayName: name,
    countryCode,
    radius,
  };
}
