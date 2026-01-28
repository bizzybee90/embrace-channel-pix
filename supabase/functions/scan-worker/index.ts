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
    const { jobId, workspaceId } = await req.json()
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const AURINKO_API_URL = 'https://api.aurinko.io/v1'
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

    // Get access token
    const { data: creds } = await supabase
      .from('workspace_credentials')
      .select('access_token')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'aurinko')
      .single()
    
    if (!creds?.access_token) {
      throw new Error('No Aurinko access token found')
    }

    // Get next incomplete folder cursor (lowest priority number first)
    const { data: cursor } = await supabase
      .from('folder_cursors')
      .select('*')
      .eq('job_id', jobId)
      .eq('is_complete', false)
      .order('priority', { ascending: true })
      .limit(1)
      .single()
    
    if (!cursor) {
      // All folders complete - transition to hydrating
      await supabase.from('import_jobs').update({
        status: 'hydrating',
        scanning_completed_at: new Date().toISOString()
      }).eq('id', jobId)
      
      // Trigger hydrate-worker to start fetching bodies
      fetch(`${SUPABASE_URL}/functions/v1/hydrate-worker`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({ jobId, workspaceId })
      }).catch(console.error)
      
      return new Response(JSON.stringify({ success: true, message: 'Scanning complete, starting hydration' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Fetch page of emails from Aurinko
    let url = `${AURINKO_API_URL}/email/messages?folderId=${cursor.folder_id}&limit=100`
    if (cursor.next_page_token) {
      url += `&pageToken=${cursor.next_page_token}`
    }
    
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${creds.access_token}` }
    })
    
    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited - wait and retry
        console.log('Rate limited, will retry...')
        return new Response(JSON.stringify({ success: false, message: 'Rate limited' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      throw new Error(`Aurinko API error: ${response.status}`)
    }
    
    const data = await response.json()
    const messages = data.records || data.value || []
    const nextPageToken = data.nextPageToken

    // Save emails as 'scanned'
    if (messages.length > 0) {
      const emailInserts = messages.map((msg: any) => ({
        job_id: jobId,
        workspace_id: workspaceId,
        aurinko_id: msg.id,
        thread_id: msg.threadId || msg.conversationId,
        folder: cursor.folder_name,
        subject: msg.subject,
        from_email: msg.from?.address || msg.from?.emailAddress?.address,
        to_email: msg.to?.[0]?.address || msg.to?.[0]?.emailAddress?.address,
        sent_at: msg.sentDateTime || msg.receivedDateTime,
        status: 'scanned'
      }))
      
      await supabase.from('raw_emails').upsert(emailInserts, { 
        onConflict: 'workspace_id,aurinko_id',
        ignoreDuplicates: true 
      })
      
      await supabase.rpc('increment_import_counts', {
        p_job_id: jobId,
        p_scanned: messages.length
      })
      
      await supabase.from('folder_cursors').update({
        emails_found: cursor.emails_found + messages.length,
        last_processed_at: new Date().toISOString()
      }).eq('id', cursor.id)
    }

    // Update cursor and recurse
    if (nextPageToken) {
      await supabase.from('folder_cursors').update({
        next_page_token: nextPageToken
      }).eq('id', cursor.id)
    } else {
      await supabase.from('folder_cursors').update({
        is_complete: true,
        next_page_token: null
      }).eq('id', cursor.id)
    }
    
    // Continue scanning (call self recursively)
    fetch(`${SUPABASE_URL}/functions/v1/scan-worker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({ jobId, workspaceId })
    }).catch(console.error)

    return new Response(JSON.stringify({
      success: true,
      folder: cursor.folder_name,
      emailsFound: messages.length,
      hasMore: !!nextPageToken
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Scan worker error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
