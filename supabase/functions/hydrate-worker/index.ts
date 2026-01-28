import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const AURINKO_API_URL = 'https://api.aurinko.io/v1'

    // Find active import jobs
    const { data: jobs } = await supabase
      .from('import_jobs')
      .select('id, workspace_id')
      .in('status', ['scanning', 'hydrating'])
      .limit(5)
    
    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ message: 'No active imports' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let totalHydrated = 0

    for (const job of jobs) {
      // Get access token
      const { data: creds } = await supabase
        .from('workspace_credentials')
        .select('access_token')
        .eq('workspace_id', job.workspace_id)
        .eq('provider', 'aurinko')
        .single()
      
      if (!creds?.access_token) continue

      // Get batch of scanned emails (with row locking)
      const { data: emails } = await supabase.rpc('get_emails_to_hydrate', {
        p_job_id: job.id,
        p_batch_size: 400
      })
      
      if (!emails || emails.length === 0) {
        // Check if hydration complete
        const { count } = await supabase
          .from('raw_emails')
          .select('*', { count: 'exact', head: true })
          .eq('job_id', job.id)
          .eq('status', 'scanned')
        
        if (count === 0) {
          const { data: importJob } = await supabase
            .from('import_jobs')
            .select('status')
            .eq('id', job.id)
            .single()
          
          if (importJob?.status === 'hydrating') {
            await supabase.from('import_jobs').update({
              status: 'processing',
              hydrating_completed_at: new Date().toISOString()
            }).eq('id', job.id)
          }
        }
        continue
      }

      // Throttled body fetch (8 per second = 480/min, under 500 limit)
      const chunkSize = 8
      let hydratedCount = 0
      
      for (let i = 0; i < emails.length; i += chunkSize) {
        const chunk = emails.slice(i, i + chunkSize)
        
        const results = await Promise.allSettled(
          chunk.map(async (email: any) => {
            try {
              const response = await fetch(
                `${AURINKO_API_URL}/email/messages/${email.aurinko_id}`,
                { headers: { 'Authorization': `Bearer ${creds.access_token}` } }
              )
              
              if (!response.ok) {
                throw new Error(response.status === 429 ? 'RATE_LIMITED' : `HTTP ${response.status}`)
              }
              
              const data = await response.json()
              return {
                id: email.id,
                body_text: data.textBody || data.body?.content || '',
                body_html: data.htmlBody || data.body?.content || '',
                success: true
              }
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : 'Unknown error'
              return { id: email.id, success: false, error: errorMessage }
            }
          })
        )
        
        // Process results
        const updates: any[] = []
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.success) {
            updates.push({
              id: result.value.id,
              body_text: result.value.body_text,
              body_html: result.value.body_html,
              status: 'hydrated'
            })
            hydratedCount++
          } else if (result.status === 'fulfilled') {
            updates.push({
              id: result.value.id,
              status: result.value.error === 'RATE_LIMITED' ? 'scanned' : 'hydrate_failed'
            })
          }
        }
        
        if (updates.length > 0) {
          await supabase.from('raw_emails').upsert(updates)
        }
        
        // Wait 1 second before next chunk (rate limiting)
        if (i + chunkSize < emails.length) {
          await sleep(1000)
        }
      }

      if (hydratedCount > 0) {
        await supabase.rpc('increment_import_counts', {
          p_job_id: job.id,
          p_hydrated: hydratedCount
        })
        totalHydrated += hydratedCount
      }
    }

    return new Response(JSON.stringify({
      success: true,
      emailsHydrated: totalHydrated
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Hydrate worker error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
