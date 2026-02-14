import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-n8n-signature',
};

const FAQ_WORKFLOW_URL = 'https://bizzybee.app.n8n.cloud/webhook/faq-generation';

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

async function triggerFaqWorkflow(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  callbackUrl: string,
  details: Record<string, unknown>
) {
  console.log(`[n8n-callback] discovery_complete for workspace=${workspaceId}, triggering FAQ workflow`);

  const { data: competitors, error: fetchError } = await supabase
    .from('competitor_sites')
    .select('id, business_name, domain, url, address, rating, reviews_count, phone')
    .eq('workspace_id', workspaceId)
    .in('status', ['discovered', 'validated', 'approved'])
    .order('created_at', { ascending: false })
    .limit(100);

  if (fetchError) {
    console.error('[n8n-callback] Failed to fetch competitors:', fetchError);
    return;
  }

  if (!competitors || competitors.length === 0) {
    console.warn('[n8n-callback] No competitors found to scrape');
    await supabase.from('n8n_workflow_progress').upsert({
      workspace_id: workspaceId,
      workflow_type: 'competitor_scrape',
      status: 'complete',
      details: { message: 'No competitors to scrape', competitors_found: 0 },
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,workflow_type' });
    return;
  }

  const { data: context } = await supabase
    .from('business_context')
    .select('business_type, company_name')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  await supabase.from('n8n_workflow_progress').upsert({
    workspace_id: workspaceId,
    workflow_type: 'competitor_scrape',
    status: 'pending',
    details: {
      message: `Queued ${competitors.length} competitors for scraping & FAQ extraction`,
      total: competitors.length,
      competitors_found: details.competitors_found || competitors.length,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id,workflow_type' });

  const payload = {
    workspace_id: workspaceId,
    business_type: context?.business_type || '',
    business_name: context?.company_name || '',
    competitors: competitors.map(c => ({
      id: c.id,
      business_name: c.business_name,
      domain: c.domain,
      url: c.url,
      address: c.address,
      rating: c.rating,
      reviews_count: c.reviews_count,
      phone: c.phone,
    })),
    callback_url: callbackUrl,
  };

  try {
    const response = await fetch(FAQ_WORKFLOW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`[n8n-callback] FAQ workflow triggered: status=${response.status}, competitors=${competitors.length}`);
  } catch (err) {
    console.error('[n8n-callback] Failed to trigger FAQ workflow:', err);
    await supabase.from('n8n_workflow_progress').upsert({
      workspace_id: workspaceId,
      workflow_type: 'competitor_scrape',
      status: 'failed',
      details: { message: 'Failed to trigger FAQ generation workflow', error: String(err) },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,workflow_type' });
  }
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

    // Bug 1 Fix: Only verify signature if BOTH the secret is configured AND the header is present
    const signature = req.headers.get('x-n8n-signature') || '';
    if (n8nSecret && signature) {
      if (!(await verifyN8nSignature(rawBody, signature, n8nSecret))) {
        console.error('[n8n-callback] Invalid webhook signature');
        return new Response(
          JSON.stringify({ error: 'Unauthorized: invalid signature' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log('[n8n-callback] Signature verified successfully');
    } else {
      console.log('[n8n-callback] Skipping signature verification (no secret or no header)');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = JSON.parse(rawBody);
    const { 
      workspace_id, status, message,
      competitors_found, competitors_scraped,
      verified_count, probable_count, hallucinations_caught,
      live_domains, dead_domains, scraped, failed,
      faq_count, competitor_count, claude_found, gemini_found,
      current, total, current_competitor,
      error: errorMsg
    } = body;

    if (!workspace_id) {
      return new Response(
        JSON.stringify({ error: 'workspace_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[n8n-callback] workspace=${workspace_id} status=${status} message=${message}`);

    const scrapeStatuses = ['scraping', 'extracting', 'scrape_processing', 'scrape_complete'];
    const workflowType = scrapeStatuses.includes(status) ? 'competitor_scrape' : 'competitor_discovery';

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
    if (current !== undefined) details.current = current;
    if (total !== undefined) details.total = total;
    if (current_competitor !== undefined) details.current_competitor = current_competitor;
    if (errorMsg) details.error = errorMsg;

    const isComplete = status === 'discovery_complete' || status === 'complete' || status === 'scrape_complete';
    const dbStatus = isComplete ? 'complete' : (status || 'in_progress');

    const { error: upsertError } = await supabase
      .from('n8n_workflow_progress')
      .upsert({
        workspace_id,
        workflow_type: workflowType,
        status: dbStatus,
        details,
        updated_at: new Date().toISOString(),
        completed_at: isComplete ? new Date().toISOString() : null,
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

    // Bug 10 Fix: Idempotency guard — only trigger FAQ workflow if not already running
    if (status === 'discovery_complete') {
      const { data: existingScrape } = await supabase
        .from('n8n_workflow_progress')
        .select('status')
        .eq('workspace_id', workspace_id)
        .eq('workflow_type', 'competitor_scrape')
        .maybeSingle();

      const alreadyRunning = existingScrape?.status && 
        !['waiting', 'failed', 'complete'].includes(existingScrape.status as string);

      if (alreadyRunning) {
        console.log(`[n8n-callback] Skipping FAQ trigger — scrape already in status: ${existingScrape.status}`);
      } else {
        const callbackUrl = body.callback_url || `${supabaseUrl}/functions/v1/n8n-competitor-callback`;
        await triggerFaqWorkflow(supabase, workspace_id, callbackUrl, details);
      }
    }

    return new Response(
      JSON.stringify({ success: true, status, workspace_id, workflow_type: workflowType }),
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
