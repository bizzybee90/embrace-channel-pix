import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const FUNCTION_NAME = 'validate-competitor-sites'
const TIMEOUT_MS = 5000 // 5 second timeout per site
const CONCURRENCY = 10 // Validate 10 sites at a time

// Validate a single site with HEAD request
async function validateSite(url: string): Promise<{ status: 'valid' | 'invalid' | 'timeout'; statusCode?: number }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    // Try HEAD first (faster, less data)
    let response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BizzyBee/1.0; +https://bizzybee.uk)',
      },
    })
    clearTimeout(timeout)

    // Some servers don't support HEAD, try GET with minimal data
    if (response.status === 405) {
      const getController = new AbortController()
      const getTimeout = setTimeout(() => getController.abort(), TIMEOUT_MS)
      
      response = await fetch(url, {
        method: 'GET',
        signal: getController.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BizzyBee/1.0; +https://bizzybee.uk)',
          'Range': 'bytes=0-0', // Request minimal data
        },
      })
      clearTimeout(getTimeout)
    }

    // Valid if 2xx or 3xx (redirects are fine, we followed them)
    const isValid = response.status >= 200 && response.status < 400
    return { 
      status: isValid ? 'valid' : 'invalid',
      statusCode: response.status 
    }
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      return { status: 'timeout' }
    }
    // Network errors, DNS failures, etc.
    return { status: 'invalid' }
  }
}

// Process sites in batches for efficiency
async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = []
  
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(processor))
    results.push(...batchResults)
  }
  
  return results
}

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

    const { jobId, workspaceId, targetCount } = await req.json()

    if (!jobId) throw new Error('jobId is required')
    if (!workspaceId) throw new Error('workspaceId is required')
    if (!targetCount) throw new Error('targetCount is required')

    console.log(`[${FUNCTION_NAME}] Starting validation for job:`, jobId, 'target:', targetCount)

    // Fetch all selected sites for this job
    const { data: selectedSites, error: sitesError } = await supabase
      .from('competitor_sites')
      .select('id, url, domain, business_name, relevance_score, validation_status')
      .eq('job_id', jobId)
      .eq('is_selected', true)
      .order('relevance_score', { ascending: false })

    if (sitesError) throw new Error(`Failed to fetch sites: ${sitesError.message}`)

    console.log(`[${FUNCTION_NAME}] Found ${selectedSites?.length || 0} selected sites`)

    // Validate sites that haven't been validated yet
    const sitesToValidate = selectedSites?.filter(s => s.validation_status === 'pending') || []

    console.log(`[${FUNCTION_NAME}] Validating ${sitesToValidate.length} pending sites`)

    // Process validation in parallel batches
    const validationResults = await processBatch(
      sitesToValidate,
      async (site) => {
        const result = await validateSite(site.url)
        return { siteId: site.id, ...result }
      },
      CONCURRENCY
    )

    // Update validation results in database
    const now = new Date().toISOString()
    for (const result of validationResults) {
      await supabase
        .from('competitor_sites')
        .update({
          validation_status: result.status,
          validated_at: now,
        })
        .eq('id', result.siteId)
    }

    // Count valid sites
    const validCount = validationResults.filter(r => r.status === 'valid').length
    const alreadyValidCount = selectedSites?.filter(s => s.validation_status === 'valid').length || 0
    const totalValid = validCount + alreadyValidCount
    const invalidCount = validationResults.filter(r => r.status !== 'valid').length

    console.log(`[${FUNCTION_NAME}] Validation complete: ${totalValid} valid, ${invalidCount} invalid`)

    // If we don't have enough valid sites, try to find replacements
    const shortfall = targetCount - totalValid

    if (shortfall > 0) {
      console.log(`[${FUNCTION_NAME}] Need ${shortfall} replacements`)

      // Get next-best unselected candidates
      const { data: candidates, error: candError } = await supabase
        .from('competitor_sites')
        .select('id, url, domain, business_name, relevance_score, validation_status')
        .eq('job_id', jobId)
        .eq('is_selected', false)
        .order('relevance_score', { ascending: false })
        .order('distance_miles', { ascending: true })
        .limit(shortfall * 3) // Get extra in case some fail

      if (candError) {
        console.warn(`[${FUNCTION_NAME}] Failed to fetch candidates:`, candError.message)
      }

      let replacementsAdded = 0

      if (candidates && candidates.length > 0) {
        // Validate candidates until we have enough
        for (const candidate of candidates) {
          if (replacementsAdded >= shortfall) break

          // Validate the candidate
          const result = await validateSite(candidate.url)

          if (result.status === 'valid') {
            // Mark as selected and validated
            await supabase
              .from('competitor_sites')
              .update({
                is_selected: true,
                validation_status: 'valid',
                validated_at: now,
              })
              .eq('id', candidate.id)

            replacementsAdded++
            console.log(`[${FUNCTION_NAME}] Added replacement: ${candidate.domain}`)
          } else {
            // Mark as invalid even though not selected
            await supabase
              .from('competitor_sites')
              .update({
                validation_status: result.status,
                validated_at: now,
              })
              .eq('id', candidate.id)
          }
        }
      }

      console.log(`[${FUNCTION_NAME}] Added ${replacementsAdded} replacements`)
    }

    // Get final count of valid selected sites
    const { count: finalValidCount } = await supabase
      .from('competitor_sites')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('is_selected', true)
      .eq('validation_status', 'valid')

    const duration = Date.now() - startTime

    return new Response(JSON.stringify({
      success: true,
      jobId,
      sitesValidated: sitesToValidate.length,
      validCount: finalValidCount || 0,
      invalidCount,
      targetCount,
      meetsTarget: (finalValidCount || 0) >= targetCount,
      duration_ms: duration,
      message: `Validated ${sitesToValidate.length} sites, ${finalValidCount} valid`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    const duration = Date.now() - startTime
    console.error(`[${FUNCTION_NAME}] Error:`, error.message)

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
