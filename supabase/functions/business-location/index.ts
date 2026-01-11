import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent';
const FUNCTION_NAME = 'business-location';

interface LocationRequest {
  workspace_id: string;
  business_name?: string;
  location_query: string;
  postcode?: string;
  service_radius?: number;
  get_place_id?: boolean;
}

interface LocationData {
  place_name: string;
  county: string;
  country: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  confidence: number;
  disambiguation_note?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY');
    if (!GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY not configured');
    }

    const body = await req.json() as LocationRequest;
    console.log(`[${FUNCTION_NAME}] Starting:`, { 
      workspace_id: body.workspace_id,
      location_query: body.location_query 
    });

    if (!body.workspace_id) throw new Error('workspace_id is required');
    if (!body.location_query) throw new Error('location_query is required');

    // -------------------------------------------------------------------------
    // Use Gemini with Google Search grounding to find accurate location
    // -------------------------------------------------------------------------
    const prompt = `You are a location resolver. Find the precise location for this business/address query.

Query: "${body.location_query}"
${body.business_name ? `Business name: ${body.business_name}` : ''}
${body.postcode ? `Postcode hint: ${body.postcode}` : ''}

Use Google Search to find the accurate location. If there are multiple places with similar names (e.g., Luton in Bedfordshire vs Luton in Kent), use context clues to pick the most likely one, or the larger/more well-known one.

Respond with ONLY a JSON object in this exact format:
{
  "place_name": "Luton",
  "county": "Bedfordshire",
  "country": "United Kingdom",
  "formatted_address": "Luton, Bedfordshire, UK",
  "latitude": 51.8787,
  "longitude": -0.4200,
  "confidence": 0.95,
  "disambiguation_note": "Selected Luton, Bedfordshire (pop. 225,000) over Luton, Kent (village)"
}`;

    const geminiResponse = await fetch(`${GEMINI_API}?key=${GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{
          google_search: {}  // Enable Google grounding
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024
        }
      })
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      throw new Error(`Gemini API error: ${errorText}`);
    }

    const geminiData = await geminiResponse.json();
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log(`[${FUNCTION_NAME}] Gemini response:`, responseText.substring(0, 200));

    // -------------------------------------------------------------------------
    // Parse JSON response
    // -------------------------------------------------------------------------
    let locationData: LocationData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      locationData = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`[${FUNCTION_NAME}] Parse error:`, responseText);
      throw new Error('Failed to parse location response');
    }

    // -------------------------------------------------------------------------
    // Optional: Get Google Place ID for more precise data
    // -------------------------------------------------------------------------
    let placeId: string | null = null;
    if (body.get_place_id && locationData.formatted_address) {
      try {
        const placesResponse = await fetch(
          `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?` +
          `input=${encodeURIComponent(locationData.formatted_address)}` +
          `&inputtype=textquery` +
          `&fields=place_id,formatted_address,geometry` +
          `&key=${GOOGLE_API_KEY}`
        );
        
        if (placesResponse.ok) {
          const placesData = await placesResponse.json();
          if (placesData.candidates?.[0]) {
            placeId = placesData.candidates[0].place_id;
            // Use more precise coords from Places API
            if (placesData.candidates[0].geometry?.location) {
              locationData.latitude = placesData.candidates[0].geometry.location.lat;
              locationData.longitude = placesData.candidates[0].geometry.location.lng;
            }
            console.log(`[${FUNCTION_NAME}] Got place_id: ${placeId}`);
          }
        }
      } catch (placesError) {
        console.log(`[${FUNCTION_NAME}] Places API lookup failed, using Gemini coordinates`);
      }
    }

    // -------------------------------------------------------------------------
    // Update business profile
    // -------------------------------------------------------------------------
    const { error: updateError } = await supabase
      .from('business_profile')
      .upsert({
        workspace_id: body.workspace_id,
        business_name: body.business_name || 'My Business',
        county: locationData.county,
        formatted_address: locationData.formatted_address,
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        place_id: placeId,
        service_radius_miles: body.service_radius || 25,
        updated_at: new Date().toISOString()
      }, { onConflict: 'workspace_id' });

    if (updateError) {
      throw new Error(`Failed to save location: ${updateError.message}`);
    }

    const duration = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        location: {
          ...locationData,
          place_id: placeId
        },
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
