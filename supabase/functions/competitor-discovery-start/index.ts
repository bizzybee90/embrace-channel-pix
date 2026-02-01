import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withApifyAdHocWebhooks } from "../_shared/apifyWebhooks.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * competitor-discovery-start
 * 
 * Initiates competitor discovery using Apify Google Places Scout.
 * 
 * Key improvements over start-competitor-research:
 * 1. Geocodes the FULL user address (not just city) for precise center point
 * 2. Uses ONLY the industry keyword for search (no city appended)
 * 3. Anchors results via customGeolocation Point + radiusKm
 * 4. Fetches 3x target to allow for filtering
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      workspaceId, 
      industry, 
      address,      // Full user address for geocoding
      radiusMiles = 20,
      maxCompetitors = 50 
    } = await req.json();
    
    if (!workspaceId || !industry) {
      return new Response(JSON.stringify({ error: 'Missing required fields: workspaceId, industry' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const location = address || 'UK';
    console.log('[discovery-start] Starting:', { workspaceId, industry, location, radiusMiles, maxCompetitors });

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

    // Cancel any existing running jobs for this workspace
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
      console.error('[discovery-start] Job creation error:', jobError);
      return new Response(JSON.stringify({ error: 'Failed to create job' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[discovery-start] Created job:', job.id);

    // =========================================
    // STEP 2: Geocode the FULL address
    // This ensures we anchor to the user's specific location, not city center
    // =========================================
    
    console.log('[discovery-start] Geocoding address:', location);
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
    
    const originLat = parseFloat(geocodeData[0].lat);
    const originLon = parseFloat(geocodeData[0].lon);
    const radiusKm = radiusMiles * 1.60934;
    
    console.log('[discovery-start] Geocoded to:', { originLat, originLon, radiusKm });

    // Update job with coordinates
    await supabase.from('competitor_research_jobs').update({
      geocoded_lat: originLat,
      geocoded_lng: originLon,
      radius_km: radiusKm,
      status: 'discovering',
      heartbeat_at: new Date().toISOString()
    }).eq('id', job.id);

    // =========================================
    // STEP 3: Configure Apify Google Places Scout
    // KEY: Use ONLY industry keyword, NOT "industry + city"
    // Appending city name biases results to city center
    // =========================================
    
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    const webhookUrl = `${SUPABASE_URL}/functions/v1/competitor-webhooks?apikey=${SUPABASE_ANON_KEY}`;
    
    // Fetch 3x target to allow for strict filtering
    const crawlLimit = Math.min(maxCompetitors * 3, 200);
    
    const apifyInput = {
      searchStringsArray: [industry], // ONLY industry keyword, e.g., "Window Cleaning"
      locationQuery: `${location}, UK`, // Acts as center anchor for search
      maxCrawledPlacesPerSearch: crawlLimit,
      language: "en",
      countryCode: "gb",
      skipClosedPlaces: true,
      onlyDataFromSearchPage: false,
      customGeolocation: {
        type: "Point",
        coordinates: [originLon, originLat], // [Longitude, Latitude] - GeoJSON order
        radiusKm: radiusKm
      }
    };
    
    console.log('[discovery-start] Apify config:', {
      searchStrings: apifyInput.searchStringsArray,
      locationQuery: apifyInput.locationQuery,
      center: { lat: originLat, lon: originLon },
      radiusKm,
      crawlLimit
    });

    // Webhook definition for Apify
    const webhookDefs = [
      {
        eventTypes: ['ACTOR.RUN.SUCCEEDED'],
        requestUrl: webhookUrl,
        shouldInterpolateStrings: true,
        payloadTemplate: JSON.stringify({
          type: 'discovery',
          jobId: job.id,
          workspaceId,
          originLat,
          originLon,
          radiusMiles,
          maxCompetitors,
          industry,
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
      console.error('[discovery-start] Apify error:', errorText);
      
      await supabase.from('competitor_research_jobs').update({
        status: 'failed',
        error_message: `Apify API error: ${apifyResponse.status}`
      }).eq('id', job.id);
      
      return new Response(JSON.stringify({ error: `Apify API error: ${errorText}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const apifyData = await apifyResponse.json();
    console.log('[discovery-start] Apify run started:', apifyData.data?.id);

    // Update job with Apify run ID
    await supabase.from('competitor_research_jobs').update({
      discovery_run_id: apifyData.data.id,
      heartbeat_at: new Date().toISOString()
    }).eq('id', job.id);

    return new Response(JSON.stringify({
      success: true,
      jobId: job.id,
      status: 'discovering',
      message: 'Discovery started. You will be notified when complete.',
      coordinates: { lat: originLat, lon: originLon },
      radiusKm
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[discovery-start] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
