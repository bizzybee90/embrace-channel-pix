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
// INDUSTRY-SPECIFIC "ANTI-REPAIR" BLOCKLISTS
// These filter out wrong-industry results based on Google category
// =========================================
function getBlocklistForIndustry(industry: string): string[] {
  const industryLower = industry.toLowerCase();
  
  // Base blocklist for all service businesses
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
  
  // WINDOW CLEANING specific blocklist (Anti-Repair)
  if (industryLower.includes('window') && industryLower.includes('clean')) {
    return [
      ...baseBlocklist,
      // Anti-Repair: Block repair/installation related
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
      'blinds', 'curtains', 'shutters',
    ];
  }
  
  // CLEANING (general) blocklist
  if (industryLower.includes('clean') && !industryLower.includes('window')) {
    return [
      ...baseBlocklist,
      'laundry', 'laundrette', 'dry cleaner',
      'car wash', 'valeting', 'valet',
      'waste', 'skip hire', 'rubbish',
      'pest control',
    ];
  }
  
  // PLUMBING blocklist
  if (industryLower.includes('plumb')) {
    return [
      ...baseBlocklist,
      'heating engineer', 'boiler', 'gas engineer',
      'electrician', 'electrical',
      'drainage', 'drain', 'sewer',
      'bathroom showroom', 'kitchen showroom',
      'tile', 'tiling', 'flooring',
    ];
  }
  
  // GARDENING/LANDSCAPING blocklist
  if (industryLower.includes('garden') || industryLower.includes('landscap')) {
    return [
      ...baseBlocklist,
      'garden centre', 'plant nursery',
      'florist', 'flower shop',
      'tree surgeon', 'arborist',
      'fencing', 'fence',
      'paving', 'patio', 'decking',
    ];
  }
  
  return baseBlocklist;
}

// Check if category matches blocklist
function isCategoryBlocked(categoryName: string | undefined, blocklist: string[]): boolean {
  if (!categoryName) return false;
  const categoryLower = categoryName.toLowerCase();
  return blocklist.some(term => categoryLower.includes(term));
}

// Check if business name matches blocklist
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
  
  const industryWords = industryLower.split(/\s+/).filter(w => w.length > 3);
  
  const nameMatches = industryWords.filter(word => name.includes(word)).length;
  const categoryMatches = industryWords.filter(word => categoryLower.includes(word)).length;
  
  if (nameMatches >= 2 || (nameMatches >= 1 && categoryMatches >= 1)) {
    return { score: 100, reason: industry };
  }
  
  if (nameMatches >= 1) {
    return { score: 85, reason: industry };
  }
  
  if (categoryMatches >= 1) {
    return { score: 70, reason: `Category: ${category}` };
  }
  
  return { score: 50, reason: 'Related service' };
}

// =========================================
// EXPANDED DIRECTORY BLOCKLIST
// These domains are directories, not actual businesses
// =========================================
const DIRECTORY_BLOCKLIST = new Set([
  // UK Business Directories
  'yell.com', 'checkatrade.com', 'bark.com', 'rated-people.com',
  'trustatrader.com', 'mybuilder.com', 'which.co.uk',
  'freeindex.co.uk', 'cylex.co.uk', 'yelp.com', 'yelp.co.uk',
  '192.com', 'thebestof.co.uk', 'thomsonlocal.com',
  'scoot.co.uk', 'hotfrog.co.uk', 'businessmagnet.co.uk',
  'misterwhat.co.uk', 'locanto.co.uk', 'gumtree.com',
  'localservices.amazon.co.uk', 'amazon.co.uk',
  // Social Media
  'facebook.com', 'nextdoor.com', 'nextdoor.co.uk',
  'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
  'tiktok.com', 'youtube.com', 'pinterest.com',
  // Review & Aggregator Sites
  'trustpilot.com', 'reviews.io', 'google.com', 'google.co.uk',
  'tripadvisor.com', 'tripadvisor.co.uk',
  // Job & Service Platforms
  'indeed.com', 'indeed.co.uk', 'reed.co.uk', 'totaljobs.com',
  'airtasker.com', 'taskrabbit.com', 'fiverr.com', 'upwork.com',
  // Generic directories
  'bizify.co.uk', 'yellbo.co.uk', 'brownbook.net',
  'opendi.co.uk', 'misterwhat.co.uk', 'tipped.co.uk',
  'smartguy.com', 'citylocal.co.uk', 'fyple.co.uk',
  'streetmapof.co.uk', 'lacartes.com', 'uksmallbusinessdirectory.co.uk',
  'hub.co.uk', 'applegate.co.uk', 'approved-business.co.uk',
  'locallife.co.uk', 'theukbd.co.uk', 'britaine.co.uk',
  // Wikipedia and knowledge bases
  'wikipedia.org', 'wikihow.com',
]);

function isDomainBlocked(hostname: string): boolean {
  const domain = hostname.replace(/^www\./, '').toLowerCase();
  
  // Check exact match
  if (DIRECTORY_BLOCKLIST.has(domain)) return true;
  
  // Check if it's a subdomain of a blocked domain
  for (const blocked of DIRECTORY_BLOCKLIST) {
    if (domain.endsWith('.' + blocked)) return true;
  }
  
  return false;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const webhookType = payload?.type;

    console.log('[competitor-webhooks] Received:', { type: webhookType, jobId: payload?.jobId });

    if (webhookType === 'discovery') {
      return await handleDiscoveryWebhook(payload);
    }

    if (webhookType === 'serp_discovery') {
      return await handleSerpDiscoveryWebhook(payload);
    }

    // Future: handle 'scrape' type webhooks here
    
    return new Response(JSON.stringify({ error: 'Unknown webhook type' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('[competitor-webhooks] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function handleDiscoveryWebhook(payload: any) {
  const {
    jobId,
    workspaceId,
    originLat,
    originLon,
    radiusMiles,
    maxCompetitors,
    industry,
    datasetId,
  } = payload;

  // Also check resource object for Apify interpolation
  const rawDatasetId = datasetId;
  const resourceDatasetId = payload?.resource?.defaultDatasetId;
  const finalDatasetId = (typeof rawDatasetId === 'string' && !rawDatasetId.includes('{{'))
    ? rawDatasetId
    : (typeof resourceDatasetId === 'string' ? resourceDatasetId : undefined);

  console.log('[discovery-webhook] Processing:', { jobId, workspaceId, datasetId: finalDatasetId });

  if (!jobId || !workspaceId || !finalDatasetId) {
    throw new Error('Missing required fields: jobId, workspaceId, datasetId');
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  
  const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');

  if (!APIFY_API_KEY) {
    throw new Error('APIFY_API_KEY not configured');
  }

  // Update job status
  await supabase.from('competitor_research_jobs').update({
    status: 'filtering',
    heartbeat_at: new Date().toISOString()
  }).eq('id', jobId);

  // =========================================
  // STEP 1: Fetch raw results from Apify dataset
  // =========================================
  
  const datasetResponse = await fetch(
    `https://api.apify.com/v2/datasets/${finalDatasetId}/items?token=${APIFY_API_KEY}`
  );
  
  if (!datasetResponse.ok) {
    throw new Error(`Failed to fetch dataset: ${datasetResponse.status}`);
  }
  
  const places = await datasetResponse.json();
  console.log('[discovery-webhook] Raw places from Apify:', places.length);

  // =========================================
  // STEP 2: Get blocklists
  // =========================================
  
  const industryBlocklist = getBlocklistForIndustry(industry || '');
  console.log('[discovery-webhook] Industry blocklist terms:', industryBlocklist.length);

  const { data: dbBlocklist } = await supabase
    .from('directory_blocklist')
    .select('domain');
  
  const blockedDomains = new Set(dbBlocklist?.map(b => b.domain.toLowerCase()) || []);

  // =========================================
  // STEP 3: Filter and score each result
  // =========================================
  
  const validCompetitors: any[] = [];
  const filteredOut: { name: string; reason: string }[] = [];
  
  // Use origin from payload or fall back to job data
  const centerLat = originLat || 51.5074; // London fallback
  const centerLon = originLon || -0.1278;
  const maxRadius = radiusMiles || 20;
  
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
    
    // FILTER 2: Must have coordinates
    if (!placeLat || !placeLng) {
      filteredOut.push({ name: businessName, reason: 'no_coordinates' });
      continue;
    }
    
    // FILTER 3: Check category against Anti-Repair blocklist
    if (isCategoryBlocked(categoryName, industryBlocklist)) {
      filteredOut.push({ name: businessName, reason: `blocked_category: ${categoryName}` });
      continue;
    }
    
    // FILTER 4: Check business name against blocklist
    if (isNameBlocked(businessName, industryBlocklist)) {
      filteredOut.push({ name: businessName, reason: 'blocked_name' });
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
    
    // CALCULATE: Distance using Haversine formula
    const distanceMiles = getDistanceFromLatLonInMiles(centerLat, centerLon, placeLat, placeLng);
    
    // FILTER 7: Must be within radius
    if (distanceMiles > maxRadius) {
      filteredOut.push({ name: businessName, reason: `too_far: ${distanceMiles}mi > ${maxRadius}mi` });
      continue;
    }
    
    // SCORE: Calculate relevance
    const relevance = scoreRelevance(businessName, categoryName, industry || '');
    
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
      is_selected: false, // Will be set after sorting
      location_data: {
        address: place.address,
        phone: place.phone,
        rating: place.totalScore,
        reviewsCount: place.reviewsCount,
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

  console.log('[discovery-webhook] After filtering:', validCompetitors.length, 'valid,', filteredOut.length, 'filtered');
  
  // Log sample filtered for debugging
  const sampleFiltered = filteredOut.slice(0, 10);
  console.log('[discovery-webhook] Sample filtered:', sampleFiltered);

  // =========================================
  // STEP 4: Sort by DISTANCE first (closest first), then relevance
  // =========================================
  
  validCompetitors.sort((a, b) => {
    // Primary: distance (closest first)
    const distanceDiff = a.distance_miles - b.distance_miles;
    if (Math.abs(distanceDiff) > 0.1) {
      return distanceDiff;
    }
    // Secondary: relevance (highest first)
    return (b.relevance_score || 0) - (a.relevance_score || 0);
  });

  // =========================================
  // STEP 5: Auto-select the top N closest
  // =========================================
  
  const targetCount = maxCompetitors || 50;
  validCompetitors.forEach((comp, index) => {
    comp.is_selected = index < targetCount;
  });

  const selectedCount = validCompetitors.filter(c => c.is_selected).length;
  
  console.log('[discovery-webhook] Selection summary:',
    'Total valid:', validCompetitors.length,
    'Selected:', selectedCount,
    'Target:', targetCount);
  
  if (validCompetitors.length > 0) {
    console.log('[discovery-webhook] Closest:', validCompetitors[0].business_name, 
      'at', validCompetitors[0].distance_miles, 'mi');
    const farthestSelected = validCompetitors.filter(c => c.is_selected).pop();
    if (farthestSelected) {
      console.log('[discovery-webhook] Farthest selected:', farthestSelected.business_name,
        'at', farthestSelected.distance_miles, 'mi');
    }
  }

  // =========================================
  // STEP 6: Save to database (upsert by workspace + url)
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
    
    console.log('[discovery-webhook] Database: Inserted', insertedCount, 'Updated', updatedCount);
  }

  // =========================================
  // STEP 7: Update job status to review_ready
  // =========================================
  
  await supabase.from('competitor_research_jobs').update({
    sites_discovered: places.length,
    sites_filtered: validCompetitors.length,
    sites_approved: selectedCount,
    status: 'review_ready',
    heartbeat_at: new Date().toISOString()
  }).eq('id', jobId);

  console.log('[discovery-webhook] Complete. Job', jobId, 'is now review_ready');

  return new Response(JSON.stringify({ 
    success: true,
    discovered: places.length,
    filtered: validCompetitors.length,
    selected: selectedCount,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// =========================================
// SERP DISCOVERY WEBHOOK HANDLER
// Processes Google Search results instead of Places
// =========================================
async function handleSerpDiscoveryWebhook(payload: any) {
  const {
    jobId,
    workspaceId,
    industry,
    location,
    maxCompetitors,
    datasetId,
  } = payload;

  // Handle Apify interpolation
  const rawDatasetId = datasetId;
  const resourceDatasetId = payload?.resource?.defaultDatasetId;
  const finalDatasetId = (typeof rawDatasetId === 'string' && !rawDatasetId.includes('{{'))
    ? rawDatasetId
    : (typeof resourceDatasetId === 'string' ? resourceDatasetId : undefined);

  console.log('[serp-webhook] Processing:', { jobId, workspaceId, datasetId: finalDatasetId });

  if (!jobId || !workspaceId || !finalDatasetId) {
    throw new Error('Missing required fields: jobId, workspaceId, datasetId');
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  
  const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');

  if (!APIFY_API_KEY) {
    throw new Error('APIFY_API_KEY not configured');
  }

  // Update job status
  await supabase.from('competitor_research_jobs').update({
    status: 'filtering',
    heartbeat_at: new Date().toISOString()
  }).eq('id', jobId);

  // =========================================
  // STEP 1: Fetch raw results from Apify dataset
  // =========================================
  
  const datasetResponse = await fetch(
    `https://api.apify.com/v2/datasets/${finalDatasetId}/items?token=${APIFY_API_KEY}`
  );
  
  if (!datasetResponse.ok) {
    throw new Error(`Failed to fetch dataset: ${datasetResponse.status}`);
  }
  
  const serpResults = await datasetResponse.json();
  console.log('[serp-webhook] Raw SERP results:', serpResults.length);

  // =========================================
  // STEP 2: Extract and deduplicate organic results
  // =========================================
  
  const seenDomains = new Set<string>();
  const validCompetitors: any[] = [];
  const filteredOut: { url: string; reason: string }[] = [];
  
  // Get industry blocklist for name filtering
  const industryBlocklist = getBlocklistForIndustry(industry || '');

  for (const result of serpResults) {
    // Handle both flat results and nested organicResults
    const organicResults = result.organicResults || [result];
    
    for (const organic of organicResults) {
      const url = organic.url || organic.link;
      const title = organic.title || '';
      const description = organic.description || organic.snippet || '';
      const position = organic.position || organic.rank || 0;
      
      if (!url) continue;
      
      // Skip ads
      if (organic.isAd || organic.type === 'ad') {
        filteredOut.push({ url, reason: 'ad' });
        continue;
      }
      
      // Parse URL
      let hostname: string;
      try {
        hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        filteredOut.push({ url, reason: 'invalid_url' });
        continue;
      }
      
      // Skip directories
      if (isDomainBlocked(hostname)) {
        filteredOut.push({ url, reason: 'directory' });
        continue;
      }
      
      // Skip duplicates (first occurrence wins = higher SERP position)
      if (seenDomains.has(hostname)) {
        filteredOut.push({ url, reason: 'duplicate' });
        continue;
      }
      
      // Skip if name/title matches industry blocklist
      if (isNameBlocked(title, industryBlocklist)) {
        filteredOut.push({ url, reason: 'blocked_title' });
        continue;
      }
      
      seenDomains.add(hostname);
      
      // Calculate relevance based on SERP position
      // Position 1-10 = page 1 = highly relevant
      const relevanceScore = Math.max(100 - (position * 2), 20);
      
      validCompetitors.push({
        job_id: jobId,
        workspace_id: workspaceId,
        business_name: title,
        url: url,
        domain: hostname,
        description: description,
        discovery_source: 'google_serp',
        discovery_query: result.searchQuery?.term || location,
        status: 'approved',
        scrape_status: 'pending',
        is_selected: false, // Will be set after sorting
        match_reason: `SERP position ${position} for "${result.searchQuery?.term || industry}"`,
        relevance_score: relevanceScore,
        validation_status: 'pending',
        location_data: {
          serpPosition: position,
          searchQuery: result.searchQuery?.term,
          snippet: description,
        }
      });
    }
  }

  console.log('[serp-webhook] After filtering:', validCompetitors.length, 'valid,', filteredOut.length, 'filtered');
  
  // Log sample filtered for debugging
  const sampleFiltered = filteredOut.slice(0, 10);
  console.log('[serp-webhook] Sample filtered:', sampleFiltered);

  // =========================================
  // STEP 3: Sort by relevance (SERP position = best indicator)
  // =========================================
  
  validCompetitors.sort((a, b) => {
    // Higher relevance score = higher SERP position = better
    return (b.relevance_score || 0) - (a.relevance_score || 0);
  });

  // =========================================
  // STEP 4: Auto-select the top N most relevant
  // =========================================
  
  const targetCount = maxCompetitors || 50;
  validCompetitors.forEach((comp, index) => {
    comp.is_selected = index < targetCount;
  });

  const selectedCount = validCompetitors.filter(c => c.is_selected).length;
  
  console.log('[serp-webhook] Selection summary:',
    'Total valid:', validCompetitors.length,
    'Selected:', selectedCount,
    'Target:', targetCount);
  
  if (validCompetitors.length > 0) {
    console.log('[serp-webhook] Top result:', validCompetitors[0].business_name, 
      'at position', validCompetitors[0].location_data?.serpPosition);
  }

  // =========================================
  // STEP 5: Save to database (upsert by workspace + domain)
  // =========================================
  
  let insertedCount = 0;
  let updatedCount = 0;
  
  if (validCompetitors.length > 0) {
    for (const comp of validCompetitors) {
      const { data: existing } = await supabase
        .from('competitor_sites')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('domain', comp.domain)
        .maybeSingle();
      
      if (existing) {
        const { error: updateError } = await supabase
          .from('competitor_sites')
          .update({
            job_id: jobId,
            url: comp.url,
            business_name: comp.business_name,
            description: comp.description,
            status: 'approved',
            scrape_status: 'pending',
            is_selected: comp.is_selected,
            location_data: comp.location_data,
            match_reason: comp.match_reason,
            relevance_score: comp.relevance_score,
            discovery_source: 'google_serp',
            discovery_query: comp.discovery_query,
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
    
    console.log('[serp-webhook] Database: Inserted', insertedCount, 'Updated', updatedCount);
  }

  // =========================================
  // STEP 6: Update job status to review_ready
  // =========================================
  
  const totalOrganicResults = serpResults.reduce((sum: number, r: any) => {
    return sum + (r.organicResults?.length || 1);
  }, 0);
  
  await supabase.from('competitor_research_jobs').update({
    sites_discovered: totalOrganicResults,
    sites_filtered: validCompetitors.length,
    sites_approved: selectedCount,
    status: 'review_ready',
    heartbeat_at: new Date().toISOString()
  }).eq('id', jobId);

  console.log('[serp-webhook] Complete. Job', jobId, 'is now review_ready');

  return new Response(JSON.stringify({ 
    success: true,
    discovered: totalOrganicResults,
    filtered: validCompetitors.length,
    selected: selectedCount,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
