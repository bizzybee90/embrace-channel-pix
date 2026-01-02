import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void } | undefined;
const waitUntil = (p: Promise<unknown>) => { try { EdgeRuntime?.waitUntil(p); } catch {} };

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId, configId } = await req.json();
    console.log('[email-analyze] Starting:', { jobId, configId });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: job } = await supabase.from('email_import_jobs').select('*').eq('id', jobId).single();
    if (!job || job.status === 'cancelled') {
      console.log('[email-analyze] Job cancelled or not found');
      return new Response(JSON.stringify({ cancelled: true }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const { data: config } = await supabase
      .from('email_provider_configs')
      .select('workspace_id, email_address, aliases')
      .eq('id', configId)
      .single();
      
    if (!config) {
      await supabase.from('email_import_jobs').update({ status: 'error', error_message: 'Config not found' }).eq('id', jobId);
      return new Response(JSON.stringify({ error: 'Config not found' }), { 
        status: 404, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    await supabase.from('email_import_jobs').update({ 
      status: 'analyzing', 
      heartbeat_at: new Date().toISOString() 
    }).eq('id', jobId);

    await supabase.from('email_provider_configs').update({
      sync_stage: 'analyzing',
    }).eq('id', configId);

    // Mark noise emails using SQL function
    console.log('[email-analyze] Marking noise emails...');
    const { data: noiseCount, error: noiseError } = await supabase.rpc('mark_noise_emails', { 
      p_workspace_id: config.workspace_id, 
      p_job_id: jobId 
    });
    
    if (noiseError) {
      console.error('[email-analyze] Error marking noise:', noiseError);
    } else {
      console.log(`[email-analyze] Marked ${noiseCount} noise emails`);
    }

    // Filter out self-sent emails (emails FROM the connected address in inbound)
    const connectedEmails = [
      config.email_address.toLowerCase(), 
      ...(config.aliases || []).map((a: string) => a.toLowerCase())
    ];
    
    const { error: selfSentError } = await supabase
      .from('email_import_queue')
      .update({ is_noise: true, noise_reason: 'self_sent', status: 'skipped' })
      .eq('job_id', jobId)
      .eq('direction', 'inbound')
      .in('from_email', connectedEmails);
      
    if (selfSentError) {
      console.error('[email-analyze] Error filtering self-sent:', selfSentError);
    }

    // Run thread analysis using SQL function
    console.log('[email-analyze] Analyzing threads...');
    const { data: analysisResult, error: analysisError } = await supabase.rpc('analyze_email_threads', { 
      p_workspace_id: config.workspace_id, 
      p_job_id: jobId 
    });
    
    if (analysisError) {
      console.error('[email-analyze] Analysis error:', analysisError);
      await supabase.from('email_import_jobs').update({ 
        status: 'error', 
        error_message: 'Thread analysis failed' 
      }).eq('id', jobId);
      return new Response(JSON.stringify({ error: 'Analysis failed' }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const stats = analysisResult?.[0] || { threads_analyzed: 0, conversation_threads: 0, noise_threads: 0 };
    console.log('[email-analyze] Analysis result:', stats);

    // Queue conversation emails for body fetch
    const { data: conversationThreads } = await supabase
      .from('email_thread_analysis')
      .select('thread_id')
      .eq('job_id', jobId)
      .eq('is_conversation', true)
      .eq('is_noise_thread', false);

    const threadIds = conversationThreads?.map(t => t.thread_id) || [];
    console.log(`[email-analyze] Found ${threadIds.length} conversation threads to fetch`);

    if (threadIds.length > 0) {
      // Queue emails from conversation threads for body fetch
      const BATCH_SIZE = 500;
      for (let i = 0; i < threadIds.length; i += BATCH_SIZE) {
        const batch = threadIds.slice(i, i + BATCH_SIZE);
        await supabase
          .from('email_import_queue')
          .update({ status: 'queued_for_fetch' })
          .eq('job_id', jobId)
          .eq('is_noise', false)
          .in('thread_id', batch);
      }
    }

    const { count: queuedCount } = await supabase
      .from('email_import_queue')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('status', 'queued_for_fetch');

    console.log(`[email-analyze] ${queuedCount} emails queued for body fetch`);

    await supabase.from('email_import_jobs').update({
      status: 'fetching',
      total_threads_found: stats.threads_analyzed,
      conversation_threads: stats.conversation_threads,
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    await supabase.from('email_provider_configs').update({
      sync_stage: 'fetching_bodies',
      threads_linked: stats.conversation_threads,
    }).eq('id', configId);

    // Start body fetching
    waitUntil(supabase.functions.invoke('email-fetch-bodies', { body: { jobId, configId } }));

    return new Response(JSON.stringify({
      success: true,
      threadsAnalyzed: stats.threads_analyzed,
      conversationThreads: stats.conversation_threads,
      noiseThreads: stats.noise_threads,
      emailsQueuedForFetch: queuedCount,
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('[email-analyze] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
