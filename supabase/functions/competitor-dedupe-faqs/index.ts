import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 50;
const SIMILARITY_THRESHOLD = 0.95;

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;
const waitUntil = (p: Promise<unknown>) => { try { EdgeRuntime?.waitUntil(p); } catch { /* ignore */ } };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { jobId, workspaceId } = await req.json();
    console.log('[dedupe-faqs] Starting:', { jobId });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      await supabase.from('competitor_research_jobs').update({
        status: 'error', error_message: 'No OpenAI API key for embeddings'
      }).eq('id', jobId);
      return new Response(JSON.stringify({ error: 'No OpenAI key' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get job
    const { data: job } = await supabase
      .from('competitor_research_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job || job.status === 'cancelled') {
      return new Response(JSON.stringify({ cancelled: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await supabase.from('competitor_research_jobs').update({
      status: 'deduplicating',
      heartbeat_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Get FAQs without embeddings
    const { data: faqs } = await supabase
      .from('competitor_faqs_raw')
      .select('id, question')
      .eq('job_id', jobId)
      .is('embedding', null)
      .limit(BATCH_SIZE);

    console.log(`[dedupe-faqs] Embedding ${faqs?.length || 0} FAQs`);

    if (faqs && faqs.length > 0) {
      // Generate embeddings in batch
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: faqs.map(f => f.question),
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI embeddings failed: ${response.status}`);
      }

      const embeddingData = await response.json();

      // Update each FAQ with its embedding
      for (let i = 0; i < faqs.length; i++) {
        const embedding = embeddingData.data[i]?.embedding;
        if (embedding) {
          await supabase.from('competitor_faqs_raw').update({
            embedding: embedding,
          }).eq('id', faqs[i].id);
        }
      }
    }

    // Check if more to embed
    const { count: remainingEmbeddings } = await supabase
      .from('competitor_faqs_raw')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .is('embedding', null);

    if (remainingEmbeddings && remainingEmbeddings > 0) {
      // Continue embedding
      waitUntil(supabase.functions.invoke('competitor-dedupe-faqs', { body: { jobId, workspaceId } }));
    } else {
      // Run deduplication using the SQL function
      console.log('[dedupe-faqs] Running deduplication...');
      
      const { data: dupeCount, error: dupeError } = await supabase.rpc('find_duplicate_faqs', {
        p_workspace_id: workspaceId,
        p_job_id: jobId,
        p_similarity_threshold: SIMILARITY_THRESHOLD,
      });

      if (dupeError) {
        console.error('[dedupe-faqs] Dedup function error:', dupeError);
      } else {
        console.log(`[dedupe-faqs] Found ${dupeCount} duplicates`);
      }

      // Count unique FAQs
      const { count: uniqueCount } = await supabase
        .from('competitor_faqs_raw')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', jobId)
        .eq('is_duplicate', false);

      await supabase.from('competitor_research_jobs').update({
        faqs_after_dedup: uniqueCount,
        status: 'refining',
        heartbeat_at: new Date().toISOString(),
      }).eq('id', jobId);

      // Move to refinement
      waitUntil(supabase.functions.invoke('competitor-refine-faqs', { body: { jobId, workspaceId } }));
    }

    return new Response(JSON.stringify({
      success: true,
      embedded: faqs?.length || 0,
      remainingEmbeddings,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[dedupe-faqs] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
