import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'competitor-discover';

// UK city coordinates for common locations (ensures UK-first discovery)
const UK_COORDINATES: Record<string, { lat: number; lng: number }> = {
  'luton': { lat: 51.8787, lng: -0.4200 },
  'london': { lat: 51.5074, lng: -0.1278 },
  'manchester': { lat: 53.4808, lng: -2.2426 },
  'birmingham': { lat: 52.4862, lng: -1.8904 },
  'leeds': { lat: 53.8008, lng: -1.5491 },
  'milton keynes': { lat: 52.0406, lng: -0.7594 },
  'bedford': { lat: 52.1356, lng: -0.4685 },
  'st albans': { lat: 51.7520, lng: -0.3390 },
  'dunstable': { lat: 51.8859, lng: -0.5214 },
  'harpenden': { lat: 51.8154, lng: -0.3565 },
  'watford': { lat: 51.6565, lng: -0.3903 },
  'hemel hempstead': { lat: 51.7526, lng: -0.4692 },
  'stevenage': { lat: 51.9017, lng: -0.2019 },
  'hitchin': { lat: 51.9466, lng: -0.2818 },
  'letchworth': { lat: 51.9789, lng: -0.2299 },
  'cambridge': { lat: 52.2053, lng: 0.1218 },
  'oxford': { lat: 51.7520, lng: -1.2577 },
  'reading': { lat: 51.4543, lng: -0.9781 },
  'bristol': { lat: 51.4545, lng: -2.5879 },
  'liverpool': { lat: 53.4084, lng: -2.9916 },
  'sheffield': { lat: 53.3811, lng: -1.4701 },
  'newcastle': { lat: 54.9783, lng: -1.6178 },
  'nottingham': { lat: 52.9548, lng: -1.1581 },
  'leicester': { lat: 52.6369, lng: -1.1398 },
  'coventry': { lat: 52.4068, lng: -1.5197 },
  'glasgow': { lat: 55.8642, lng: -4.2518 },
  'edinburgh': { lat: 55.9533, lng: -3.1883 },
  'cardiff': { lat: 51.4816, lng: -3.1791 },
  'belfast': { lat: 54.5973, lng: -5.9301 },
};

// Domains to exclude (directories, aggregators, etc.)
const EXCLUDED_DOMAINS = new Set([
  // UK directories
  'yell.com', 'checkatrade.com', 'bark.com', 'mybuilder.com', 'ratedpeople.com',
  'freeindex.co.uk', 'trustatrader.com', 'trustpilot.com', 'yelp.co.uk',
  'thomsonlocal.com', 'cylex-uk.co.uk', 'hotfrog.co.uk', 'scoot.co.uk',
  // Social/platforms
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'youtube.com', 'tiktok.com', 'pinterest.com', 'nextdoor.com',
  // Generic
  'google.com', 'bing.com', 'yahoo.com', 'wikipedia.org', 'gov.uk',
  // E-commerce
  'amazon.co.uk', 'ebay.co.uk', 'etsy.com', 'gumtree.com',
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

    const body = await req.json();
    
    // Support both parameter naming conventions
    const workspaceId = body.workspaceId || body.workspace_id;
    const jobId = body.jobId || body.job_id;
    const nicheQueryParam = body.nicheQuery || body.niche_query;
    const serviceAreaParam = body.serviceArea || body.service_area;
    const targetCount = body.targetCount || body.target_count || 50;
    const radiusMiles = body.radiusMiles || body.radius_miles || 25;

    if (!workspaceId) throw new Error('workspace_id is required');

    console.log(`[${FUNCTION_NAME}] Starting discovery:`, { 
      jobId, workspaceId, nicheQueryParam, serviceAreaParam, radiusMiles 
    });

    // Try to get profile data - but DON'T fail if not found
    const { data: businessProfile } = await supabase
      .from('business_profile')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single();

    // Also check business_context as fallback
    const { data: businessContext } = await supabase
      .from('business_context')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single();

    // USE PARAMETERS FIRST, then fall back to profile data
    const industry = nicheQueryParam || businessProfile?.industry || businessContext?.business_type || 'local business';
    
    // Parse service area (remove radius suffix if present)
    let locationRaw = serviceAreaParam || businessProfile?.formatted_address || businessProfile?.service_area || businessContext?.service_area || '';
    // Clean: "Luton (20 miles)" -> "Luton"
    const location = locationRaw.replace(/\s*\(\d+\s*miles?\)$/i, '').split(',')[0].trim();

    if (!location) {
      throw new Error('No service area provided. Please enter a location for competitor research.');
    }

    console.log(`[${FUNCTION_NAME}] Using: industry="${industry}", location="${location}"`);

    // Get or create job
    let currentJobId = jobId;
    if (!currentJobId) {
      const { data: job, error: jobError } = await supabase
        .from('competitor_research_jobs')
        .insert({
          workspace_id: workspaceId,
          niche_query: industry,
          service_area: location,
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
      await supabase
        .from('competitor_research_jobs')
        .update({ 
          status: 'discovering', 
          heartbeat_at: new Date().toISOString() 
        })
        .eq('id', currentJobId);
    }

    // Get location coordinates
    let centerLat: number | null = businessProfile?.latitude || null;
    let centerLng: number | null = businessProfile?.longitude || null;
    
    // Try UK coordinates lookup first (most reliable for UK locations)
    if (!centerLat || !centerLng) {
      const locationKey = location.toLowerCase().trim();
      if (UK_COORDINATES[locationKey]) {
        centerLat = UK_COORDINATES[locationKey].lat;
        centerLng = UK_COORDINATES[locationKey].lng;
        console.log(`[${FUNCTION_NAME}] Using UK coordinates for: ${locationKey}`);
      }
    }
    
    // Fall back to Google Geocoding with UK bias
    if (!centerLat || !centerLng) {
      console.log(`[${FUNCTION_NAME}] Geocoding location: ${location}`);
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location + ', UK')}&key=${googleApiKey}&region=gb`;
      const geocodeRes = await fetch(geocodeUrl);
      const geocodeData = await geocodeRes.json();
      
      if (geocodeData.results?.[0]?.geometry?.location) {
        centerLat = geocodeData.results[0].geometry.location.lat;
        centerLng = geocodeData.results[0].geometry.location.lng;
        console.log(`[${FUNCTION_NAME}] Geocoded to: ${centerLat}, ${centerLng}`);
      }
    }

    if (!centerLat || !centerLng) {
      throw new Error(`Unable to find location coordinates for "${location}". Try a UK city name.`);
    }

    console.log(`[${FUNCTION_NAME}] Center: ${centerLat}, ${centerLng}`);

    // Update job with coordinates
    await supabase
      .from('competitor_research_jobs')
      .update({
        geocoded_lat: centerLat,
        geocoded_lng: centerLng,
        location: location
      })
      .eq('id', currentJobId);

    // Convert miles to meters (max 50km for Places API)
    const radiusMeters = Math.min(radiusMiles * 1609.34, 50000);

    // Build search queries based on industry
    const searchQueries = [
      industry,
      `${industry} services`,
      `${industry} near me`,
      `best ${industry}`,
    ];

    console.log(`[${FUNCTION_NAME}] Search queries:`, searchQueries);

    const discoveredSites: Map<string, any> = new Map();
    
    // Use Google Places Text Search API
    for (const query of searchQueries) {
      if (discoveredSites.size >= targetCount * 1.5) break;

      try {
        const searchUrl = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
        searchUrl.searchParams.set('query', query);
        searchUrl.searchParams.set('location', `${centerLat},${centerLng}`);
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

        // Get website for each result via Place Details
        for (const place of results.slice(0, 10)) {
          if (!place.place_id) continue;

          try {
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

            // Extract and validate domain
            let domain: string;
            try {
              const url = new URL(website);
              domain = url.hostname.replace(/^www\./, '').toLowerCase();
            } catch {
              continue;
            }

            // Skip excluded or seen domains
            if (EXCLUDED_DOMAINS.has(domain) || discoveredSites.has(domain)) continue;

            // Calculate distance
            let distanceMiles: number | null = null;
            if (details.geometry?.location) {
              distanceMiles = calculateDistance(
                centerLat!, centerLng!,
                details.geometry.location.lat, 
                details.geometry.location.lng
              );
            }

            // Extract city from address
            const addressParts = (details.formatted_address || '').split(',');
            const city = addressParts.length > 1 ? addressParts[addressParts.length - 3]?.trim() : null;

            discoveredSites.set(domain, {
              job_id: currentJobId,
              workspace_id: workspaceId,
              domain,
              url: website,
              business_name: details.name,
              address: details.formatted_address,
              city,
              rating: details.rating,
              review_count: details.user_ratings_total,
              place_id: place.place_id,
              latitude: details.geometry?.location?.lat,
              longitude: details.geometry?.location?.lng,
              distance_miles: distanceMiles ? Math.round(distanceMiles * 10) / 10 : null,
              status: 'approved', // Set to 'approved' so scrape-worker picks them up
              is_valid: true,
              is_directory: false,
              discovery_source: 'google_places',
              discovered_at: new Date().toISOString()
            });

            console.log(`[${FUNCTION_NAME}] Found: ${details.name} (${domain}) - ${distanceMiles?.toFixed(1) || '?'}mi`);

          } catch (detailsError) {
            console.error(`[${FUNCTION_NAME}] Details error:`, detailsError);
          }

          // Rate limit: 100ms between detail calls
          await new Promise(r => setTimeout(r, 100));
        }

        // Rate limit: 200ms between searches
        await new Promise(r => setTimeout(r, 200));

      } catch (searchError) {
        console.error(`[${FUNCTION_NAME}] Search error:`, searchError);
      }
    }

    // Sort by distance and limit
    const sites = Array.from(discoveredSites.values())
      .sort((a, b) => (a.distance_miles || 999) - (b.distance_miles || 999))
      .slice(0, targetCount);

    console.log(`[${FUNCTION_NAME}] Final count: ${sites.length} competitors`);

    // Insert sites
    if (sites.length > 0) {
      const { error: insertError } = await supabase
        .from('competitor_sites')
        .insert(sites);

      if (insertError) {
        console.error(`[${FUNCTION_NAME}] Insert error:`, insertError);
      }
    }

    // Update job status and auto-chain to scraping
    const nextStatus = sites.length > 0 ? 'scraping' : 'error';
    await supabase
      .from('competitor_research_jobs')
      .update({
        status: nextStatus,
        sites_discovered: sites.length,
        sites_approved: sites.length,
        sites_validated: sites.length, // Sites are pre-validated via Places API
        error_message: sites.length === 0 
          ? `No competitor websites found for "${industry}" near ${location}. Try different search terms or check your location settings.` 
          : null,
        heartbeat_at: new Date().toISOString()
      })
      .eq('id', currentJobId);

    // Auto-chain: trigger scraping if we found sites
    if (sites.length > 0) {
      console.log(`[${FUNCTION_NAME}] Auto-chaining to scrape-worker...`);
      supabase.functions.invoke('competitor-scrape-worker', {
        body: { 
          jobId: currentJobId, 
          workspaceId, 
          nicheQuery: industry, 
          serviceArea: location 
        }
      }).catch(err => console.error(`[${FUNCTION_NAME}] Failed to chain scrape-worker:`, err));
    }

    const duration = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Completed in ${duration}ms: ${sites.length} competitors`);

    return new Response(JSON.stringify({
      success: true,
      job_id: currentJobId,
      competitors_found: sites.length,
      competitors: sites.map(s => ({
        name: s.business_name,
        website: s.url,
        city: s.city,
        distance_miles: s.distance_miles,
        rating: s.rating,
        review_count: s.review_count
      })),
      location: { lat: centerLat, lng: centerLng, name: location },
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

// Haversine formula for distance calculation
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
