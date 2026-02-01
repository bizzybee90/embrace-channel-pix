import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// =========================================
// HAVERSINE FORMULA: Calculate distance between two points in miles
// =========================================
function getDistanceFromLatLonInMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Radius of earth in miles
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

// =========================================
// INDUSTRY-SPECIFIC BLOCKLISTS
// These filter out wrong-industry results based on Google category
// =========================================
function getBlocklistForIndustry(industry: string): string[] {
  const industryLower = industry.toLowerCase();
  
  // Base blocklist that applies to all service businesses
  const baseBlocklist = [
    'estate agent', 'letting agent', 'property',
    'accountant', 'solicitor', 'lawyer', 'legal',
    'driving school', 'driving instructor',
    'taxi', 'cab', 'minicab',
    'takeaway', 'restaurant', 'cafe', 'pub', 'bar',
    'hairdresser', 'barber', 'beauty salon', 'spa',
    'dentist', 'optician', 'pharmacy', 'doctor', 'gp',
    'petrol', 'fuel station',
    'supermarket', 'grocery', 'convenience store',
    'bank', 'building society', 'post office',
    'school', 'college', 'university',
    'church', 'mosque', 'temple',
    'hotel', 'bed and breakfast', 'hostel',
    'gym', 'fitness', 'leisure centre',
  ];
  
  // WINDOW CLEANING specific blocklist
  if (industryLower.includes('window') && industryLower.includes('clean')) {
    return [
      ...baseBlocklist,
      // Anti-Repair: Block anything repair/installation related
      'repair', 'repairs', 'repairing',
      'install', 'installation', 'installer', 
      'supply', 'supplier', 'supplies',
      'manufacturing', 'manufacturer',
      // Anti-Auto: Block car-related window services
      'auto', 'automotive', 'automobile',
      'windscreen', 'windshield',
      'car glass', 'auto glass', 'vehicle glass',
      'mot', 'car wash', 'hand car wash', 'valeting', 'valet',
      'car dealer', 'car sales',
      // Anti-Similar: Block similar but different trades
      'glazier', 'glazing', 'double glazing',
      'conservatory', 'upvc',
      'roofing', 'roofer', 'roof',
      'fascia', 'soffit',
      // Keep it strictly cleaning
      'blinds', 'curtains', 'shutters',
    ];
  }
  
  // PLUMBING specific blocklist
  if (industryLower.includes('plumb')) {
    return [
      ...baseBlocklist,
      'heating engineer', 'boiler', 'gas engineer',
      'electrician', 'electrical',
      'drainage', 'drain', 'sewer',
      'bathroom showroom', 'kitchen showroom',
      'tile', 'tiling',
      'flooring',
    ];
  }
  
  // GARDENING/LANDSCAPING specific blocklist
  if (industryLower.includes('garden') || industryLower.includes('landscap')) {
    return [
      ...baseBlocklist,
      'garden centre', 'plant nursery',
      'florist', 'flower shop',
      'tree surgeon', 'arborist',
      'fencing', 'fence',
      'paving', 'patio',
      'decking',
    ];
  }
  
  // CLEANING (general) specific blocklist
  if (industryLower.includes('clean') && !industryLower.includes('window')) {
    return [
      ...baseBlocklist,
      'laundry', 'laundrette', 'dry cleaner',
      'car wash', 'valeting', 'valet',
      'waste', 'skip hire', 'rubbish',
      'pest control',
    ];
  }
  
  // Default: just use base blocklist
  return baseBlocklist;
}

// Check if a business category matches any blocklist term
function isCategoryBlocked(categoryName: string | undefined, blocklist: string[]): boolean {
  if (!categoryName) return false;
  const categoryLower = categoryName.toLowerCase();
  return blocklist.some(term => categoryLower.includes(term));
}

// Check if business name contains blocklist terms
function isNameBlocked(businessName: string | undefined, blocklist: string[]): boolean {
  if (!businessName) return false;
  const nameLower = businessName.toLowerCase();
  return blocklist.some(term => nameLower.includes(term));
}

// Calculate relevance score (higher = better match)
function scoreRelevance(
  businessName: string,
  category: string | undefined,
  industry: string
): { score: number; reason: string } {
  const name = businessName.toLowerCase();
  const industryLower = industry.toLowerCase();
  const categoryLower = (category || '').toLowerCase();
  
  // Extract meaningful keywords from industry
  const industryWords = industryLower.split(/\s+/).filter(w => w.length > 3);
  
  // Check how many industry words appear in the business name
  const nameMatches = industryWords.filter(word => name.includes(word)).length;
  const categoryMatches = industryWords.filter(word => categoryLower.includes(word)).length;
  
  // Perfect match: business name contains industry keywords
  if (nameMatches >= 2 || (nameMatches >= 1 && categoryMatches >= 1)) {
    return { score: 100, reason: industry };
  }
  
  // Good match: name or category contains at least one keyword
  if (nameMatches >= 1) {
    return { score: 85, reason: industry };
  }
  
  if (categoryMatches >= 1) {
    return { score: 70, reason: `Category: ${category}` };
  }
  
  // Weak match: no keywords found but not blocked
  return { score: 50, reason: 'Related service' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const payload = await req.json()

    // Parse Apify webhook payload
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
      throw new Error('Missing datasetId from Apify webhook')
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY')

    if (!APIFY_API_KEY) {
      throw new Error('APIFY_API_KEY not configured')
    }

    // =========================================
    // STEP 1: Fetch job context (origin coordinates, industry, radius)
    // =========================================
    
    const { data: jobData } = await supabase
      .from('competitor_research_jobs')
      .select('geocoded_lat, geocoded_lng, niche_query, industry, location, max_competitors, radius_miles')
      .eq('id', jobId)
      .single();
    
    const originLat = jobData?.geocoded_lat;
    const originLng = jobData?.geocoded_lng;
    const industry = jobData?.industry || jobData?.niche_query || '';
    const targetLocation = jobData?.location || '';
    const maxCompetitors = jobData?.max_competitors || 50;
    const radiusMiles = jobData?.radius_miles || 20;
    
    console.log('[handle-discovery-complete] Job context:', { 
      originLat, originLng, industry, targetLocation, maxCompetitors, radiusMiles 
    });

    if (!originLat || !originLng) {
      throw new Error('Job missing geocoded coordinates');
    }

    // Update job status
    await supabase.from('competitor_research_jobs').update({
      status: 'filtering',
      heartbeat_at: new Date().toISOString()
    }).eq('id', jobId)

    // =========================================
    // STEP 2: Fetch raw results from Apify dataset
    // =========================================
    
    const datasetResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
    )
    
    if (!datasetResponse.ok) {
      throw new Error(`Failed to fetch dataset: ${datasetResponse.status}`)
    }
    
    const places = await datasetResponse.json()
    console.log('[handle-discovery-complete] Raw places from Apify:', places.length)

    // =========================================
    // STEP 3: Get industry-specific blocklist
    // =========================================
    
    const blocklist = getBlocklistForIndustry(industry);
    console.log('[handle-discovery-complete] Blocklist for', industry, ':', blocklist.length, 'terms');

    // =========================================
    // STEP 4: Fetch directory blocklist from DB
    // =========================================
    
    const { data: dbBlocklist } = await supabase
      .from('directory_blocklist')
      .select('domain')
    
    const blockedDomains = new Set(dbBlocklist?.map(b => b.domain.toLowerCase()) || [])

    // =========================================
    // STEP 5: Filter, calculate distance, and score each result
    // =========================================
    
    const validCompetitors: any[] = []
    const filteredOut: { name: string; reason: string }[] = []
    
    for (const place of places) {
      const businessName = place.title || place.name || '';
      const categoryName = place.categoryName || '';
      const websiteUrl = place.website || place.url;
      const placeLat = place.location?.lat;
      const placeLng = place.location?.lng;
      
      // FILTER 1: Must have a website
      if (!websiteUrl) {
        filteredOut.push({ name: businessName, reason: 'no_website' });
        continue;
      }
      
      // FILTER 2: Must have coordinates for distance calculation
      if (!placeLat || !placeLng) {
        filteredOut.push({ name: businessName, reason: 'no_coordinates' });
        continue;
      }
      
      // FILTER 3: Check category against industry-specific blocklist
      if (isCategoryBlocked(categoryName, blocklist)) {
        filteredOut.push({ name: businessName, reason: `blocked_category: ${categoryName}` });
        continue;
      }
      
      // FILTER 4: Check business name against blocklist
      if (isNameBlocked(businessName, blocklist)) {
        filteredOut.push({ name: businessName, reason: `blocked_name` });
        continue;
      }
      
      // FILTER 5: Validate URL and check domain blocklist
      let hostname: string;
      try {
        hostname = new URL(websiteUrl).hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        filteredOut.push({ name: businessName, reason: 'invalid_url' });
        continue;
      }
      
      const isBlockedDomain = [...blockedDomains].some(domain => 
        hostname.includes(domain) || hostname.endsWith(domain)
      );
      
      if (isBlockedDomain) {
        filteredOut.push({ name: businessName, reason: 'directory_domain' });
        continue;
      }
      
      // FILTER 6: Check for social media
      if (['facebook.com', 'instagram.com', 'twitter.com', 'linkedin.com', 'x.com', 'tiktok.com']
          .some(social => hostname.includes(social))) {
        filteredOut.push({ name: businessName, reason: 'social_media' });
        continue;
      }
      
      // CALCULATE: Distance from origin using Haversine formula
      const distanceMiles = getDistanceFromLatLonInMiles(originLat, originLng, placeLat, placeLng);
      
      // FILTER 7: Must be within the specified radius
      if (distanceMiles > radiusMiles) {
        filteredOut.push({ name: businessName, reason: `too_far: ${distanceMiles}mi > ${radiusMiles}mi` });
        continue;
      }
      
      // SCORE: Calculate relevance based on name/category match
      const relevance = scoreRelevance(businessName, categoryName, industry);
      
      // Build competitor record
      validCompetitors.push({
        job_id: jobId,
        workspace_id: workspaceId,
        business_name: businessName,
        url: websiteUrl,
        domain: hostname,
        place_id: place.placeId,
        phone: place.phone,
        address: place.address,
        city: place.city,
        rating: place.totalScore,
        reviews_count: place.reviewsCount,
        latitude: placeLat,
        longitude: placeLng,
        distance_miles: distanceMiles,
        is_directory: false,
        discovery_source: 'google_places',
        status: 'approved',
        scrape_status: 'pending',
        is_selected: false, // Will be set below
        location_data: {
          address: place.address,
          phone: place.phone,
          rating: place.totalScore,
          reviewsCount: place.reviewsCount,
          openingHours: place.openingHours,
          placeId: place.placeId,
          lat: placeLat,
          lng: placeLng,
          categoryName: categoryName,
        },
        match_reason: relevance.reason,
        relevance_score: relevance.score,
        validation_status: 'pending',
      });
    }

    console.log('[handle-discovery-complete] After filtering:', validCompetitors.length, 
      'valid,', filteredOut.length, 'filtered out');
    
    // Log some filtered examples for debugging
    const sampleFiltered = filteredOut.slice(0, 5);
    console.log('[handle-discovery-complete] Sample filtered:', sampleFiltered);

    // =========================================
    // STEP 6: Sort by distance (closest first), then by relevance
    // =========================================
    
    validCompetitors.sort((a, b) => {
      // Primary sort: distance (closest first)
      const distanceDiff = a.distance_miles - b.distance_miles;
      if (Math.abs(distanceDiff) > 0.5) {
        return distanceDiff;
      }
      // Secondary sort: relevance score (highest first)
      return (b.relevance_score || 0) - (a.relevance_score || 0);
    });

    // =========================================
    // STEP 7: Auto-select the top N closest competitors
    // =========================================
    
    validCompetitors.forEach((comp, index) => {
      comp.is_selected = index < maxCompetitors;
    });

    const selectedCount = validCompetitors.filter(c => c.is_selected).length;
    
    console.log('[handle-discovery-complete] Selection summary:',
      'Total valid:', validCompetitors.length,
      'Selected:', selectedCount,
      'Max allowed:', maxCompetitors);
    
    if (validCompetitors.length > 0) {
      const closest = validCompetitors[0];
      const farthestSelected = validCompetitors.filter(c => c.is_selected).pop();
      console.log('[handle-discovery-complete] Closest:', closest.business_name, 
        'at', closest.distance_miles, 'mi, score:', closest.relevance_score);
      if (farthestSelected) {
        console.log('[handle-discovery-complete] Farthest selected:', farthestSelected.business_name,
          'at', farthestSelected.distance_miles, 'mi');
      }
    }

    // =========================================
    // STEP 8: Save to database (upsert by workspace + url)
    // =========================================
    
    let insertedCount = 0;
    let updatedCount = 0;
    
    if (validCompetitors.length > 0) {
      for (const comp of validCompetitors) {
        const { data: existing } = await supabase
          .from('competitor_sites')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('url', comp.url)
          .maybeSingle();
        
        if (existing) {
          const { error: updateError } = await supabase
            .from('competitor_sites')
            .update({
              job_id: jobId,
              distance_miles: comp.distance_miles,
              status: 'approved',
              scrape_status: 'pending',
              is_selected: comp.is_selected,
              location_data: comp.location_data,
              match_reason: comp.match_reason,
              relevance_score: comp.relevance_score,
              validation_status: 'pending',
              discovered_at: new Date().toISOString()
            })
            .eq('id', existing.id);
          
          if (!updateError) updatedCount++;
        } else {
          const { error: insertError } = await supabase
            .from('competitor_sites')
            .insert(comp);
          
          if (!insertError) insertedCount++;
        }
      }
      
      console.log('[handle-discovery-complete] Database: Inserted', insertedCount, 'Updated', updatedCount);
    }

    // =========================================
    // STEP 9: Update job status to review_ready
    // =========================================
    
    await supabase.from('competitor_research_jobs').update({
      sites_discovered: places.length,
      sites_filtered: validCompetitors.length,
      sites_validated: validCompetitors.length,
      sites_approved: selectedCount,
      status: validCompetitors.length > 0 ? 'review_ready' : 'completed',
      heartbeat_at: new Date().toISOString(),
      ...(validCompetitors.length === 0 ? {
        completed_at: new Date().toISOString(),
        error_message: `No valid ${industry} businesses found within ${radiusMiles} miles after filtering`
      } : {})
    }).eq('id', jobId);

    console.log('[handle-discovery-complete] Job updated to review_ready');

    return new Response(JSON.stringify({
      success: true,
      placesFound: places.length,
      validCompetitors: validCompetitors.length,
      selected: selectedCount,
      filteredOut: filteredOut.length,
      status: 'review_ready'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[handle-discovery-complete] Error:', error)
    
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
