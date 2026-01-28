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
    const { jobId, workspaceId, datasetId } = payload
    
    console.log('[handle-scrape-complete] Received webhook:', { jobId, workspaceId, datasetId })
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY')

    if (!APIFY_API_KEY) {
      throw new Error('APIFY_API_KEY not configured')
    }

    // Update job status
    await supabase.from('competitor_research_jobs').update({
      status: 'extracting',
      heartbeat_at: new Date().toISOString()
    }).eq('id', jobId)

    // =========================================
    // STEP 1: Fetch scraped content from Apify
    // =========================================
    
    const datasetResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
    )
    
    if (!datasetResponse.ok) {
      throw new Error(`Failed to fetch dataset: ${datasetResponse.status}`)
    }
    
    const scrapedPages = await datasetResponse.json()
    console.log('[handle-scrape-complete] Fetched pages:', scrapedPages.length)

    // =========================================
    // STEP 2: Store scraped content
    // =========================================
    
    const pageInserts = scrapedPages.map((page: any) => {
      let domain = ''
      try {
        domain = new URL(page.url).hostname.replace(/^www\./, '').toLowerCase()
      } catch {
        domain = page.url
      }
      
      return {
        job_id: jobId,
        workspace_id: workspaceId,
        url: page.url,
        title: page.metadata?.title || page.title,
        content: page.markdown || page.text,
        word_count: (page.markdown || page.text || '').split(/\s+/).length,
        scraped_at: new Date().toISOString(),
        faqs_extracted: false
      }
    })
    
    if (pageInserts.length > 0) {
      const { error: insertError } = await supabase
        .from('competitor_pages')
        .insert(pageInserts)
      
      if (insertError) {
        console.error('[handle-scrape-complete] Insert error:', insertError)
      }
    }

    // Update job
    await supabase.from('competitor_research_jobs').update({
      sites_scraped: scrapedPages.length,
      pages_scraped: scrapedPages.length,
      heartbeat_at: new Date().toISOString()
    }).eq('id', jobId)

    // Also update competitor_sites scrape status
    for (const page of scrapedPages) {
      try {
        const domain = new URL(page.url).hostname.replace(/^www\./, '').toLowerCase()
        await supabase
          .from('competitor_sites')
          .update({ 
            scrape_status: 'completed',
            scraped_at: new Date().toISOString(),
            content_extracted: (page.markdown || page.text || '').substring(0, 5000)
          })
          .eq('job_id', jobId)
          .eq('domain', domain)
      } catch (e) {
        // Skip if URL parsing fails
      }
    }

    // =========================================
    // STEP 3: Trigger FAQ extraction
    // =========================================
    
    console.log('[handle-scrape-complete] Triggering FAQ extraction')
    
    const extractResponse = await supabase.functions.invoke('extract-competitor-faqs', {
      body: { jobId, workspaceId }
    })

    if (extractResponse.error) {
      console.error('[handle-scrape-complete] Extraction invoke error:', extractResponse.error)
    }

    return new Response(JSON.stringify({
      success: true,
      pagesScraped: scrapedPages.length,
      extractionStarted: true
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[handle-scrape-complete] Error:', error)
    
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
