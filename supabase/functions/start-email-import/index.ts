import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { workspaceId, accessToken } = await req.json()
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const AURINKO_API_URL = 'https://api.aurinko.io/v1'

    // Get folder list from Aurinko
    const foldersResponse = await fetch(`${AURINKO_API_URL}/email/folders`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    })
    
    if (!foldersResponse.ok) {
      throw new Error('Failed to fetch folders from Aurinko')
    }
    
    const foldersData = await foldersResponse.json()
    const folders = foldersData.value || foldersData.folders || []

    // Find SENT and INBOX folders
    const sentFolder = folders.find((f: any) => 
      f.name?.toLowerCase().includes('sent') || f.folderType === 'SENT'
    )
    const inboxFolder = folders.find((f: any) => 
      f.name?.toLowerCase() === 'inbox' || f.folderType === 'INBOX'
    )

    // Estimate total emails
    let totalEstimate = 0
    if (sentFolder?.totalItems) totalEstimate += sentFolder.totalItems
    if (inboxFolder?.totalItems) totalEstimate += inboxFolder.totalItems

    // Create import job
    const { data: job, error: jobError } = await supabase
      .from('import_jobs')
      .insert({
        workspace_id: workspaceId,
        status: 'scanning',
        total_estimated: totalEstimate,
        started_at: new Date().toISOString()
      })
      .select()
      .single()
    
    if (jobError) throw new Error(`Failed to create job: ${jobError.message}`)

    // Create folder cursors (SENT priority=1, INBOX priority=2)
    const cursors = []
    if (sentFolder) {
      cursors.push({
        job_id: job.id,
        workspace_id: workspaceId,
        folder_name: 'SENT',
        folder_id: sentFolder.id,
        priority: 1,
        is_complete: false
      })
    }
    if (inboxFolder) {
      cursors.push({
        job_id: job.id,
        workspace_id: workspaceId,
        folder_name: 'INBOX',
        folder_id: inboxFolder.id,
        priority: 2,
        is_complete: false
      })
    }
    
    await supabase.from('folder_cursors').insert(cursors)

    // Store access token securely using encrypted storage RPC
    // The token is passed from the OAuth callback and we need to store it encrypted
    const { error: storeError } = await supabase.rpc('store_encrypted_token', {
      p_workspace_id: workspaceId,
      p_access_token: accessToken,
      p_refresh_token: null, // Not provided in this flow
      p_expires_at: null,    // Not provided in this flow
      p_token_type: 'aurinko'
    });
    
    if (storeError) {
      console.error('Failed to store encrypted token:', storeError);
      // Fall back to workspace_credentials for backward compatibility
      await supabase.from('workspace_credentials').upsert({
        workspace_id: workspaceId,
        provider: 'aurinko',
        access_token: accessToken,
        updated_at: new Date().toISOString()
      }, { onConflict: 'workspace_id,provider' });
    }

    // Trigger scan-worker (fire and forget)
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    fetch(`${SUPABASE_URL}/functions/v1/scan-worker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({ jobId: job.id, workspaceId })
    }).catch(console.error)

    return new Response(JSON.stringify({
      success: true,
      jobId: job.id,
      status: 'scanning',
      totalEstimate,
      message: 'Import started'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Start import error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
