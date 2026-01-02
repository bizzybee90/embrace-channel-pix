import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RUNTIME_MS = 50000; // Extended for more thorough discovery

// Blocked domains (directories, not actual businesses)
const BLOCKED_DOMAINS = [
  'yell.com', 'checkatrade.com', 'trustatrader.com', 'mybuilder.com',
  'bark.com', 'facebook.com', 'instagram.com', 'twitter.com', 'linkedin.com',
  'youtube.com', 'tiktok.com', 'pinterest.com', 'yelp.com', 'tripadvisor.com',
  'google.com', 'bing.com', 'yahoo.com', 'wikipedia.org', 'amazon.co.uk',
  'gumtree.com', 'freeindex.co.uk', 'thomsonlocal.com', 'cylex-uk.co.uk',
  'hotfrog.co.uk', 'misterwhat.co.uk', 'brownbook.net', 'uksmallbusinessdirectory.co.uk',
  'ratedpeople.com', 'trustpilot.com', 'reviews.co.uk', 'glassdoor.com', 'indeed.com',
  'x.com', 'gov.uk', 'amazon.com', 'ebay.com', 'reed.co.uk', 'thebestof.co.uk',
  'nextdoor.com', 'nextdoor.co.uk', 'which.co.uk', 'moneysupermarket.com'
];

// Non-UK domains that indicate wrong country
const NON_UK_TLD_PATTERNS = [
  '.com.au', '.com.nz', '.co.nz', '.ca', '.com.sg', '.ie', '.de', '.fr', '.es',
  '.it', '.nl', '.be', '.at', '.ch', '.pl', '.cz', '.hu', '.ro', '.bg', '.gr',
  '.pt', '.se', '.no', '.dk', '.fi', '.ru', '.ua', '.in', '.jp', '.kr', '.cn',
  '.hk', '.tw', '.ph', '.my', '.th', '.id', '.vn', '.za', '.br', '.mx', '.ar'
];

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;
const waitUntil = (p: Promise<unknown>) => { try { EdgeRuntime?.waitUntil(p); } catch { /* ignore */ } };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const { jobId, workspaceId, nicheQuery, serviceArea, targetCount = 50 } = await req.json();
    console.log('[competitor-discover] Starting:', { jobId, nicheQuery, serviceArea, targetCount });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    // Update job to discovering status
    await supabase.from('competitor_research_jobs').update({
      status: 'discovering',
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      industry: nicheQuery,
      location: serviceArea,
    }).eq('id', jobId);

    const discoveredSites = new Map<string, Record<string, unknown>>();
    let centerLat: number | null = null;
    let centerLng: number | null = null;

    // STEP 1: Geocode the location first
    if (GOOGLE_API_KEY && serviceArea) {
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(serviceArea + ', UK')}&key=${GOOGLE_API_KEY}`;
      const geocodeRes = await fetch(geocodeUrl);
      const geocodeData = await geocodeRes.json();
      
      if (geocodeData.results?.[0]?.geometry?.location) {
        centerLat = geocodeData.results[0].geometry.location.lat;
        centerLng = geocodeData.results[0].geometry.location.lng;
        console.log(`[competitor-discover] Geocoded: ${serviceArea} -> ${centerLat}, ${centerLng}`);
      } else {
        console.log('[competitor-discover] Geocoding failed:', geocodeData.status, geocodeData.error_message);
      }
    }

    // STEP 2: Use Google Places API for discovery (PRIMARY method)
    if (GOOGLE_API_KEY && centerLat && centerLng) {
      console.log('[competitor-discover] Using Google Places API for local business discovery');
      
      const radiusMeters = 32186; // 20 miles in meters

      // Multiple search variations to maximize results
      const searchQueries = [
        nicheQuery,
        `${nicheQuery} services`,
        `${nicheQuery} company`,
        `professional ${nicheQuery}`,
        `local ${nicheQuery}`,
      ];

      for (const query of searchQueries) {
        if (Date.now() - startTime > MAX_RUNTIME_MS) break;
        if (discoveredSites.size >= targetCount) break;

        const fullQuery = `${query} near ${serviceArea}`;
        console.log(`[competitor-discover] Google Places search: "${fullQuery}"`);
        
        // Text search with location bias
        const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?` +
          `query=${encodeURIComponent(fullQuery)}&` +
          `location=${centerLat},${centerLng}&` +
          `radius=${radiusMeters}&` +
          `region=uk&` +
          `key=${GOOGLE_API_KEY}`;

        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();

        console.log(`[competitor-discover] Google Places returned ${searchData.results?.length || 0} results for "${query}"`);

        if (searchData.status !== 'OK' && searchData.status !== 'ZERO_RESULTS') {
          console.error('[competitor-discover] Google Places API error:', searchData.status, searchData.error_message);
        }

        for (const place of searchData.results || []) {
          if (Date.now() - startTime > MAX_RUNTIME_MS) break;
          if (discoveredSites.size >= targetCount) break;
          
          // Get place details to get website
          try {
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?` +
              `place_id=${place.place_id}&` +
              `fields=website,formatted_phone_number,url&` +
              `key=${GOOGLE_API_KEY}`;
            
            const detailsRes = await fetch(detailsUrl);
            const detailsData = await detailsRes.json();
            const website = detailsData.result?.website;

            if (!website) {
              console.log(`[competitor-discover] ${place.name}: No website found`);
              continue;
            }

            let domain: string;
            try {
              domain = new URL(website).hostname.replace('www.', '').toLowerCase();
            } catch { continue; }

            if (BLOCKED_DOMAINS.some(blocked => domain.includes(blocked))) {
              console.log(`[competitor-discover] ${domain}: Blocked domain`);
              continue;
            }
            if (discoveredSites.has(domain)) continue;

            const placeLat = place.geometry?.location?.lat;
            const placeLng = place.geometry?.location?.lng;
            const distance = placeLat && placeLng 
              ? haversineDistance(centerLat, centerLng, placeLat, placeLng)
              : null;

            console.log(`[competitor-discover] Found: ${place.name} (${domain}) - ${distance?.toFixed(1)} miles`);

            discoveredSites.set(domain, {
              workspace_id: workspaceId,
              job_id: jobId,
              url: website,
              domain: domain,
              business_name: place.name,
              address: place.formatted_address,
              city: extractCity(place.formatted_address),
              rating: place.rating,
              review_count: place.user_ratings_total,
              place_id: place.place_id,
              latitude: placeLat,
              longitude: placeLng,
              distance_miles: distance,
              discovery_source: 'google_places',
              discovery_query: query,
              phone: detailsData.result?.formatted_phone_number,
              is_valid: true,
              status: 'approved',
              scrape_status: 'pending',
            });
          } catch (err) {
            console.error('[competitor-discover] Place details error:', err);
          }

          // Small delay between detail requests
          await new Promise(r => setTimeout(r, 100));
        }

        // Delay between search queries
        await new Promise(r => setTimeout(r, 300));
      }

      console.log(`[competitor-discover] Google Places found ${discoveredSites.size} sites with websites`);
    }

    // STEP 3: Supplement with Firecrawl ONLY for UK sites if needed
    if (discoveredSites.size < targetCount && FIRECRAWL_API_KEY) {
      console.log('[competitor-discover] Supplementing with Firecrawl (UK-focused)');
      
      // Force UK-specific searches
      const ukSearchQueries = [
        `${nicheQuery} ${serviceArea} UK`,
        `${nicheQuery} near ${serviceArea} site:.co.uk`,
        `${nicheQuery} company ${serviceArea} UK`,
        `best ${nicheQuery} ${serviceArea} England`,
      ];

      for (const query of ukSearchQueries) {
        if (discoveredSites.size >= targetCount) break;
        if (Date.now() - startTime > MAX_RUNTIME_MS) break;

        try {
          console.log(`[competitor-discover] Firecrawl search: "${query}"`);
          
          const searchResponse = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query,
              limit: 15,
            }),
          });

          if (!searchResponse.ok) {
            console.error('[competitor-discover] Firecrawl error:', searchResponse.status);
            continue;
          }

          const searchData = await searchResponse.json();
          console.log(`[competitor-discover] Firecrawl returned ${searchData.data?.length || 0} results`);

          for (const result of searchData.data || []) {
            try {
              const url = new URL(result.url);
              const domain = url.hostname.replace(/^www\./, '').toLowerCase();

              // Skip blocked domains
              if (BLOCKED_DOMAINS.some(blocked => domain.includes(blocked))) continue;
              if (discoveredSites.has(domain)) continue;

              // CRITICAL: Filter out non-UK domains
              const isNonUkDomain = NON_UK_TLD_PATTERNS.some(tld => domain.endsWith(tld));
              if (isNonUkDomain) {
                console.log(`[competitor-discover] Skipping non-UK domain: ${domain}`);
                continue;
              }

              // Strongly prefer .co.uk domains
              const isUkDomain = domain.endsWith('.co.uk') || domain.endsWith('.uk');
              
              // For .com domains, check if they look UK-specific
              if (!isUkDomain && domain.endsWith('.com')) {
                // Check title/description for UK indicators
                const text = `${result.title || ''} ${result.description || ''}`.toLowerCase();
                const hasUkIndicators = text.includes('uk') || 
                                        text.includes('england') || 
                                        text.includes('london') || 
                                        text.includes('luton') ||
                                        text.includes(serviceArea?.toLowerCase() || '') ||
                                        text.includes('£') ||
                                        text.includes('british');
                
                if (!hasUkIndicators) {
                  console.log(`[competitor-discover] Skipping likely non-UK .com: ${domain}`);
                  continue;
                }
              }

              console.log(`[competitor-discover] Firecrawl found: ${domain} (UK: ${isUkDomain})`);

              discoveredSites.set(domain, {
                workspace_id: workspaceId,
                job_id: jobId,
                url: result.url,
                domain: domain,
                title: result.title || domain,
                description: result.description || '',
                discovery_source: 'firecrawl',
                discovery_query: query,
                is_valid: isUkDomain ? true : null, // .co.uk pre-approved, others need validation
                status: isUkDomain ? 'approved' : 'pending',
                scrape_status: 'pending',
              });
            } catch { /* invalid URL */ }
          }
        } catch (err) {
          console.error('[competitor-discover] Firecrawl search error:', err);
        }

        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`[competitor-discover] Total discovered: ${discoveredSites.size} sites`);

    // STEP 4: AI validation for sites that need it (Firecrawl .com sites)
    const sitesNeedingValidation = Array.from(discoveredSites.entries()).filter(([_, s]) => s.is_valid === null);
    
    if (sitesNeedingValidation.length > 0 && LOVABLE_API_KEY) {
      console.log(`[competitor-discover] AI validating ${sitesNeedingValidation.length} sites`);
      
      const filterPrompt = `You are validating if websites are genuine UK ${nicheQuery} businesses near ${serviceArea}.

Classify each as:
- COMPANY: Genuine UK ${nicheQuery} business (approve)
- DIRECTORY: Business directory or aggregator (reject)
- NON_UK: Not a UK business (reject)
- IRRELEVANT: Not related to ${nicheQuery} (reject)

Sites to classify:
${sitesNeedingValidation.map(([domain, info], i) => `${i + 1}. ${domain} - "${info.title || ''}" - ${String(info.description || '').substring(0, 100)}`).join('\n')}

Return ONLY a JSON array: [{"domain": "example.com", "type": "COMPANY"}, ...]`;

      try {
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: filterPrompt }],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || '';
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          
          if (jsonMatch) {
            const classifications = JSON.parse(jsonMatch[0]);
            for (const c of classifications) {
              const site = discoveredSites.get(c.domain);
              if (site) {
                site.is_valid = c.type === 'COMPANY';
                site.status = c.type === 'COMPANY' ? 'approved' : 'rejected';
                site.is_directory = c.type === 'DIRECTORY';
                site.validation_reason = c.type !== 'COMPANY' ? c.type : null;
                console.log(`[competitor-discover] AI classified ${c.domain}: ${c.type}`);
              }
            }
          }
        }
      } catch (err) {
        console.error('[competitor-discover] AI filtering error:', err);
        // Reject ambiguous sites on error (safer for UK-focused results)
        for (const [domain, site] of sitesNeedingValidation) {
          site.is_valid = false;
          site.status = 'rejected';
          site.validation_reason = 'validation_failed';
        }
      }
    }

    // STEP 5: Insert approved sites into database
    const approvedSites = Array.from(discoveredSites.values())
      .filter(s => s.is_valid !== false)
      .slice(0, targetCount);
    
    const rejectedSites = Array.from(discoveredSites.values())
      .filter(s => s.is_valid === false);

    console.log(`[competitor-discover] Approved: ${approvedSites.length}, Rejected: ${rejectedSites.length}`);

    if (approvedSites.length > 0) {
      const { error: insertError } = await supabase
        .from('competitor_sites')
        .upsert(approvedSites, { onConflict: 'workspace_id,url', ignoreDuplicates: true });

      if (insertError) console.error('[competitor-discover] Insert error:', insertError);
    }

    // Update job
    await supabase.from('competitor_research_jobs').update({
      sites_discovered: discoveredSites.size,
      sites_approved: approvedSites.length,
      sites_validated: approvedSites.length,
      status: approvedSites.length > 0 ? 'scraping' : 'error',
      error_message: approvedSites.length === 0 ? 'No UK competitor sites found in your area' : null,
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Trigger scraping if we have sites
    if (approvedSites.length > 0) {
      waitUntil(supabase.functions.invoke('competitor-scrape', { body: { jobId, workspaceId } }));
    }

    return new Response(JSON.stringify({
      success: true,
      discovered: discoveredSites.size,
      approved: approvedSites.length,
      rejected: rejectedSites.length,
      googlePlacesCount: Array.from(discoveredSites.values()).filter(s => s.discovery_source === 'google_places').length,
      firecrawlCount: Array.from(discoveredSites.values()).filter(s => s.discovery_source === 'firecrawl').length,
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

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c * 10) / 10;
}

function extractCity(address: string): string {
  const parts = address?.split(',') || [];
  return parts.length >= 2 ? parts[parts.length - 2].trim() : '';
}
