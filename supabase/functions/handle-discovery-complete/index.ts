import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Haversine formula for calculating distance between two lat/lng points (in miles)
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Common exclusions that apply to most service businesses
// These are clearly unrelated to the typical local service business
const GENERIC_EXCLUSIONS = [
  'car wash', 'hand car wash', 'valeting', 'valet',
  'roofing', 'roofer', 'roof repair',
  'windscreen', 'auto glass', 'car glass', 'windshield',
  'estate agent', 'letting agent', 'property',
  'accountant', 'solicitor', 'lawyer', 'legal',
  'driving school', 'driving instructor',
  'taxi', 'cab', 'minicab',
  'takeaway', 'restaurant', 'cafe', 'pub',
  'hairdresser', 'barber', 'beauty salon',
  'dentist', 'optician', 'pharmacy',
  'petrol', 'fuel', 'garage',
];

// Generate relevance score based on business name matching the niche query
function scoreRelevance(
  businessName: string,
  nicheQuery: string,
  location: string,
  address: string | null
): { score: number; reason: string } {
  const name = businessName.toLowerCase();
  const niche = nicheQuery.toLowerCase();
  const addr = (address || '').toLowerCase();
  
  // Extract meaningful words from the niche query (skip short words like "and", "the")
  const nicheWords = niche.split(/\s+/).filter(word => word.length > 3);
  
  // Check if business name contains any niche keyword
  const matchesNiche = nicheWords.some(word => name.includes(word));
  
  // Check for obviously wrong categories
  const isExcluded = GENERIC_EXCLUSIONS.some(excl => name.includes(excl));
  
  // Check if address contains target location (case-insensitive)
  const locationLower = location.toLowerCase();
  const inTargetArea = addr.includes(locationLower) || 
    // Also check for UK postcode pattern for the location
    (locationLower.length >= 2 && addr.includes(locationLower.substring(0, 2).toUpperCase()));
  
  // Scoring logic:
  // - Excluded businesses get 0 (marked as Weak)
  // - Matches niche + in target area = 100 (best match)
  // - Matches niche only = 80
  // - In target area only = 60 (local business, may need manual check)
  // - Neither = 40 (needs manual review)
  
  if (isExcluded) {
    return { score: 0, reason: 'Weak: Unrelated' };
  }
  
  if (matchesNiche && inTargetArea) {
    return { score: 100, reason: nicheQuery };
  }
  
  if (matchesNiche) {
    return { score: 80, reason: nicheQuery };
  }
  
  if (inTargetArea) {
    return { score: 60, reason: 'Local business' };
  }
  
  return { score: 40, reason: 'Manual check' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const payload = await req.json()

    // Apify webhook payloads can arrive in different shapes depending on whether
    // a payloadTemplate is used and whether interpolation is enabled.
    const jobId = payload?.jobId
    const workspaceId = payload?.workspaceId

    const rawRunId = payload?.runId
    const rawDatasetId = payload?.datasetId

    const resourceRunId = payload?.resource?.id
    const resourceDatasetId = payload?.resource?.defaultDatasetId

    const runId = (typeof rawRunId === 'string' && !rawRunId.includes('{{'))
      ? rawRunId
      : (typeof resourceRunId === 'string' ? resourceRunId : undefined)

    const datasetId = (typeof rawDatasetId === 'string' && !rawDatasetId.includes('{{'))
      ? rawDatasetId
      : (typeof resourceDatasetId === 'string' ? resourceDatasetId : undefined)
    
    console.log('[handle-discovery-complete] Received webhook:', {
      jobId,
      workspaceId,
      datasetId: datasetId ?? rawDatasetId,
      runId: runId ?? rawRunId,
    })

    if (!jobId || !workspaceId) {
      throw new Error('Missing required webhook fields: jobId/workspaceId')
    }

    if (!datasetId) {
      throw new Error('Missing datasetId from Apify webhook (no interpolation + no resource.defaultDatasetId)')
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY')

    if (!APIFY_API_KEY) {
      throw new Error('APIFY_API_KEY not configured')
    }

    // Fetch job to get geocoded coordinates, niche query, and max_competitors for relevance scoring
    const { data: jobData } = await supabase
      .from('competitor_research_jobs')
      .select('geocoded_lat, geocoded_lng, niche_query, location, max_competitors')
      .eq('id', jobId)
      .single();
    
    const jobLat = jobData?.geocoded_lat;
    const jobLng = jobData?.geocoded_lng;
    const nicheQuery = jobData?.niche_query || '';
    const targetLocation = jobData?.location || '';
    const maxCompetitors = jobData?.max_competitors || 50;
    
    console.log('[handle-discovery-complete] Job data:', { jobLat, jobLng, nicheQuery, targetLocation, maxCompetitors });

    // Update job status to filtering
    await supabase.from('competitor_research_jobs').update({
      status: 'filtering',
      heartbeat_at: new Date().toISOString()
    }).eq('id', jobId)

    // =========================================
    // STEP 1: Fetch results from Apify dataset
    // =========================================
    
    const datasetResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
    )
    
    if (!datasetResponse.ok) {
      throw new Error(`Failed to fetch dataset: ${datasetResponse.status}`)
    }
    
    const places = await datasetResponse.json()
    console.log('[handle-discovery-complete] Fetched places:', places.length)

    // =========================================
    // STEP 2: Fetch directory blocklist
    // =========================================
    
    const { data: blocklist } = await supabase
      .from('directory_blocklist')
      .select('domain')
    
    const blockedDomains = new Set(blocklist?.map(b => b.domain.toLowerCase()) || [])

    // =========================================
    // STEP 3: Filter and validate competitors
    // =========================================
    
    const validCompetitors: any[] = []
    const filteredOut: any[] = []
    
    for (const place of places) {
      const websiteUrl = place.website || place.url
      
      if (!websiteUrl) {
        filteredOut.push({ name: place.title, reason: 'no_website' })
        continue
      }
      
      let hostname: string
      try {
        hostname = new URL(websiteUrl).hostname.replace(/^www\./, '').toLowerCase()
      } catch {
        filteredOut.push({ name: place.title, reason: 'invalid_url' })
        continue
      }
      
      // Check against blocklist
      const isBlocked = [...blockedDomains].some(domain => 
        hostname.includes(domain) || hostname.endsWith(domain)
      )
      
      if (isBlocked) {
        filteredOut.push({ name: place.title, reason: 'directory' })
        continue
      }
      
      // Check for social media
      if (hostname.includes('facebook.com') || 
          hostname.includes('instagram.com') ||
          hostname.includes('twitter.com') ||
          hostname.includes('linkedin.com') ||
          hostname.includes('x.com')) {
        filteredOut.push({ name: place.title, reason: 'social_media' })
        continue
      }
      
      // Calculate distance from job's geocoded center if we have coordinates
      let distanceMiles: number | null = null;
      if (jobLat && jobLng && place.location?.lat && place.location?.lng) {
        distanceMiles = haversineDistance(jobLat, jobLng, place.location.lat, place.location.lng);
        distanceMiles = Math.round(distanceMiles * 10) / 10; // Round to 1 decimal place
      }
      
      // Calculate relevance score based on niche match and location
      const businessName = place.title || place.name || '';
      const relevance = scoreRelevance(businessName, nicheQuery, targetLocation, place.address);
      
      // Build location_data for user review
      const locationData = {
        address: place.address,
        phone: place.phone,
        rating: place.totalScore,
        reviewsCount: place.reviewsCount,
        openingHours: place.openingHours,
        placeId: place.placeId,
        lat: place.location?.lat,
        lng: place.location?.lng,
      }
      
      validCompetitors.push({
        job_id: jobId,
        workspace_id: workspaceId,
        business_name: businessName,
        url: websiteUrl,
        domain: hostname,
        place_id: place.placeId,
        phone: place.phone,
        address: place.address,
        rating: place.totalScore,
        reviews_count: place.reviewsCount,
        latitude: place.location?.lat,
        longitude: place.location?.lng,
        distance_miles: distanceMiles,
        is_directory: false,
        discovery_source: 'google_places',
        status: 'approved',
        scrape_status: 'pending',
        is_selected: false, // Will be set below based on ranking + maxCompetitors
        location_data: locationData,
        match_reason: relevance.reason,
        relevance_score: relevance.score, // Persisted for smart replacement
        validation_status: 'pending',
      })
    }

    // =========================================
    // STEP 3.5: Sort by proximity (closest first), then by relevance
    // This ensures we auto-select the CLOSEST competitors, not just any N
    // =========================================
    
    validCompetitors.sort((a, b) => {
      // First: prioritize sites with valid distance data
      const aHasDistance = a.distance_miles !== null;
      const bHasDistance = b.distance_miles !== null;
      
      if (aHasDistance && !bHasDistance) return -1;
      if (!aHasDistance && bHasDistance) return 1;
      
      // If both have distance, sort by distance (closest first)
      if (aHasDistance && bHasDistance) {
        const distanceDiff = a.distance_miles - b.distance_miles;
        if (Math.abs(distanceDiff) > 0.5) { // If >0.5 mile difference, use distance
          return distanceDiff;
        }
      }
      
      // For similar distances (or no distance), use relevance score as tiebreaker
      return (b.relevance_score || 0) - (a.relevance_score || 0);
    });

    // After sorting by distance, only auto-select the top `maxCompetitors` sites
    // This ensures we select the CLOSEST competitors first
    validCompetitors.forEach((comp, index) => {
      // Only select if: within the limit AND has a reasonable relevance score
      comp.is_selected = index < maxCompetitors && comp.relevance_score >= 40;
    });

    // Count how many will be auto-selected
    const autoSelectedCount = validCompetitors.filter(c => c.is_selected).length;
    
    console.log('[handle-discovery-complete] Valid competitors:', validCompetitors.length, 
      'Auto-selected:', autoSelectedCount, 
      'Max allowed:', maxCompetitors,
      'Filtered out:', filteredOut.length);
    if (validCompetitors.length > 0) {
      console.log('[handle-discovery-complete] Closest competitor:', validCompetitors[0].business_name, 
        'score:', validCompetitors[0].relevance_score, 
        'reason:', validCompetitors[0].match_reason,
        'at', validCompetitors[0].distance_miles, 'miles',
        'selected:', validCompetitors[0].is_selected);
      
      // Log a few more for debugging
      const selected = validCompetitors.filter(c => c.is_selected);
      if (selected.length > 0) {
        const farthestSelected = selected[selected.length - 1];
        console.log('[handle-discovery-complete] Farthest selected:', farthestSelected.business_name,
          'at', farthestSelected.distance_miles, 'miles');
      }
    }

    // =========================================
    // STEP 4: Store ALL competitors in database (no slice limit!)
    // Use UPSERT with correct conflict column (workspace_id, url)
    // =========================================
    
    let insertedCount = 0
    let updatedCount = 0
    
    if (validCompetitors.length > 0) {
      // Process each competitor individually to handle upsert correctly
      for (const comp of validCompetitors) {
        // Check if site already exists
        const { data: existing } = await supabase
          .from('competitor_sites')
          .select('id, job_id')
          .eq('workspace_id', workspaceId)
          .eq('url', comp.url)
          .maybeSingle()
        
        if (existing) {
          // Update existing site to link to current job
          const { error: updateError } = await supabase
            .from('competitor_sites')
            .update({
              job_id: jobId,
              status: 'approved',
              scrape_status: 'pending',
              is_selected: comp.is_selected,
              location_data: comp.location_data,
              match_reason: comp.match_reason,
              relevance_score: comp.relevance_score,
              validation_status: 'pending',
              discovered_at: new Date().toISOString()
            })
            .eq('id', existing.id)
          
          if (!updateError) updatedCount++
        } else {
          // Insert new site
          const { error: insertError } = await supabase
            .from('competitor_sites')
            .insert(comp)
          
          if (!insertError) insertedCount++
        }
      }
      
      console.log('[handle-discovery-complete] Inserted:', insertedCount, 'Updated:', updatedCount)
    }

    // =========================================
    // STEP 5: Update job to REVIEW_READY status
    // DO NOT auto-start scraping - wait for user review!
    // =========================================
    
    await supabase.from('competitor_research_jobs').update({
      sites_discovered: places.length,
      sites_filtered: validCompetitors.length,
      sites_validated: validCompetitors.length, // Fix UI field mismatch
      sites_approved: validCompetitors.length, // Also set this for completeness
      status: validCompetitors.length > 0 ? 'review_ready' : 'completed',
      heartbeat_at: new Date().toISOString(),
      ...(validCompetitors.length === 0 ? {
        completed_at: new Date().toISOString(),
        error_message: 'No valid competitor websites found after filtering'
      } : {})
    }).eq('id', jobId)

    console.log('[handle-discovery-complete] Job updated to review_ready - waiting for user confirmation')

    return new Response(JSON.stringify({
      success: true,
      placesFound: places.length,
      validCompetitors: validCompetitors.length,
      filteredOut: filteredOut.length,
      status: 'review_ready',
      message: 'Discovery complete. Waiting for user to review and confirm competitors before scraping.'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[handle-discovery-complete] Error:', error)
    
    // Try to update job status to failed
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      const payload = await req.clone().json().catch(() => ({}))
      if (payload.jobId) {
        await supabase.from('competitor_research_jobs').update({
          status: 'failed',
          error_message: String(error)
        }).eq('id', payload.jobId)
      }
    } catch {}
    
    return new Response(JSON.stringify({
      success: false,
      error: String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
