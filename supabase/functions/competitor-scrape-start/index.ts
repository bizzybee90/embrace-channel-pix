import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { withApifyAdHocWebhooks } from '../_shared/apifyWebhooks.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const FUNCTION_NAME = 'competitor-scrape-start'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')

    if (!APIFY_API_KEY) {
      throw new Error('APIFY_API_KEY not configured')
    }

    const { jobId, workspaceId, manualUrls = [] } = await req.json()

    if (!jobId) throw new Error('jobId is required')
    if (!workspaceId) throw new Error('workspaceId is required')

    console.log(`[${FUNCTION_NAME}] Starting scrape for job:`, jobId, 'manual URLs:', manualUrls.length)

    // =========================================
    // STEP 1: Insert manual URLs if provided
    // =========================================

    if (manualUrls && manualUrls.length > 0) {
      for (const url of manualUrls) {
        if (!url || typeof url !== 'string') continue
        
        let hostname: string
        let cleanUrl = url.trim()
        
        // Add https:// if missing
        if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
          cleanUrl = 'https://' + cleanUrl
        }
        
        try {
          hostname = new URL(cleanUrl).hostname.replace(/^www\./, '').toLowerCase()
        } catch {
          console.warn(`[${FUNCTION_NAME}] Invalid manual URL:`, url)
          continue
        }

        // Check if already exists
        const { data: existing } = await supabase
          .from('competitor_sites')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('url', cleanUrl)
          .maybeSingle()

        if (!existing) {
          await supabase.from('competitor_sites').insert({
            job_id: jobId,
            workspace_id: workspaceId,
            business_name: hostname, // Use domain as name for manual entries
            url: cleanUrl,
            domain: hostname,
            discovery_source: 'manual',
            status: 'approved',
            scrape_status: 'pending',
            is_selected: true,
          })
          console.log(`[${FUNCTION_NAME}] Added manual URL:`, cleanUrl)
        }
      }
    }

    // =========================================
    // STEP 2: Fetch all SELECTED competitors
    // =========================================

    const { data: selectedSites, error: sitesError } = await supabase
      .from('competitor_sites')
      .select('id, url, domain, business_name')
      .eq('job_id', jobId)
      .eq('is_selected', true)
      .eq('scrape_status', 'pending')

    if (sitesError) {
      throw new Error(`Failed to fetch selected sites: ${sitesError.message}`)
    }

    if (!selectedSites || selectedSites.length === 0) {
      // No sites to scrape - mark job complete
      await supabase.from('competitor_research_jobs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        error_message: 'No competitor websites selected for analysis'
      }).eq('id', jobId)

      return new Response(JSON.stringify({
        success: true,
        message: 'No sites selected for scraping',
        sitesCount: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`[${FUNCTION_NAME}] Selected sites to scrape:`, selectedSites.length)

    // =========================================
    // STEP 3: Update job status to scraping
    // =========================================

    await supabase.from('competitor_research_jobs').update({
      status: 'scraping',
      sites_approved: selectedSites.length,
      sites_validated: selectedSites.length, // Track validated = user-confirmed selection
      heartbeat_at: new Date().toISOString()
    }).eq('id', jobId)

    // =========================================
    // STEP 4: Configure deep scraping with Apify
    // =========================================

    // Build startUrls - NO LIMIT (previously was .slice(0, 50))
    const startUrls = selectedSites.map(site => ({ url: site.url }))

    // Configure webhook for completion
    const webhookUrl = `${SUPABASE_URL}/functions/v1/handle-scrape-complete?apikey=${SUPABASE_ANON_KEY}`
    
    const webhookDefs = [
      {
        eventTypes: ['ACTOR.RUN.SUCCEEDED'],
        requestUrl: webhookUrl,
        shouldInterpolateStrings: true,
        payloadTemplate: JSON.stringify({
          jobId,
          workspaceId,
          runId: '{{resource.id}}',
          datasetId: '{{resource.defaultDatasetId}}',
        }),
      },
    ]

    // Deep scraping configuration - much more comprehensive than homepage-only
    const scrapeInput = {
      startUrls,
      
      // DEPTH: Homepage + 2 levels (was maxCrawlDepth: 0!)
      maxCrawlDepth: 2,
      
      // LIMIT per site to avoid runaway costs
      maxCrawlPagesPerHostname: 8,
      
      // TOTAL PAGES: Based on selected count
      maxCrawlPages: selectedSites.length * 8,
      
      // BROWSER: Full Chrome for JS-heavy sites (Wix, Squarespace, etc.)
      crawlerType: "playwright:chrome",
      
      // CONTENT
      saveHtml: false,
      saveMarkdown: true,
      removeCookieWarnings: true,
      
      // PRIORITY PAGES: Hunt for "money pages" with valuable FAQ/pricing content
      globs: [
        '**/faq*',
        '**/faqs*',
        '**/frequently-asked*',
        '**/pricing*',
        '**/prices*',
        '**/cost*',
        '**/services*',
        '**/about*',
        '**/contact*',
        '**/areas*',
        '**/coverage*',
        '**/what-we-do*',
        '**/our-services*',
      ],
      
      // EXCLUDE: Skip low-value pages
      excludeGlobs: [
        '**/blog/**',
        '**/news/**',
        '**/privacy*',
        '**/terms*',
        '**/cookie*',
        '**/gdpr*',
        '**/sitemap*',
        '**/login*',
        '**/register*',
        '**/cart*',
        '**/checkout*',
        '**/*.pdf',
        '**/*.jpg',
        '**/*.png',
        '**/*.gif',
      ],
      
      // Performance settings
      maxRequestsPerCrawl: selectedSites.length * 10,
      maxConcurrency: 10,
      requestHandlerTimeoutSecs: 60,
    }

    console.log(`[${FUNCTION_NAME}] Scrape config:`, {
      startUrls: startUrls.length,
      maxCrawlDepth: scrapeInput.maxCrawlDepth,
      maxCrawlPages: scrapeInput.maxCrawlPages,
      crawlerType: scrapeInput.crawlerType,
    })

    // =========================================
    // STEP 5: Start Apify scrape with webhook
    // =========================================

    const apifyRunUrl = withApifyAdHocWebhooks(
      `https://api.apify.com/v2/acts/apify~website-content-crawler/runs?token=${APIFY_API_KEY}`,
      webhookDefs,
    )

    const scrapeResponse = await fetch(apifyRunUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scrapeInput),
    })

    if (!scrapeResponse.ok) {
      const errorText = await scrapeResponse.text()
      console.error(`[${FUNCTION_NAME}] Apify API error:`, errorText)
      throw new Error(`Apify scrape API error: ${errorText}`)
    }

    const scrapeData = await scrapeResponse.json()
    const scrapeRunId = scrapeData.data?.id

    console.log(`[${FUNCTION_NAME}] Scrape started:`, scrapeRunId)

    // Update job with scrape run ID
    await supabase.from('competitor_research_jobs').update({
      scrape_run_id: scrapeRunId,
      heartbeat_at: new Date().toISOString()
    }).eq('id', jobId)

    // Update individual sites to show they're being scraped
    await supabase
      .from('competitor_sites')
      .update({ scrape_status: 'scraping' })
      .eq('job_id', jobId)
      .eq('is_selected', true)

    const duration = Date.now() - startTime

    return new Response(JSON.stringify({
      success: true,
      jobId,
      scrapeRunId,
      sitesCount: selectedSites.length,
      estimatedPages: selectedSites.length * 8,
      estimatedCost: `~$${(selectedSites.length * 0.08).toFixed(2)}`,
      duration_ms: duration,
      message: `Deep scraping started for ${selectedSites.length} websites`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    const duration = Date.now() - startTime
    console.error(`[${FUNCTION_NAME}] Error:`, error.message)

    // Try to update job status
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      const payload = await req.clone().json().catch(() => ({}))
      if (payload.jobId) {
        await supabase.from('competitor_research_jobs').update({
          status: 'failed',
          error_message: error.message
        }).eq('id', payload.jobId)
      }
    } catch {}

    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      function: FUNCTION_NAME,
      duration_ms: duration
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
