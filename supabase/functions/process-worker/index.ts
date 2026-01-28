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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

    // Find active import jobs
    const { data: jobs } = await supabase
      .from('import_jobs')
      .select('id, workspace_id')
      .in('status', ['hydrating', 'processing'])
      .limit(5)
    
    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ message: 'No active imports' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let totalProcessed = 0

    for (const job of jobs) {
      // Get batch of hydrated emails
      const { data: emails } = await supabase
        .from('raw_emails')
        .select('id, subject, body_text, from_email, folder')
        .eq('job_id', job.id)
        .eq('status', 'hydrated')
        .limit(50)
      
      if (!emails || emails.length === 0) {
        // Check if processing is complete
        const { count } = await supabase
          .from('raw_emails')
          .select('*', { count: 'exact', head: true })
          .eq('job_id', job.id)
          .in('status', ['scanned', 'hydrating', 'hydrated'])
        
        const { data: importJob } = await supabase
          .from('import_jobs')
          .select('status')
          .eq('id', job.id)
          .single()
        
        if (count === 0 && importJob?.status === 'processing') {
          // All done!
          await supabase.from('import_jobs').update({
            status: 'completed',
            completed_at: new Date().toISOString()
          }).eq('id', job.id)
          
          // Trigger voice learning
          fetch(`${SUPABASE_URL}/functions/v1/voice-learning`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({ workspaceId: job.workspace_id })
          }).catch(console.error)
        }
        continue
      }

      // Call classification function
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/classify-emails`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({ workspaceId: job.workspace_id })
        })
      } catch (e) {
        console.error('Classification error:', e)
      }
      
      // Mark as processed
      const ids = emails.map((e: any) => e.id)
      await supabase
        .from('raw_emails')
        .update({ status: 'processed' })
        .in('id', ids)
      
      await supabase.rpc('increment_import_counts', {
        p_job_id: job.id,
        p_processed: emails.length
      })
      
      totalProcessed += emails.length
    }

    return new Response(JSON.stringify({
      success: true,
      emailsProcessed: totalProcessed
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Process worker error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
