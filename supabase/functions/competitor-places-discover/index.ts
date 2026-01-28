import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'competitor-places-discover';

// Domains to exclude (directories, aggregators, etc.)
const EXCLUDED_DOMAINS = new Set([
  // UK directories
  'yell.com', 'checkatrade.com', 'bark.com', 'mybuilder.com', 'ratedpeople.com',
  'freeindex.co.uk', 'trustatrader.com', 'trustpilot.com', 'yelp.co.uk',
  // Social/platforms
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'youtube.com', 'tiktok.com', 'pinterest.com',
  // Generic
  'google.com', 'bing.com', 'yahoo.com', 'wikipedia.org',
  // E-commerce
  'amazon.co.uk', 'ebay.co.uk', 'etsy.com',
]);

interface PlaceResult {
  name: string;
  website?: string;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
  place_id?: string;
  geometry?: {
    location: {
      lat: number;
      lng: number;
    };
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const googleApiKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || Deno.env.get('GOOGLE_API_KEY');
    
    if (!googleApiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY or GOOGLE_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { 
      jobId, 
      workspaceId, 
      nicheQuery, 
      serviceArea,
      latitude,
      longitude,
      radiusMiles = 25,
      targetCount = 50 
    } = await req.json();

    if (!workspaceId) throw new Error('workspaceId is required');
    if (!nicheQuery) throw new Error('nicheQuery is required');

    console.log(`[${FUNCTION_NAME}] Starting discovery:`, { 
      jobId, workspaceId, nicheQuery, serviceArea, radiusMiles 
    });

    // Get or create job
    let currentJobId = jobId;
    if (!currentJobId) {
      const { data: job, error: jobError } = await supabase
        .from('competitor_research_jobs')
        .insert({
          workspace_id: workspaceId,
          niche_query: nicheQuery,
          service_area: serviceArea,
          radius_miles: radiusMiles,
          target_count: targetCount,
          status: 'discovering',
          started_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString()
        })
        .select()
        .single();

      if (jobError) throw jobError;
      currentJobId = job.id;
    } else {
      // Update existing job to discovering
      await supabase
        .from('competitor_research_jobs')
        .update({ 
          status: 'discovering', 
          heartbeat_at: new Date().toISOString() 
        })
        .eq('id', currentJobId);
    }

    // Get location coordinates if not provided
    let lat = latitude;
    let lng = longitude;
    
    if (!lat || !lng) {
      // Try to get from business profile
      const { data: profile } = await supabase
        .from('business_profile')
        .select('latitude, longitude, formatted_address, place_id')
        .eq('workspace_id', workspaceId)
        .single();

      if (profile?.latitude && profile?.longitude) {
        lat = profile.latitude;
        lng = profile.longitude;
      } else if (serviceArea) {
        // Geocode the service area
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(serviceArea)}&key=${googleApiKey}&region=gb`;
        const geocodeRes = await fetch(geocodeUrl);
        const geocodeData = await geocodeRes.json();
        
        if (geocodeData.results?.[0]?.geometry?.location) {
          lat = geocodeData.results[0].geometry.location.lat;
          lng = geocodeData.results[0].geometry.location.lng;
        }
      }
    }

    if (!lat || !lng) {
      throw new Error('Unable to determine location coordinates. Please set your business location first.');
    }

    console.log(`[${FUNCTION_NAME}] Location: ${lat}, ${lng}`);

    // Convert miles to meters for Google API
    const radiusMeters = Math.min(radiusMiles * 1609.34, 50000); // Max 50km for Places API

    // Build search queries
    const searchQueries = [
      nicheQuery,
      `${nicheQuery} services`,
      `${nicheQuery} company`,
      `local ${nicheQuery}`,
    ];

    const discoveredSites: Map<string, any> = new Map();
    
    // Search using Google Places Text Search API
    for (const query of searchQueries) {
      if (discoveredSites.size >= targetCount * 1.5) break;

      try {
        const searchUrl = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
        searchUrl.searchParams.set('query', query);
        searchUrl.searchParams.set('location', `${lat},${lng}`);
        searchUrl.searchParams.set('radius', String(radiusMeters));
        searchUrl.searchParams.set('key', googleApiKey);
        searchUrl.searchParams.set('type', 'establishment');

        console.log(`[${FUNCTION_NAME}] Searching: ${query}`);

        const response = await fetch(searchUrl.toString());
        const data = await response.json();

        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
          console.error(`[${FUNCTION_NAME}] Places API error:`, data.status, data.error_message);
          continue;
        }

        const results: PlaceResult[] = data.results || [];
        console.log(`[${FUNCTION_NAME}] Found ${results.length} results for "${query}"`);

        // For each result, we need to get the website via Place Details API
        for (const place of results.slice(0, 10)) {
          if (!place.place_id) continue;

          try {
            // Get place details to get website
            const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
            detailsUrl.searchParams.set('place_id', place.place_id);
            detailsUrl.searchParams.set('fields', 'name,website,formatted_address,rating,user_ratings_total,geometry');
            detailsUrl.searchParams.set('key', googleApiKey);

            const detailsRes = await fetch(detailsUrl.toString());
            const detailsData = await detailsRes.json();

            if (detailsData.status !== 'OK') continue;

            const details = detailsData.result;
            const website = details.website;

            if (!website) continue;

            // Extract domain
            let domain: string;
            try {
              const url = new URL(website);
              domain = url.hostname.replace(/^www\./, '').toLowerCase();
            } catch {
              continue;
            }

            // Skip excluded domains
            if (EXCLUDED_DOMAINS.has(domain)) {
              console.log(`[${FUNCTION_NAME}] Skipping excluded: ${domain}`);
              continue;
            }

            // Skip if already seen
            if (discoveredSites.has(domain)) continue;

            // Calculate distance from center
            let distanceMiles: number | null = null;
            if (details.geometry?.location) {
              const placeLat = details.geometry.location.lat;
              const placeLng = details.geometry.location.lng;
              distanceMiles = calculateDistance(lat, lng, placeLat, placeLng);
            }

            discoveredSites.set(domain, {
              job_id: currentJobId,
              workspace_id: workspaceId,
              domain,
              url: website,
              business_name: details.name,
              address: details.formatted_address,
              rating: details.rating,
              review_count: details.user_ratings_total,
              place_id: place.place_id,
              latitude: details.geometry?.location?.lat,
              longitude: details.geometry?.location?.lng,
              distance_miles: distanceMiles ? Math.round(distanceMiles * 10) / 10 : null,
              status: 'discovered',
              is_valid: true,
              is_directory: false,
              discovery_source: 'google_places',
              discovered_at: new Date().toISOString()
            });

            console.log(`[${FUNCTION_NAME}] Discovered: ${details.name} (${domain}) - ${distanceMiles?.toFixed(1) || '?'}mi`);

          } catch (detailsError) {
            console.error(`[${FUNCTION_NAME}] Error getting details:`, detailsError);
          }

          // Small delay between details requests
          await new Promise(r => setTimeout(r, 100));
        }

        // Delay between searches to respect rate limits
        await new Promise(r => setTimeout(r, 200));

      } catch (searchError) {
        console.error(`[${FUNCTION_NAME}] Search error:`, searchError);
      }
    }

    // Convert to array and sort by distance
    const sites = Array.from(discoveredSites.values())
      .sort((a, b) => (a.distance_miles || 999) - (b.distance_miles || 999))
      .slice(0, targetCount);

    console.log(`[${FUNCTION_NAME}] Final sites: ${sites.length}`);

    // Insert sites into database
    if (sites.length > 0) {
      const { error: insertError } = await supabase
        .from('competitor_sites')
        .insert(sites);

      if (insertError) {
        console.error(`[${FUNCTION_NAME}] Insert error:`, insertError);
        // Try inserting one by one to find the problematic one
        for (const site of sites) {
          try {
            await supabase.from('competitor_sites').insert(site);
          } catch (e) {
            console.error(`[${FUNCTION_NAME}] Failed to insert:`, site.domain, e);
          }
        }
      }
    }

    // Update job status
    const nextStatus = sites.length > 0 ? 'discovered' : 'error';
    await supabase
      .from('competitor_research_jobs')
      .update({
        status: nextStatus,
        sites_discovered: sites.length,
        sites_approved: sites.length,
        error_message: sites.length === 0 ? `No competitor websites found for "${nicheQuery}" near ${serviceArea}. Try different search terms.` : null,
        heartbeat_at: new Date().toISOString()
      })
      .eq('id', currentJobId);

    const duration = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Completed in ${duration}ms: ${sites.length} competitors`);

    return new Response(JSON.stringify({
      success: true,
      job_id: currentJobId,
      competitors_found: sites.length,
      competitors: sites.map(s => ({
        name: s.business_name,
        website: s.url,
        city: s.address?.split(',')[0],
        distance_miles: s.distance_miles,
        rating: s.rating,
        review_count: s.review_count
      })),
      location: { lat, lng },
      radius_miles: radiusMiles,
      duration_ms: duration
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Error:`, error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      function: FUNCTION_NAME,
      duration_ms: Date.now() - startTime
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Haversine formula to calculate distance between two points
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * 
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
