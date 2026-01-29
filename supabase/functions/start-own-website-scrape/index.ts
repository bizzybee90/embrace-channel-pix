import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'start-own-website-scrape';

// Edge runtime provides this globally; declare for TypeScript.
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspaceId, websiteUrl, forceProvider } = await req.json();
    
    if (!workspaceId) throw new Error('workspaceId is required');
    if (!websiteUrl) throw new Error('websiteUrl is required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

    if (!APIFY_API_KEY) throw new Error('APIFY_API_KEY not configured');

    const supabase = createClient(supabaseUrl, supabaseKey);

    // =========================================
    // STEP 1: Normalize URL
    // =========================================
    
    let baseUrl = websiteUrl.trim();
    if (!baseUrl.startsWith('http')) {
      baseUrl = 'https://' + baseUrl;
    }
    baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash

    console.log(`[${FUNCTION_NAME}] Starting scrape for:`, baseUrl);

    // =========================================
    // STEP 2: Create job record
    // =========================================
    
    const isFirecrawl = forceProvider === 'firecrawl';

    const { data: job, error: jobError } = await supabase
      .from('scraping_jobs')
      .insert({
        workspace_id: workspaceId,
        job_type: 'own_website',
        website_url: baseUrl,
        status: isFirecrawl ? 'processing' : 'scraping',
        started_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (jobError) throw new Error(`Failed to create job: ${jobError.message}`);

    console.log(`[${FUNCTION_NAME}] Created job:`, job.id);

    // =========================================
    // STEP 3: If forced to Firecrawl, kick processing immediately
    // =========================================

    if (isFirecrawl) {
      if (!FIRECRAWL_API_KEY) {
        throw new Error('Firecrawl connector not configured');
      }

      const invoke = await supabase.functions.invoke('process-own-website-scrape', {
        body: {
          jobId: job.id,
          workspaceId,
          datasetId: 'firecrawl',
          websiteUrl: baseUrl,
        },
      });

      if (invoke.error) {
        throw new Error(`Failed to start Firecrawl processing: ${invoke.error.message}`);
      }

      return new Response(JSON.stringify({
        success: true,
        jobId: job.id,
        status: 'processing',
        provider: 'firecrawl',
        message: 'Processing started using Firecrawl fallback.'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // =========================================
    // STEP 4: Build Apify configuration
    // =========================================
    
    // "Money Pages" - these are the pages we MUST capture
    const startUrls = [
      { url: baseUrl },
      { url: `${baseUrl}/pricing` },
      { url: `${baseUrl}/prices` },
      { url: `${baseUrl}/faq` },
      { url: `${baseUrl}/faqs` },
      { url: `${baseUrl}/services` },
      { url: `${baseUrl}/about` },
      { url: `${baseUrl}/about-us` },
      { url: `${baseUrl}/contact` },
      { url: `${baseUrl}/contact-us` },
      { url: `${baseUrl}/areas` },
      { url: `${baseUrl}/areas-covered` },
      { url: `${baseUrl}/coverage` },
    ];
    
    // Globs ensure these patterns are prioritized during crawl
    const globs = [
      { glob: '**/faq*' },
      { glob: '**/pricing*' },
      { glob: '**/prices*' },
      { glob: '**/cost*' },
      { glob: '**/services/**' },
      { glob: '**/about*' },
      { glob: '**/contact*' },
      { glob: '**/areas*' },
      { glob: '**/coverage*' },
      { glob: '**/booking*' },
      { glob: '**/quote*' },
    ];
    
    // Exclude low-value pages
    const excludeGlobs = [
      { glob: '**/blog/page/**' },
      { glob: '**/news/**' },
      { glob: '**/tag/**' },
      { glob: '**/category/**' },
      { glob: '**/*.pdf' },
      { glob: '**/wp-admin/**' },
      { glob: '**/wp-content/**' },
      { glob: '**/author/**' },
    ];

    const webhookUrl = `${supabaseUrl}/functions/v1/process-own-website-scrape?jobId=${job.id}`;
    const failedWebhookUrl = `${supabaseUrl}/functions/v1/handle-scrape-failed?jobId=${job.id}`;

    console.log(`[${FUNCTION_NAME}] Webhook URL:`, webhookUrl);

    // =========================================
    // STEP 5: Start Apify crawler
    // =========================================
    
    const apifyInput = {
      startUrls,
      globs,
      excludeGlobs,
      crawlerType: 'cheerio', // 10x faster and cheaper than browser
      maxCrawlDepth: 2,       // Home → Main Links → Stop
      maxCrawlPages: 30,
      saveHtml: false,
      saveMarkdown: true,
      removeCookieWarnings: true,
    };
    
    const apifyResponse = await fetch(
      `https://api.apify.com/v2/acts/apify~website-content-crawler/runs?token=${APIFY_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...apifyInput,
          webhooks: [
            {
              eventTypes: ['ACTOR.RUN.SUCCEEDED'],
              requestUrl: webhookUrl,
              payloadTemplate: JSON.stringify({
                jobId: job.id,
                workspaceId,
                runId: '{{runId}}',
                datasetId: '{{defaultDatasetId}}'
              })
            },
            {
              eventTypes: ['ACTOR.RUN.FAILED', 'ACTOR.RUN.ABORTED', 'ACTOR.RUN.TIMED_OUT'],
              requestUrl: failedWebhookUrl,
              payloadTemplate: JSON.stringify({
                jobId: job.id,
                error: '{{error}}'
              })
            }
          ]
        })
      }
    );
    
    if (!apifyResponse.ok) {
      const errorText = await apifyResponse.text();
      throw new Error(`Apify API error: ${errorText}`);
    }
    
    const apifyData = await apifyResponse.json();

    console.log(`[${FUNCTION_NAME}] Apify run started:`, apifyData.data?.id);

    // Update job with Apify run ID
    await supabase.from('scraping_jobs').update({
      apify_run_id: apifyData.data.id
    }).eq('id', job.id);

    // =========================================
    // STEP 5.5: Reliability watchdog
    // If Apify webhooks fail to deliver, poll the run status and trigger
    // processing once the dataset is ready.
    // =========================================

    EdgeRuntime.waitUntil((async () => {
      const runId = apifyData.data.id as string;
      const maxAttempts = 40; // ~20 minutes @ 30s

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await sleep(30_000);

        // If the job already moved on (webhook succeeded), stop polling
        const { data: current } = await supabase
          .from('scraping_jobs')
          .select('status, apify_dataset_id')
          .eq('id', job.id)
          .maybeSingle();

        if (!current) return;
        if (current.status !== 'scraping') return;

        const runResp = await fetch(
          `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`
        );
        const runJson = await runResp.json().catch(() => ({}));
        if (!runResp.ok) continue;

        const status = runJson?.data?.status;
        const datasetId = runJson?.data?.defaultDatasetId;

        if (status === 'SUCCEEDED' && datasetId) {
          console.log(`[${FUNCTION_NAME}] Watchdog triggering processing for job:`, job.id);
          await supabase.functions.invoke('process-own-website-scrape', {
            body: { jobId: job.id, workspaceId, datasetId },
          });
          return;
        }

        if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
          await supabase.from('scraping_jobs').update({
            status: 'failed',
            error_message: `Crawler ${status}`,
          }).eq('id', job.id);
          return;
        }
      }

      // Timeout: mark as failed so UI can surface retry.
      await supabase.from('scraping_jobs').update({
        status: 'failed',
        error_message: 'Crawler timed out (no completion signal received)',
      }).eq('id', job.id);
    })());

    // =========================================
    // DONE - Return immediately
    // =========================================
    
    return new Response(JSON.stringify({
      success: true,
      jobId: job.id,
      status: 'scraping',
      message: 'Scraping started. Subscribe to job updates for progress.'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Error:`, error.message);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
