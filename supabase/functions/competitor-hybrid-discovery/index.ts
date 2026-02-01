import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withApifyAdHocWebhooks } from "../_shared/apifyWebhooks.ts";
import { generateUULE, getCountyForCity } from "../_shared/uule-generator.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    console.log('[hybrid-discovery] Starting:', { workspaceId, industry, location, radiusMiles, maxCompetitors });

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
        status: 'geocoding',
        started_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (jobError || !job) {
      console.error('[hybrid-discovery] Job error:', jobError);
      return new Response(JSON.stringify({ error: 'Failed to create job' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[hybrid-discovery] Created job:', job.id);

    // =========================================
    // STEP 2: Geocode the location
    // =========================================
    
    console.log('[hybrid-discovery] Geocoding address:', location);
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
    
    const lat = parseFloat(geocodeData[0].lat);
    const lng = parseFloat(geocodeData[0].lon);
    const radiusKm = radiusMiles * 1.60934;
    
    console.log('[hybrid-discovery] Geocoded to:', { lat, lng, radiusKm });

    // Update job with coordinates
    await supabase.from('competitor_research_jobs').update({
      geocoded_lat: lat,
      geocoded_lng: lng,
      radius_km: radiusKm,
      status: 'discovering',
      heartbeat_at: new Date().toISOString()
    }).eq('id', job.id);

    // =========================================
    // STEP 3: Calculate target split (75% Places, 25% SERP)
    // =========================================
    
    const placesTarget = Math.ceil(maxCompetitors * 0.75);
    const serpTarget = Math.floor(maxCompetitors * 0.25);
    
    console.log('[hybrid-discovery] Target split:', { placesTarget, serpTarget });

    // =========================================
    // STEP 4: Trigger Google Places Discovery (Phase 1)
    // =========================================
    
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    const placesWebhookUrl = `${SUPABASE_URL}/functions/v1/competitor-webhooks?apikey=${SUPABASE_ANON_KEY}`;
    
    // Fetch more than needed to allow for filtering
    const placesCrawlLimit = Math.min(placesTarget * 3, 150);
    
    // Get county for broader location context
    const county = getCountyForCity(location) || '';
    const locationWithCounty = county ? `${location}, ${county}` : location;
    
    const placesInput = {
      searchStringsArray: [industry],
      locationQuery: `${locationWithCounty}, UK`,
      maxCrawledPlacesPerSearch: placesCrawlLimit,
      language: "en",
      countryCode: "gb",
      skipClosedPlaces: true,
      onlyDataFromSearchPage: false,
      customGeolocation: {
        type: "Point",
        coordinates: [lng, lat],
        radiusKm: radiusKm
      }
    };
    
    console.log('[hybrid-discovery] Google Places config:', {
      searchStrings: placesInput.searchStringsArray,
      locationQuery: placesInput.locationQuery,
      center: { lat, lng },
      radiusKm,
      crawlLimit: placesCrawlLimit
    });

    const placesWebhookDefs = [
      {
        eventTypes: ['ACTOR.RUN.SUCCEEDED'],
        requestUrl: placesWebhookUrl,
        shouldInterpolateStrings: true,
        payloadTemplate: JSON.stringify({
          type: 'hybrid_places',
          jobId: job.id,
          workspaceId,
          industry,
          location,
          originLat: lat,
          originLon: lng,
          radiusMiles,
          maxCompetitors: placesTarget,
          serpTarget, // Pass SERP target for phase 2
          runId: '{{resource.id}}',
          datasetId: '{{resource.defaultDatasetId}}',
        }),
      },
    ];

    const placesRunUrl = withApifyAdHocWebhooks(
      `https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=${APIFY_API_KEY}`,
      placesWebhookDefs,
    );
    
    const placesResponse = await fetch(placesRunUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(placesInput),
    });
    
    if (!placesResponse.ok) {
      const errorText = await placesResponse.text();
      console.error('[hybrid-discovery] Google Places API error:', errorText);
      
      await supabase.from('competitor_research_jobs').update({
        status: 'failed',
        error_message: `Google Places API error: ${placesResponse.status}`
      }).eq('id', job.id);
      
      return new Response(JSON.stringify({ error: `Google Places API error: ${errorText}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const placesData = await placesResponse.json();
    console.log('[hybrid-discovery] Google Places run started:', placesData.data?.id);

    // Update job with Places run ID
    await supabase.from('competitor_research_jobs').update({
      discovery_run_id: placesData.data.id,
      heartbeat_at: new Date().toISOString()
    }).eq('id', job.id);

    return new Response(JSON.stringify({
      success: true,
      jobId: job.id,
      status: 'discovering',
      message: 'Hybrid discovery started (Phase 1: Google Places). SERP discovery will follow.',
      coordinates: { lat, lng },
      radiusKm,
      targets: { places: placesTarget, serp: serpTarget }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[hybrid-discovery] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
