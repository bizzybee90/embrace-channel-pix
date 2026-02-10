import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-n8n-signature',
};

async function verifyN8nSignature(payload: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  if (computed.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < computed.length; i++) {
    result |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const n8nSecret = Deno.env.get('N8N_WEBHOOK_SECRET');

    const rawBody = await req.text();

    if (n8nSecret) {
      const signature = req.headers.get('x-n8n-signature') || '';
      if (!signature || !(await verifyN8nSignature(rawBody, signature, n8nSecret))) {
        console.error('[n8n-callback] Invalid or missing webhook signature');
        return new Response(
          JSON.stringify({ error: 'Unauthorized: invalid signature' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      console.warn('[n8n-callback] N8N_WEBHOOK_SECRET not configured - skipping signature verification');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = JSON.parse(rawBody);
    const { 
      workspace_id, status, message,
      competitors_found, competitors_scraped,
      verified_count, probable_count, hallucinations_caught,
      live_domains, dead_domains, scraped, failed,
      faq_count, competitor_count, claude_found, gemini_found,
      error: errorMsg
    } = body;

    if (!workspace_id) {
      return new Response(
        JSON.stringify({ error: 'workspace_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[n8n-callback] workspace=${workspace_id} status=${status} message=${message}`);

    const details: Record<string, unknown> = {
      message,
      updated_at: new Date().toISOString(),
    };

    if (competitors_found !== undefined) details.competitors_found = competitors_found;
    if (competitors_scraped !== undefined) details.competitors_scraped = competitors_scraped;
    if (verified_count !== undefined) details.verified_count = verified_count;
    if (probable_count !== undefined) details.probable_count = probable_count;
    if (hallucinations_caught !== undefined) details.hallucinations_caught = hallucinations_caught;
    if (live_domains !== undefined) details.live_domains = live_domains;
    if (dead_domains !== undefined) details.dead_domains = dead_domains;
    if (scraped !== undefined) details.competitors_scraped = scraped;
    if (failed !== undefined) details.scrape_failed = failed;
    if (faq_count !== undefined) details.faqs_generated = faq_count;
    if (competitor_count !== undefined) details.competitor_count = competitor_count;
    if (claude_found !== undefined) details.claude_found = claude_found;
    if (gemini_found !== undefined) details.gemini_found = gemini_found;
    if (errorMsg) details.error = errorMsg;

    const { error: upsertError } = await supabase
      .from('n8n_workflow_progress')
      .upsert({
        workspace_id,
        workflow_type: 'competitor_discovery',
        status: status || 'in_progress',
        details,
        updated_at: new Date().toISOString(),
        completed_at: status === 'complete' ? new Date().toISOString() : null,
      }, {
        onConflict: 'workspace_id,workflow_type',
      });

    if (upsertError) {
      console.error('[n8n-callback] Upsert error:', upsertError);
      return new Response(
        JSON.stringify({ error: 'Failed to update progress' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, status, workspace_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[n8n-callback] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
