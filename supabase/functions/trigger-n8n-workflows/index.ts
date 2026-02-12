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

    // Bug 7 Fix: Read target_count from saved config instead of hardcoding
    const targetCount = (searchConfig.target_count as number) || 50

    // Bug 8 Fix: Generate a job_id for this research session
    const jobId = crypto.randomUUID()

    const callbackBaseUrl = `${supabaseUrl}/functions/v1`
    const websiteUrl = (profile?.website as string) || (context?.website_url as string) || ''
    const ownDomain = websiteUrl.replace(/https?:\/\//, '').replace(/\/$/, '')

    console.log(`[trigger-n8n-workflows] workspace=${workspaceId} queries=${searchQueries.length} target=${targetCount} jobId=${jobId} business=${(context?.company_name as string) || 'unknown'}`)

    // Bug 8 Fix: Create a competitor_research_jobs record so job_id is valid
    await supabase.from('competitor_research_jobs').insert({
      id: jobId,
      workspace_id: workspaceId,
      niche_query: searchQueries[0] || (context?.business_type as string) || 'general',
      status: 'pending',
      target_count: targetCount,
      search_queries: searchQueries,
      location: (profile?.formatted_address as string) || (context?.service_area as string) || '',
      industry: (profile?.industry as string) || (context?.business_type as string) || '',
      exclude_domains: ownDomain ? [ownDomain] : [],
    })

    // Initialize progress records so UI shows "pending" immediately
    await Promise.all([
      supabase.from('n8n_workflow_progress').upsert({
        workspace_id: workspaceId,
        workflow_type: 'competitor_discovery',
        status: 'pending',
        details: { message: 'Workflow triggered, waiting for n8n...', job_id: jobId },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,workflow_type' }),
      // Bug 9 Fix: Only init email track status — don't trigger email classification from here.
      // Email classification is already chained from the email-import-v2 pipeline when import completes.
      supabase.from('n8n_workflow_progress').upsert({
        workspace_id: workspaceId,
        workflow_type: 'email_import',
        status: 'pending',
        details: { message: 'Waiting for email import to complete...' },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,workflow_type' }),
    ]);

    // Bug 9 Fix: Only trigger competitor discovery — NOT email classification.
    // Email classification is already handled by the email-import-v2 → email-classify-bulk chain.
    const competitorResult = await fetch('https://bizzybee.app.n8n.cloud/webhook/competitor-discovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        job_id: jobId,
        business_name: (profile?.business_name as string) || (context?.company_name as string) || '',
        business_type: (profile?.industry as string) || (context?.business_type as string) || '',
        website_url: websiteUrl,
        location: (profile?.formatted_address as string) || (context?.service_area as string) || '',
        radius_miles: (profile?.service_radius_miles as number) || 20,
        search_queries: searchQueries,
        target_count: targetCount,
        exclude_domains: ownDomain ? [ownDomain] : [],
        callback_url: `${callbackBaseUrl}/n8n-competitor-callback`,
      }),
    }).catch(err => ({ ok: false, status: 0, error: String(err) }));

    const resultStatus = 'status' in competitorResult ? competitorResult.status : 0;
    console.log('Competitor discovery trigger: status=', resultStatus);

    return new Response(JSON.stringify({
      success: true,
      job_id: jobId,
      competitor: { status: resultStatus },
      email: { status: 'deferred', message: 'Email classification chains from import pipeline' },
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
