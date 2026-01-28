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

  const startTime = Date.now()

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    console.log('[classification-worker] Starting...')

    // Find workspaces with pending emails
    const { data: pendingEmails, error: queryError } = await supabase
      .from('raw_emails')
      .select('workspace_id')
      .eq('status', 'pending')
      .is('category', null)
      .limit(100)
    
    if (queryError) {
      throw new Error(`Query error: ${queryError.message}`)
    }
    
    const uniqueWorkspaces = [...new Set(pendingEmails?.map(r => r.workspace_id).filter(Boolean) || [])]
    
    if (uniqueWorkspaces.length === 0) {
      console.log('[classification-worker] No pending emails')
      return new Response(JSON.stringify({ 
        message: 'No pending emails',
        workspaces_checked: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`[classification-worker] Found ${uniqueWorkspaces.length} workspaces with pending emails`)

    // Process each workspace (limit to 5 for this run)
    const results = await Promise.all(
      uniqueWorkspaces.slice(0, 5).map(async (workspaceId) => {
        try {
          // Call classify-emails function
          const { data, error } = await supabase.functions.invoke('classify-emails', {
            body: { workspace_id: workspaceId }
          })
          
          if (error) {
            return { workspace_id: workspaceId, error: error.message }
          }
          
          return { workspace_id: workspaceId, result: data }
        } catch (e: any) {
          return { workspace_id: workspaceId, error: e.message }
        }
      })
    )

    const successCount = results.filter(r => !r.error).length
    const totalProcessed = results
      .filter(r => r.result)
      .reduce((sum, r) => sum + (r.result?.processed || 0), 0)

    const duration = Date.now() - startTime
    console.log(`[classification-worker] Completed in ${duration}ms, processed ${totalProcessed} emails`)

    return new Response(JSON.stringify({
      success: true,
      workspaces_processed: successCount,
      total_emails_processed: totalProcessed,
      duration_ms: duration,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('[classification-worker] Error:', error.message)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
