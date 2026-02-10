import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { workspaceId } = await req.json()
    if (!workspaceId) throw new Error('workspaceId is required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    // Fetch business context for the competitor discovery payload
    const [profileRes, contextRes, searchTermsRes] = await Promise.all([
      supabase.from('business_profile').select('*').eq('workspace_id', workspaceId).maybeSingle(),
      supabase.from('business_context').select('*').eq('workspace_id', workspaceId).maybeSingle(),
      supabase.from('n8n_workflow_progress').select('details')
        .eq('workspace_id', workspaceId)
        .eq('workflow_type', 'search_terms_config')
        .maybeSingle(),
    ])

    const profile = profileRes.data as Record<string, unknown> | null
    const context = contextRes.data as Record<string, unknown> | null
    const searchConfig = (searchTermsRes.data?.details as Record<string, unknown>) || {}
    const searchQueries = (searchConfig.search_queries as string[]) || []

    const callbackBaseUrl = `${supabaseUrl}/functions/v1`
    const websiteUrl = (profile?.website as string) || (context?.website_url as string) || ''
    const ownDomain = websiteUrl.replace(/https?:\/\//, '').replace(/\/$/, '')

    console.log(`[trigger-n8n-workflows] workspace=${workspaceId} queries=${searchQueries.length} business=${(context?.company_name as string) || 'unknown'}`)

    // Trigger BOTH n8n workflows simultaneously from the server side (no CORS issues)
    const results = await Promise.allSettled([
      // Competitor Discovery
      fetch('https://bizzybee.app.n8n.cloud/webhook/competitor-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          business_name: (profile?.business_name as string) || (context?.company_name as string) || '',
          business_type: (profile?.industry as string) || (context?.business_type as string) || '',
          website_url: websiteUrl,
          location: (profile?.formatted_address as string) || (context?.service_area as string) || '',
          radius_miles: (profile?.service_radius_miles as number) || 20,
          search_queries: searchQueries,
          target_count: 50,
          exclude_domains: ownDomain ? [ownDomain] : [],
          callback_url: `${callbackBaseUrl}/n8n-competitor-callback`,
        }),
      }),

      // Email Classification
      fetch('https://bizzybee.app.n8n.cloud/webhook/email-classification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          callback_url: `${callbackBaseUrl}/n8n-email-callback`,
        }),
      }),
    ])

    const competitorResult = results[0]
    const emailResult = results[1]

    console.log('Competitor discovery trigger:', competitorResult.status, 
      competitorResult.status === 'fulfilled' ? competitorResult.value.status : (competitorResult as PromiseRejectedResult).reason)
    console.log('Email classification trigger:', emailResult.status,
      emailResult.status === 'fulfilled' ? emailResult.value.status : (emailResult as PromiseRejectedResult).reason)

    return new Response(JSON.stringify({
      success: true,
      competitor: competitorResult.status === 'fulfilled' ? { status: competitorResult.value.status } : { error: String((competitorResult as PromiseRejectedResult).reason) },
      email: emailResult.status === 'fulfilled' ? { status: emailResult.value.status } : { error: String((emailResult as PromiseRejectedResult).reason) },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error triggering n8n workflows:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
