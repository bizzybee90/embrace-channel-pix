import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    const { jobId, workspaceId, runId, datasetId } = payload
    
    console.log('[handle-discovery-complete] Received webhook:', { jobId, workspaceId, datasetId })
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

    if (!APIFY_API_KEY) {
      throw new Error('APIFY_API_KEY not configured')
    }

    // Update job status
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
      
      validCompetitors.push({
        job_id: jobId,
        workspace_id: workspaceId,
        business_name: place.title || place.name,
        url: websiteUrl,
        domain: hostname,
        place_id: place.placeId,
        phone: place.phone,
        address: place.address,
        rating: place.totalScore,
        reviews_count: place.reviewsCount,
        is_directory: false,
        discovery_source: 'google_places',
        status: 'approved',
        scrape_status: 'pending'
      })
    }

    console.log('[handle-discovery-complete] Valid competitors:', validCompetitors.length, 'Filtered:', filteredOut.length)

    // =========================================
    // STEP 4: Store competitors in database
    // Use UPSERT with correct conflict column (workspace_id, url)
    // This allows sites to be "adopted" by new jobs
    // =========================================
    
    let insertedCount = 0;
    let updatedCount = 0;
    
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

    // Update job counts
    await supabase.from('competitor_research_jobs').update({
      sites_discovered: places.length,
      sites_filtered: validCompetitors.length,
      status: validCompetitors.length > 0 ? 'scraping' : 'completed',
      heartbeat_at: new Date().toISOString(),
      ...(validCompetitors.length === 0 ? {
        completed_at: new Date().toISOString(),
        error_message: 'No valid competitor websites found after filtering'
      } : {})
    }).eq('id', jobId)

    // =========================================
    // STEP 5: Trigger website scraping
    // =========================================
    
    if (validCompetitors.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No valid competitors found' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // CRITICAL: Include apikey in the webhook URL so Apify can authenticate
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    const webhookUrl = `${SUPABASE_URL}/functions/v1/handle-scrape-complete?apikey=${SUPABASE_ANON_KEY}`;
    console.log('[handle-discovery-complete] Scrape webhook URL configured');
    const startUrls = validCompetitors.slice(0, 50).map(c => ({ url: c.url }))
    
    const scrapeInput = {
      startUrls,
      maxCrawlDepth: 0,  // Homepage only - CRITICAL for budget
      maxCrawlPages: validCompetitors.length,
      saveHtml: false,
      saveMarkdown: true,
      removeCookieWarnings: true,
      clickElementsCssSelector: null
    }
    
    const scrapeResponse = await fetch(
      `https://api.apify.com/v2/acts/apify~website-content-crawler/runs?token=${APIFY_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...scrapeInput,
          webhooks: [
            {
              eventTypes: ['ACTOR.RUN.SUCCEEDED'],
              requestUrl: webhookUrl,
              payloadTemplate: JSON.stringify({
                jobId,
                workspaceId,
                runId: '{{runId}}',
                datasetId: '{{defaultDatasetId}}'
              })
            }
          ]
        })
      }
    )
    
    if (!scrapeResponse.ok) {
      const errorText = await scrapeResponse.text()
      console.error('[handle-discovery-complete] Scrape API error:', errorText)
      throw new Error(`Apify scrape API error: ${errorText}`)
    }
    
    const scrapeData = await scrapeResponse.json()
    console.log('[handle-discovery-complete] Scrape started:', scrapeData.data?.id)

    // Update job with scrape run ID
    await supabase.from('competitor_research_jobs').update({
      scrape_run_id: scrapeData.data.id
    }).eq('id', jobId)

    return new Response(JSON.stringify({
      success: true,
      placesFound: places.length,
      validCompetitors: validCompetitors.length,
      filteredOut: filteredOut.length,
      scrapingStarted: true
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
