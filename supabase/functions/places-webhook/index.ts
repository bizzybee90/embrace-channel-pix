import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Webhook receiver for async Google Places/Apify results
 * 
 * This handles the callback when using Apify's `compass/crawler-google-places` actor
 * for large-scale competitor discovery that exceeds Edge Function timeout limits.
 * 
 * Architecture:
 * 1. Frontend calls competitor-places-start → starts Apify actor with this webhook URL
 * 2. Apify scrapes Google Places asynchronously (5-15 minutes)
 * 3. Apify sends results here when complete
 * 4. This function stores results and updates job status
 */

const FUNCTION_NAME = 'places-webhook';

// Domains to always exclude
const EXCLUDED_DOMAINS = new Set([
  'yell.com', 'checkatrade.com', 'bark.com', 'mybuilder.com', 'ratedpeople.com',
  'freeindex.co.uk', 'trustatrader.com', 'trustpilot.com', 'yelp.co.uk',
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'youtube.com', 'tiktok.com', 'pinterest.com', 'google.com', 'bing.com',
]);

interface ApifyPlaceResult {
  title?: string;
  website?: string;
  address?: string;
  totalScore?: number;
  reviewsCount?: number;
  placeId?: string;
  location?: {
    lat: number;
    lng: number;
  };
  city?: string;
  postalCode?: string;
  phone?: string;
  categoryName?: string;
}

serve(async (req) => {
  // No CORS for webhooks - server-to-server
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const webhookSecret = Deno.env.get('APIFY_WEBHOOK_SECRET');

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify webhook authenticity
    const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') 
      || req.headers.get('x-webhook-secret');
    
    if (webhookSecret && authHeader !== webhookSecret) {
      console.error(`[${FUNCTION_NAME}] Invalid webhook secret`);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rawBody = await req.text();
    let payload: any;
    
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`[${FUNCTION_NAME}] Received webhook:`, {
      jobId: payload.job_id,
      workspaceId: payload.workspace_id,
      resultCount: payload.results?.length || 0
    });

    // Extract job context from payload
    const jobId = payload.job_id || payload.jobId;
    const workspaceId = payload.workspace_id || payload.workspaceId;
    const results: ApifyPlaceResult[] = payload.results || payload.data || [];
    const centerLat = payload.center_lat || payload.centerLat;
    const centerLng = payload.center_lng || payload.centerLng;

    if (!jobId || !workspaceId) {
      console.error(`[${FUNCTION_NAME}] Missing job_id or workspace_id`);
      return new Response(JSON.stringify({ 
        error: 'job_id and workspace_id required' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify job exists
    const { data: job, error: jobError } = await supabase
      .from('competitor_research_jobs')
      .select('id, status, workspace_id')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      console.error(`[${FUNCTION_NAME}] Job not found:`, jobId);
      return new Response(JSON.stringify({ error: 'Job not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify workspace matches
    if (job.workspace_id !== workspaceId) {
      console.error(`[${FUNCTION_NAME}] Workspace mismatch`);
      return new Response(JSON.stringify({ error: 'Workspace mismatch' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`[${FUNCTION_NAME}] Processing ${results.length} places for job ${jobId}`);

    // Process and dedupe results
    const sites: any[] = [];
    const seenDomains = new Set<string>();

    for (const place of results) {
      const website = place.website;
      if (!website) continue;

      // Extract domain
      let domain: string;
      try {
        const url = new URL(website);
        domain = url.hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        continue;
      }

      // Skip excluded or seen
      if (EXCLUDED_DOMAINS.has(domain) || seenDomains.has(domain)) continue;
      seenDomains.add(domain);

      // Calculate distance if we have coordinates
      let distanceMiles: number | null = null;
      if (centerLat && centerLng && place.location?.lat && place.location?.lng) {
        distanceMiles = calculateDistance(
          centerLat, centerLng,
          place.location.lat, place.location.lng
        );
      }

      sites.push({
        job_id: jobId,
        workspace_id: workspaceId,
        domain,
        url: website,
        business_name: place.title,
        address: place.address,
        city: place.city,
        postcode: place.postalCode,
        phone: place.phone,
        rating: place.totalScore,
        review_count: place.reviewsCount,
        place_id: place.placeId,
        latitude: place.location?.lat,
        longitude: place.location?.lng,
        distance_miles: distanceMiles ? Math.round(distanceMiles * 10) / 10 : null,
        status: 'discovered',
        is_valid: true,
        is_directory: false,
        discovery_source: 'apify_google_places',
        discovered_at: new Date().toISOString()
      });
    }

    // Sort by distance and limit
    sites.sort((a, b) => (a.distance_miles || 999) - (b.distance_miles || 999));
    const limitedSites = sites.slice(0, 100);

    console.log(`[${FUNCTION_NAME}] Inserting ${limitedSites.length} unique sites`);

    // Insert sites
    if (limitedSites.length > 0) {
      const { error: insertError } = await supabase
        .from('competitor_sites')
        .insert(limitedSites);

      if (insertError) {
        console.error(`[${FUNCTION_NAME}] Insert error:`, insertError);
      }
    }

    // Update job status
    await supabase
      .from('competitor_research_jobs')
      .update({
        status: limitedSites.length > 0 ? 'discovered' : 'error',
        sites_discovered: limitedSites.length,
        sites_approved: limitedSites.length,
        error_message: limitedSites.length === 0 ? 'No valid competitor websites found' : null,
        heartbeat_at: new Date().toISOString()
      })
      .eq('id', jobId);

    const duration = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Completed in ${duration}ms: ${limitedSites.length} sites stored`);

    return new Response(JSON.stringify({
      success: true,
      sites_stored: limitedSites.length,
      total_received: results.length,
      duration_ms: duration
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Error:`, error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      duration_ms: Date.now() - startTime
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// Haversine formula
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
