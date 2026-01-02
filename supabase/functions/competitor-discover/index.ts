import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RUNTIME_MS = 25000;

// Blocked domains (directories, not actual businesses)
const BLOCKED_DOMAINS = [
  'yell.com', 'checkatrade.com', 'trustatrader.com', 'mybuilder.com',
  'bark.com', 'facebook.com', 'instagram.com', 'twitter.com', 'linkedin.com',
  'youtube.com', 'tiktok.com', 'pinterest.com', 'yelp.com', 'tripadvisor.com',
  'google.com', 'bing.com', 'yahoo.com', 'wikipedia.org', 'amazon.co.uk',
  'gumtree.com', 'freeindex.co.uk', 'thomsonlocal.com', 'cylex-uk.co.uk',
  'hotfrog.co.uk', 'misterwhat.co.uk', 'brownbook.net', 'uksmallbusinessdirectory.co.uk',
  'ratedpeople.com', 'trustpilot.com', 'reviews.co.uk', 'glassdoor.com', 'indeed.com',
  'x.com', 'gov.uk', 'amazon.com', 'ebay.com', 'reed.co.uk', 'thebestof.co.uk'
];

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;
const waitUntil = (p: Promise<unknown>) => { try { EdgeRuntime?.waitUntil(p); } catch { /* ignore */ } };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const { jobId, workspaceId, nicheQuery, serviceArea, targetCount = 100 } = await req.json();
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

    // Try Google Places API first (preferred - gets real local businesses)
    if (GOOGLE_API_KEY && serviceArea) {
      console.log('[competitor-discover] Using Google Places API');
      
      // Geocode the location
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(serviceArea + ', UK')}&key=${GOOGLE_API_KEY}`;
      const geocodeRes = await fetch(geocodeUrl);
      const geocodeData = await geocodeRes.json();
      
      if (geocodeData.results?.[0]?.geometry?.location) {
        const { lat, lng } = geocodeData.results[0].geometry.location;
        const radiusMeters = 20 * 1609; // 20 miles in meters
        
        console.log(`[competitor-discover] Location: ${serviceArea} -> ${lat}, ${lng}`);

        const searchQueries = [
          `${nicheQuery} ${serviceArea}`,
          `${nicheQuery} services ${serviceArea}`,
          `${nicheQuery} company ${serviceArea}`,
          `best ${nicheQuery} ${serviceArea}`,
        ];

        for (const query of searchQueries) {
          if (Date.now() - startTime > MAX_RUNTIME_MS) break;
          if (discoveredSites.size >= targetCount) break;

          console.log(`[competitor-discover] Searching: ${query}`);
          
          const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?` +
            `query=${encodeURIComponent(query)}&` +
            `location=${lat},${lng}&` +
            `radius=${radiusMeters}&` +
            `region=uk&` +
            `key=${GOOGLE_API_KEY}`;

          const searchRes = await fetch(searchUrl);
          const searchData = await searchRes.json();

          for (const place of searchData.results || []) {
            if (Date.now() - startTime > MAX_RUNTIME_MS) break;
            if (discoveredSites.size >= targetCount) break;
            
            // Get place details to get website
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?` +
              `place_id=${place.place_id}&` +
              `fields=website,formatted_phone_number,url&` +
              `key=${GOOGLE_API_KEY}`;
            
            const detailsRes = await fetch(detailsUrl);
            const detailsData = await detailsRes.json();
            const website = detailsData.result?.website;

            if (!website) continue;

            let domain: string;
            try {
              domain = new URL(website).hostname.replace('www.', '').toLowerCase();
            } catch { continue; }

            if (BLOCKED_DOMAINS.some(blocked => domain.includes(blocked))) continue;
            if (discoveredSites.has(domain)) continue;

            const placeLat = place.geometry?.location?.lat;
            const placeLng = place.geometry?.location?.lng;
            const distance = placeLat && placeLng 
              ? haversineDistance(lat, lng, placeLat, placeLng)
              : null;

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
          }

          await new Promise(r => setTimeout(r, 200));
        }
      }
    }

    // Fallback to Firecrawl search if Google didn't find enough
    if (discoveredSites.size < targetCount && FIRECRAWL_API_KEY) {
      console.log('[competitor-discover] Supplementing with Firecrawl search');
      
      const searchQueries = [
        `${nicheQuery} ${serviceArea || ''}`,
        `${nicheQuery} services ${serviceArea || ''}`,
        `best ${nicheQuery} near me ${serviceArea || ''}`,
      ];

      for (const query of searchQueries) {
        if (discoveredSites.size >= targetCount * 1.5) break;

        try {
          const searchResponse = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query,
              limit: 20,
            }),
          });

          if (!searchResponse.ok) continue;

          const searchData = await searchResponse.json();
          for (const result of searchData.data || []) {
            try {
              const url = new URL(result.url);
              const domain = url.hostname.replace(/^www\./, '').toLowerCase();

              if (BLOCKED_DOMAINS.some(blocked => domain.includes(blocked))) continue;
              if (discoveredSites.has(domain)) continue;

              discoveredSites.set(domain, {
                workspace_id: workspaceId,
                job_id: jobId,
                url: result.url,
                domain: domain,
                title: result.title || domain,
                description: result.description || '',
                discovery_source: 'firecrawl',
                discovery_query: query,
                is_valid: null, // Needs validation
                status: 'pending',
                scrape_status: 'pending',
              });
            } catch { /* invalid URL */ }
          }
        } catch (err) {
          console.error('Firecrawl search error:', err);
        }
      }
    }

    console.log(`[competitor-discover] Found ${discoveredSites.size} unique sites`);

    // Filter with AI if we have Firecrawl-sourced sites needing validation
    const sitesNeedingValidation = Array.from(discoveredSites.entries()).filter(([_, s]) => s.is_valid === null);
    
    if (sitesNeedingValidation.length > 0 && LOVABLE_API_KEY) {
      console.log(`[competitor-discover] AI filtering ${sitesNeedingValidation.length} sites`);
      
      const filterPrompt = `Classify each website as COMPANY (genuine ${nicheQuery} business), DIRECTORY, or IRRELEVANT.
      
Sites:
${sitesNeedingValidation.map(([domain, info], i) => `${i + 1}. ${domain} - "${info.title || ''}" - ${String(info.description || '').substring(0, 80)}`).join('\n')}

Return ONLY JSON array: [{"domain": "example.com", "type": "COMPANY"}, ...]`;

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
              }
            }
          }
        }
      } catch (err) {
        console.error('AI filtering error:', err);
        // Approve all on error
        for (const [_, site] of sitesNeedingValidation) {
          site.is_valid = true;
          site.status = 'approved';
        }
      }
    }

    // Insert sites into database
    const approvedSites = Array.from(discoveredSites.values())
      .filter(s => s.is_valid !== false)
      .slice(0, targetCount);
    
    const rejectedSites = Array.from(discoveredSites.values())
      .filter(s => s.is_valid === false);

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
      error_message: approvedSites.length === 0 ? 'No competitor sites found' : null,
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
  const R = 3959;
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
