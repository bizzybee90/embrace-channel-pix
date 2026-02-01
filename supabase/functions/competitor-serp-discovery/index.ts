import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withApifyAdHocWebhooks } from "../_shared/apifyWebhooks.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * competitor-serp-discovery
 * 
 * Uses Google SERP scraping instead of Google Places for competitor discovery.
 * This approach finds businesses that ACTIVELY TARGET a location via SEO,
 * rather than businesses that just happen to be near coordinates.
 * 
 * Key benefits:
 * - Simulates real customer searches ("window cleaning luton")
 * - Respects local SEO optimization
 * - Returns businesses marketing to that area
 * - No coordinate bias toward city centers
 */

// Generate location-specific search queries - MORE VARIATIONS for better coverage
function generateSearchQueries(industry: string, location: string): string[] {
  const queries: string[] = [];
  
  // Clean up location - remove country suffix if present
  const cleanLocation = location
    .replace(/,?\s*(UK|United Kingdom|England|Scotland|Wales)$/i, '')
    .trim();
  
  // Extract city/town name (first part before comma)
  const primaryLocation = cleanLocation.split(',')[0].trim();
  
  // Core search patterns (most valuable) - these match how customers actually search
  queries.push(`${industry} ${primaryLocation}`);
  queries.push(`${industry} in ${primaryLocation}`);
  queries.push(`best ${industry} ${primaryLocation}`);
  queries.push(`${industry} services ${primaryLocation}`);
  
  // Singular/plural variations
  const industryLower = industry.toLowerCase();
  if (industryLower.includes('cleaning')) {
    // "window cleaning" -> "window cleaner" and "window cleaners"
    const singular = industry.replace(/cleaning/i, 'cleaner');
    const plural = industry.replace(/cleaning/i, 'cleaners');
    queries.push(`${singular} ${primaryLocation}`);
    queries.push(`${plural} ${primaryLocation}`);
    queries.push(`local ${singular} ${primaryLocation}`);
  } else if (industryLower.endsWith('er')) {
    // "window cleaner" -> "window cleaning"
    const gerund = industry.replace(/er$/i, 'ing');
    queries.push(`${gerund} ${primaryLocation}`);
  }
  
  // Add nearby towns if we can guess (for broader coverage)
  queries.push(`${industry} near ${primaryLocation}`);
  queries.push(`${industry} ${primaryLocation} area`);
  
  // Deduplicate and return more queries for better coverage
  return [...new Set(queries)].slice(0, 8);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      workspaceId, 
      industry, 
      location,
      maxCompetitors = 50 
    } = await req.json();
    
    if (!workspaceId || !industry) {
      return new Response(JSON.stringify({ error: 'Missing required fields: workspaceId, industry' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const searchLocation = location || 'UK';
    console.log('[serp-discovery] Starting:', { workspaceId, industry, location: searchLocation, maxCompetitors });

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

    // Generate search queries
    const searchQueries = generateSearchQueries(industry, searchLocation);
    console.log('[serp-discovery] Search queries:', searchQueries);

    // =========================================
    // STEP 1: Create job record
    // =========================================
    
    const { data: job, error: jobError } = await supabase
      .from('competitor_research_jobs')
      .insert({
        workspace_id: workspaceId,
        niche_query: industry,
        industry,
        location: searchLocation,
        service_area: searchLocation,
        max_competitors: maxCompetitors,
        status: 'discovering',
        search_queries: searchQueries,
        started_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (jobError || !job) {
      console.error('[serp-discovery] Job creation error:', jobError);
      return new Response(JSON.stringify({ error: 'Failed to create job' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[serp-discovery] Created job:', job.id);

    // =========================================
    // STEP 2: Configure Apify Google Search Scraper
    // =========================================
    
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    const webhookUrl = `${SUPABASE_URL}/functions/v1/competitor-webhooks?apikey=${SUPABASE_ANON_KEY}`;
    
    // Apify Google Search Scraper configuration
    // Using more pages to get better coverage of organic results
    const apifyInput = {
      queries: searchQueries.join('\n'),
      countryCode: "gb",
      languageCode: "en",
      resultsPerPage: 100, // Max per page
      maxPagesPerQuery: 5, // More pages = more results (5 pages * 10 results = ~50 per query)
      mobileResults: false, // Desktop results have more organic listings
      includeUnfilteredResults: true, // Include all organic results
      saveHtml: false, // Don't need HTML, saves bandwidth
      saveHtmlToKeyValueStore: false,
    };
    
    console.log('[serp-discovery] Apify config:', {
      queries: searchQueries,
      countryCode: 'gb',
      resultsPerPage: 100,
      maxPagesPerQuery: 2
    });

    // Webhook definition for Apify
    const webhookDefs = [
      {
        eventTypes: ['ACTOR.RUN.SUCCEEDED'],
        requestUrl: webhookUrl,
        shouldInterpolateStrings: true,
        payloadTemplate: JSON.stringify({
          type: 'serp_discovery',
          jobId: job.id,
          workspaceId,
          industry,
          location: searchLocation,
          maxCompetitors,
          runId: '{{resource.id}}',
          datasetId: '{{resource.defaultDatasetId}}',
        }),
      },
    ];

    const apifyRunUrl = withApifyAdHocWebhooks(
      `https://api.apify.com/v2/acts/apify~google-search-scraper/runs?token=${APIFY_API_KEY}`,
      webhookDefs,
    );
    
    const apifyResponse = await fetch(apifyRunUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apifyInput),
    });
    
    if (!apifyResponse.ok) {
      const errorText = await apifyResponse.text();
      console.error('[serp-discovery] Apify error:', errorText);
      
      await supabase.from('competitor_research_jobs').update({
        status: 'failed',
        error_message: `Apify API error: ${apifyResponse.status}`
      }).eq('id', job.id);
      
      return new Response(JSON.stringify({ error: `Apify API error: ${errorText}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const apifyData = await apifyResponse.json();
    console.log('[serp-discovery] Apify run started:', apifyData.data?.id);

    // Update job with Apify run ID
    await supabase.from('competitor_research_jobs').update({
      discovery_run_id: apifyData.data.id,
      heartbeat_at: new Date().toISOString()
    }).eq('id', job.id);

    return new Response(JSON.stringify({
      success: true,
      jobId: job.id,
      status: 'discovering',
      message: 'SERP discovery started. Searching for businesses targeting your location.',
      searchQueries
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[serp-discovery] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
