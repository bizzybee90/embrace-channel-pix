import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Recovery function for stalled competitor research jobs.
 * 
 * This handles cases where:
 * 1. The Apify webhook never fired (network issues, timeout, etc.)
 * 2. The extraction phase got stuck with 0 pages
 * 3. The job needs to be manually recovered
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { jobId, workspaceId } = await req.json()
    
    if (!jobId) {
      return new Response(JSON.stringify({ error: 'jobId is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('[recover-competitor-job] Starting recovery for job:', jobId)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY')
    if (!APIFY_API_KEY) {
      throw new Error('APIFY_API_KEY not configured')
    }

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('competitor_research_jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: 'Job not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const effectiveWorkspaceId = workspaceId || job.workspace_id

    // Update job to show recovery in progress
    await supabase.from('competitor_research_jobs').update({
      heartbeat_at: new Date().toISOString(),
      error_message: 'Recovery in progress...'
    }).eq('id', jobId)

    // Check if we have a scrape_run_id to recover from
    if (!job.scrape_run_id) {
      // No scrape was started - check if we have sites to scrape
      const { count: pendingSites } = await supabase
        .from('competitor_sites')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId)
        .eq('is_selected', true)

      if (pendingSites && pendingSites > 0) {
        // Restart the scrape
        console.log('[recover-competitor-job] No scrape_run_id, restarting scrape for', pendingSites, 'sites')
        
        // Reset scrape status
        await supabase
          .from('competitor_sites')
          .update({ scrape_status: 'pending' })
          .eq('job_id', jobId)
          .eq('is_selected', true)

        // Trigger scrape start
        const { error: invokeError } = await supabase.functions.invoke('competitor-scrape-start', {
          body: { jobId, workspaceId: effectiveWorkspaceId }
        })

        if (invokeError) {
          throw new Error(`Failed to restart scrape: ${invokeError.message}`)
        }

        return new Response(JSON.stringify({
          success: true,
          action: 'scrape_restarted',
          message: `Restarted scraping for ${pendingSites} sites`
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      } else {
        await supabase.from('competitor_research_jobs').update({
          status: 'failed',
          error_message: 'No sites selected for scraping. Please go back and select competitors.'
        }).eq('id', jobId)

        return new Response(JSON.stringify({
          success: false,
          error: 'No sites to scrape'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // We have a scrape_run_id - check Apify run status
    console.log('[recover-competitor-job] Checking Apify run:', job.scrape_run_id)

    const runResponse = await fetch(
      `https://api.apify.com/v2/actor-runs/${job.scrape_run_id}?token=${APIFY_API_KEY}`
    )

    if (!runResponse.ok) {
      throw new Error(`Failed to fetch Apify run: ${runResponse.status}`)
    }

    const runData = await runResponse.json()
    const runStatus = runData.data?.status

    console.log('[recover-competitor-job] Apify run status:', runStatus)

    if (runStatus === 'RUNNING' || runStatus === 'READY') {
      // Still running - just wait
      await supabase.from('competitor_research_jobs').update({
        status: 'scraping',
        heartbeat_at: new Date().toISOString(),
        error_message: null
      }).eq('id', jobId)

      return new Response(JSON.stringify({
        success: true,
        action: 'still_running',
        message: 'Apify scrape is still running. Please wait.'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (runStatus !== 'SUCCEEDED') {
      // Scrape failed
      await supabase.from('competitor_research_jobs').update({
        status: 'failed',
        error_message: `Apify scrape failed with status: ${runStatus}`
      }).eq('id', jobId)

      return new Response(JSON.stringify({
        success: false,
        error: `Scrape failed: ${runStatus}`,
        apifyStatus: runStatus
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Scrape succeeded - fetch the dataset
    const datasetId = runData.data?.defaultDatasetId
    if (!datasetId) {
      throw new Error('No dataset ID found in Apify run')
    }

    console.log('[recover-competitor-job] Fetching dataset:', datasetId)

    const datasetResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
    )

    if (!datasetResponse.ok) {
      throw new Error(`Failed to fetch dataset: ${datasetResponse.status}`)
    }

    const scrapedPages = await datasetResponse.json()
    console.log('[recover-competitor-job] Fetched pages:', scrapedPages.length)

    if (scrapedPages.length === 0) {
      await supabase.from('competitor_research_jobs').update({
        status: 'failed',
        error_message: 'Apify returned 0 pages. The websites may be blocking scrapers.'
      }).eq('id', jobId)

      return new Response(JSON.stringify({
        success: false,
        error: 'No pages scraped'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get site domain mapping
    const { data: jobSites } = await supabase
      .from('competitor_sites')
      .select('id, domain')
      .eq('job_id', jobId)

    const domainToSiteId = new Map<string, string>()
    if (jobSites) {
      for (const site of jobSites) {
        domainToSiteId.set(site.domain.toLowerCase(), site.id)
      }
    }

    // Clear any existing pages for this job to avoid duplicates
    const { data: existingSites } = await supabase
      .from('competitor_sites')
      .select('id')
      .eq('job_id', jobId)

    if (existingSites && existingSites.length > 0) {
      const siteIds = existingSites.map(s => s.id)
      await supabase
        .from('competitor_pages')
        .delete()
        .in('site_id', siteIds)
      console.log('[recover-competitor-job] Cleared existing pages for', siteIds.length, 'sites')
    }

    // Insert scraped pages
    const pageInserts = scrapedPages.map((page: any) => {
      let domain = ''
      try {
        domain = new URL(page.url).hostname.replace(/^www\./, '').toLowerCase()
      } catch {
        domain = page.url
      }

      const siteId = domainToSiteId.get(domain) || null

      let pageType = 'general'
      const urlLower = page.url.toLowerCase()
      if (urlLower.includes('faq') || urlLower.includes('frequently')) pageType = 'faq'
      else if (urlLower.includes('pricing') || urlLower.includes('price')) pageType = 'pricing'
      else if (urlLower.includes('service')) pageType = 'services'

      return {
        site_id: siteId,
        workspace_id: effectiveWorkspaceId,
        url: page.url,
        title: page.metadata?.title || page.title,
        content: page.markdown || page.text,
        word_count: (page.markdown || page.text || '').split(/\s+/).length,
        page_type: pageType,
        scraped_at: new Date().toISOString(),
        faqs_extracted: false
      }
    }).filter((p: any) => p.site_id !== null)

    console.log('[recover-competitor-job] Inserting', pageInserts.length, 'pages')

    if (pageInserts.length > 0) {
      const BATCH_SIZE = 50
      for (let i = 0; i < pageInserts.length; i += BATCH_SIZE) {
        const batch = pageInserts.slice(i, i + BATCH_SIZE)
        const { error: insertError } = await supabase
          .from('competitor_pages')
          .insert(batch)

        if (insertError) {
          console.error('[recover-competitor-job] Insert error:', insertError)
        }
      }
    }

    // Update job and site statuses
    await supabase.from('competitor_research_jobs').update({
      status: 'extracting',
      sites_scraped: scrapedPages.length,
      pages_scraped: pageInserts.length,
      heartbeat_at: new Date().toISOString(),
      error_message: null
    }).eq('id', jobId)

    // Update site scrape statuses
    for (const page of scrapedPages) {
      try {
        const domain = new URL(page.url).hostname.replace(/^www\./, '').toLowerCase()
        await supabase
          .from('competitor_sites')
          .update({ 
            scrape_status: 'completed',
            scraped_at: new Date().toISOString()
          })
          .eq('job_id', jobId)
          .eq('domain', domain)
      } catch {}
    }

    // Trigger FAQ extraction
    console.log('[recover-competitor-job] Triggering FAQ extraction')
    await supabase.functions.invoke('competitor-extract-faqs', {
      body: { jobId, workspaceId: effectiveWorkspaceId }
    })

    return new Response(JSON.stringify({
      success: true,
      action: 'recovered',
      pagesRecovered: pageInserts.length,
      message: `Recovered ${pageInserts.length} pages. Extraction started.`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[recover-competitor-job] Error:', error)
    
    return new Response(JSON.stringify({
      success: false,
      error: String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
