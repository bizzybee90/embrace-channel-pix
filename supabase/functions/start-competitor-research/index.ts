import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withApifyAdHocWebhooks } from "../_shared/apifyWebhooks.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// UK city coordinates for common locations (fallback)
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { 
      workspaceId, 
      industry, 
      location, 
      radiusMiles = 20,
      maxCompetitors = 50 
    } = await req.json();
    
    if (!workspaceId || !industry || !location) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[start-research] Starting:', { workspaceId, industry, location, radiusMiles });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

    if (!APIFY_API_KEY) {
      return new Response(JSON.stringify({ 
        error: 'APIFY_API_KEY not configured. Please add it to your secrets.' 
      }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Cancel any existing running jobs
    await supabase
      .from('competitor_research_jobs')
      .update({ status: 'cancelled' })
      .eq('workspace_id', workspaceId)
      .in('status', ['queued', 'geocoding', 'discovering', 'filtering', 'scraping', 'extracting', 'refining']);

    // Generate search queries
    const searchQueries = [
      `${industry} ${location}`,
      `${industry} services ${location}`,
      `${industry} company ${location}`,
      `best ${industry} ${location}`,
      `${industry} near ${location}`,
    ];

    // =========================================
    // STEP 1: Create job record
    // =========================================
    
    const { data: job, error: jobError } = await supabase
      .from('competitor_research_jobs')
      .insert({
        workspace_id: workspaceId,
        niche_query: industry,
        industry,
        location,
        service_area: location,
        radius_miles: radiusMiles,
        max_competitors: maxCompetitors,
        search_queries: searchQueries,
        status: 'geocoding',
        started_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (jobError || !job) {
      console.error('[start-research] Job error:', jobError);
      return new Response(JSON.stringify({ error: 'Failed to create job' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[start-research] Created job:', job.id);

    // =========================================
    // STEP 2: Geocode location to coordinates
    // =========================================
    
    let lat: number, lng: number;
    
    // Try lookup table first
    const locationKey = location.toLowerCase().trim();
    if (UK_COORDINATES[locationKey]) {
      lat = UK_COORDINATES[locationKey].lat;
      lng = UK_COORDINATES[locationKey].lng;
      console.log('[start-research] Using cached coordinates for:', locationKey);
    } else {
      // Use OpenStreetMap Nominatim (free geocoding)
      console.log('[start-research] Geocoding location:', location);
      const geocodeResponse = await fetch(
        `https://nominatim.openstreetmap.org/search?` + 
        `q=${encodeURIComponent(location + ', UK')}&format=json&limit=1`,
        { headers: { 'User-Agent': 'BizzyBee/1.0' } }
      );
      
      const geocodeData = await geocodeResponse.json();
      
      if (!geocodeData || geocodeData.length === 0) {
        await supabase.from('competitor_research_jobs').update({
          status: 'failed',
          error_message: `Could not geocode location: ${location}`
        }).eq('id', job.id);
        
        return new Response(JSON.stringify({ 
          error: `Could not find location: ${location}. Try a UK city or postcode.` 
        }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      lat = parseFloat(geocodeData[0].lat);
      lng = parseFloat(geocodeData[0].lon);
      console.log('[start-research] Geocoded to:', { lat, lng });
    }
    
    const radiusKm = radiusMiles * 1.60934;

    // Update job with coordinates
    await supabase.from('competitor_research_jobs').update({
      geocoded_lat: lat,
      geocoded_lng: lng,
      radius_km: radiusKm,
      status: 'discovering',
      heartbeat_at: new Date().toISOString()
    }).eq('id', job.id);

    // =========================================
    // STEP 3: Trigger Apify Google Maps Scraper
    // =========================================
    
    // CRITICAL: Include apikey in the webhook URL so Apify can authenticate
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    const webhookUrl = `${SUPABASE_URL}/functions/v1/handle-discovery-complete?apikey=${SUPABASE_ANON_KEY}`;
    
    // Request more than needed to account for filtering (directories, social media, no-website)
    // Cap at 200 for Apify limits and cost control
    const crawlLimit = Math.min(maxCompetitors * 2, 200);
    
    const apifyInput = {
      searchStringsArray: [industry],
      locationQuery: `${location}, UK`,
      maxCrawledPlacesPerSearch: crawlLimit,
      language: "en",
      countryCode: "gb",
      skipClosedPlaces: true,
      onlyDataFromSearchPage: false,
      customGeolocation: {
        type: "Point",
        coordinates: [lng, lat],  // [Longitude, Latitude] - note the order!
        radiusKm: radiusKm
      }
    };
    
    console.log('[start-research] Requesting', crawlLimit, 'places to yield ~', maxCompetitors, 'after filtering');
    console.log('[start-research] Webhook URL:', webhookUrl.replace(SUPABASE_ANON_KEY || '', '***'));
    console.log('[start-research] Calling Apify with:', apifyInput);

    // Apify ad-hoc webhooks must be passed via the `webhooks` URL parameter.
    // Apify uses {{resource.*}} for interpolation in webhook payload templates.
    // If we send '{{defaultDatasetId}}' literally, our handler will try to fetch a non-existent dataset and fail.
    const webhookDefs = [
      {
        eventTypes: ['ACTOR.RUN.SUCCEEDED'],
        requestUrl: webhookUrl,
        // Ensure Apify interpolates "{{resource.*}}" placeholders inside strings.
        shouldInterpolateStrings: true,
        payloadTemplate: JSON.stringify({
          jobId: job.id,
          workspaceId,
          runId: '{{resource.id}}',
          datasetId: '{{resource.defaultDatasetId}}',
        }),
      },
    ];

    const apifyRunUrl = withApifyAdHocWebhooks(
      `https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=${APIFY_API_KEY}`,
      webhookDefs,
    );
    
    const apifyResponse = await fetch(apifyRunUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apifyInput),
    });
    
    if (!apifyResponse.ok) {
      const errorText = await apifyResponse.text();
      console.error('[start-research] Apify error:', errorText);
      
      await supabase.from('competitor_research_jobs').update({
        status: 'failed',
        error_message: `Apify API error: ${apifyResponse.status}`
      }).eq('id', job.id);
      
      return new Response(JSON.stringify({ error: `Apify API error: ${errorText}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const apifyData = await apifyResponse.json();
    console.log('[start-research] Apify run started:', apifyData.data?.id);

    // Update job with Apify run ID
    await supabase.from('competitor_research_jobs').update({
      discovery_run_id: apifyData.data.id,
      heartbeat_at: new Date().toISOString()
    }).eq('id', job.id);

    // =========================================
    // DONE - Return immediately
    // =========================================
    
    return new Response(JSON.stringify({
      success: true,
      jobId: job.id,
      status: 'discovering',
      message: 'Research started. You will be notified when complete.',
      coordinates: { lat, lng },
      radiusKm
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[start-research] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
