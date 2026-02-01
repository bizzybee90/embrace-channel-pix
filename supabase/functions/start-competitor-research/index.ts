import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withApifyAdHocWebhooks } from "../_shared/apifyWebhooks.ts";

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
      console.error('[start-research] Job error:', jobError);
      return new Response(JSON.stringify({ error: 'Failed to create job' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[start-research] Created job:', job.id);

    // =========================================
    // STEP 2: Geocode the FULL address (not just city)
    // This ensures we anchor to the user's specific location
    // =========================================
    
    console.log('[start-research] Geocoding address:', location);
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
    
    console.log('[start-research] Geocoded to:', { lat, lng, radiusKm });

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
    // KEY CHANGE: Use ONLY the industry keyword, NOT "industry + city"
    // Appending city name biases results to city center, not user's location
    // =========================================
    
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    const webhookUrl = `${SUPABASE_URL}/functions/v1/handle-discovery-complete?apikey=${SUPABASE_ANON_KEY}`;
    
    // Fetch MORE than needed to allow for strict filtering
    // We'll filter by distance + relevance on the webhook side
    const crawlLimit = Math.min(maxCompetitors * 3, 150);
    
    // CRITICAL: Use ONLY the industry keyword for search
    // The customGeolocation will anchor results to the user's location
    const apifyInput = {
      searchStringsArray: [industry], // e.g., just "Window Cleaning"
      locationQuery: `${location}, UK`, // Acts as center anchor
      maxCrawledPlacesPerSearch: crawlLimit,
      language: "en",
      countryCode: "gb",
      skipClosedPlaces: true,
      onlyDataFromSearchPage: false,
      customGeolocation: {
        type: "Point",
        coordinates: [lng, lat], // [Longitude, Latitude]
        radiusKm: radiusKm
      }
    };
    
    console.log('[start-research] Apify config:', {
      searchStrings: apifyInput.searchStringsArray,
      locationQuery: apifyInput.locationQuery,
      center: { lat, lng },
      radiusKm,
      crawlLimit
    });

    const webhookDefs = [
      {
        eventTypes: ['ACTOR.RUN.SUCCEEDED'],
        requestUrl: webhookUrl,
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
