import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'kb-mine-site';
const FIRECRAWL_API = 'https://api.firecrawl.dev/v1';
const LOVABLE_AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';

const MAX_PAGES_PER_SITE = 5;

// Priority page patterns for FAQ extraction
const PRIORITY_PATTERNS = [
  /faq/i, /questions/i, /help/i, /pricing/i, /price/i,
  /rates/i, /services/i, /about/i, /how-it-works/i
];

interface GroundTruthFact {
  fact_type: string;
  fact_key: string;
  fact_value: string;
}

interface ExtractedFAQ {
  question: string;
  answer: string;
  category: string;
}

interface ValidationResult {
  relevant: boolean;
  reason: string;
  modified_answer?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!firecrawlApiKey) throw new Error('FIRECRAWL_API_KEY not configured');
    if (!lovableApiKey) throw new Error('LOVABLE_API_KEY not configured');

    const { site_id, workspace_id, job_id } = await req.json();

    if (!site_id) throw new Error('site_id is required');
    if (!workspace_id) throw new Error('workspace_id is required');

    console.log(`[${FUNCTION_NAME}] Mining site:`, site_id);

    // Load site record
    const { data: site, error: siteError } = await supabase
      .from('competitor_sites')
      .select('*')
      .eq('id', site_id)
      .single();

    if (siteError || !site) {
      throw new Error(`Site not found: ${siteError?.message || 'Unknown'}`);
    }

    // Update site status
    await supabase
      .from('competitor_sites')
      .update({ scrape_status: 'scraping' })
      .eq('id', site_id);

    // Load Ground Truth for validation
    const { data: groundTruth } = await supabase
      .from('ground_truth_facts')
      .select('fact_type, fact_key, fact_value')
      .eq('workspace_id', workspace_id);

    // Load Voice Profile for tailoring
    const { data: voiceProfile } = await supabase
      .from('voice_profiles')
      .select('tone, greeting_style, sample_phrases')
      .eq('workspace_id', workspace_id)
      .single();

    // Load business profile for context
    const { data: profile } = await supabase
      .from('business_profile')
      .select('business_name, services, service_area')
      .eq('workspace_id', workspace_id)
      .single();

    console.log(`[${FUNCTION_NAME}] Ground truth: ${groundTruth?.length || 0} facts, Voice: ${voiceProfile?.tone || 'none'}`);

    // -------------------------------------------------------------------------
    // Step 1: Map site to find priority pages
    // -------------------------------------------------------------------------
    let pagesToScrape: string[] = [site.url];

    try {
      const mapResponse = await fetch(`${FIRECRAWL_API}/map`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url: site.url, limit: 50 })
      });

      if (mapResponse.ok) {
        const mapData = await mapResponse.json();
        const allLinks: string[] = mapData.links || mapData.data?.links || [];
        
        // Filter to priority pages
        const priorityPages = allLinks.filter(link =>
          PRIORITY_PATTERNS.some(pattern => pattern.test(link))
        );

        pagesToScrape = [...new Set([site.url, ...priorityPages])].slice(0, MAX_PAGES_PER_SITE);
        console.log(`[${FUNCTION_NAME}] Found ${pagesToScrape.length} priority pages for ${site.domain}`);
      }
    } catch (mapErr) {
      console.warn(`[${FUNCTION_NAME}] Map failed, using single page:`, mapErr);
    }

    // -------------------------------------------------------------------------
    // Step 2: Scrape priority pages
    // -------------------------------------------------------------------------
    let combinedContent = '';

    for (const pageUrl of pagesToScrape) {
      try {
        const scrapeResponse = await fetch(`${FIRECRAWL_API}/scrape`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: pageUrl,
            formats: ['markdown'],
            onlyMainContent: true
          })
        });

        if (scrapeResponse.ok) {
          const scrapeData = await scrapeResponse.json();
          const markdown = scrapeData.data?.markdown || '';
          if (markdown.length > 100) {
            combinedContent += `\n\n## PAGE: ${pageUrl}\n${markdown}`;
          }
        }
      } catch (scrapeErr) {
        console.warn(`[${FUNCTION_NAME}] Scrape failed for ${pageUrl}:`, scrapeErr);
      }
    }

    if (combinedContent.length < 200) {
      await supabase
        .from('competitor_sites')
        .update({
          scrape_status: 'failed',
          last_error: 'Insufficient content extracted'
        })
        .eq('id', site_id);

      return new Response(
        JSON.stringify({
          success: false,
          site_id,
          domain: site.domain,
          error: 'Insufficient content extracted',
          faqs_found: 0,
          faqs_validated: 0,
          faqs_added: 0
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[${FUNCTION_NAME}] Scraped ${combinedContent.length} chars from ${site.domain}`);

    // -------------------------------------------------------------------------
    // Step 3: Extract FAQs with AI
    // -------------------------------------------------------------------------
    const extractPrompt = `Extract FAQ-style questions and answers from this competitor website content.

WEBSITE: ${site.domain}
CONTENT:
${combinedContent.substring(0, 50000)}

Create 10-20 FAQ entries based on the content. Focus on:
- Services offered
- Pricing and rates
- Service areas
- Policies (cancellation, booking, payment)
- Process/how it works
- Guarantees and certifications

Respond with JSON array only:
[
  { "question": "...", "answer": "...", "category": "Services" }
]`;

    const extractResponse = await fetch(LOVABLE_AI_GATEWAY, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You extract FAQs from website content. Return valid JSON array only.' },
          { role: 'user', content: extractPrompt }
        ]
      })
    });

    if (!extractResponse.ok) {
      throw new Error(`AI extraction failed: ${extractResponse.status}`);
    }

    const extractData = await extractResponse.json();
    const extractContent = extractData.choices?.[0]?.message?.content || '';

    let rawFaqs: ExtractedFAQ[] = [];
    try {
      const jsonMatch = extractContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        rawFaqs = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.warn(`[${FUNCTION_NAME}] Parse error:`, parseErr);
    }

    console.log(`[${FUNCTION_NAME}] Extracted ${rawFaqs.length} FAQs from ${site.domain}`);

    // -------------------------------------------------------------------------
    // Step 4: Validate FAQs against Ground Truth
    // -------------------------------------------------------------------------
    const validatedFaqs: Array<ExtractedFAQ & { validation_notes: string }> = [];
    const skippedFaqs: Array<{ question: string; reason: string }> = [];

    if (rawFaqs.length > 0 && groundTruth && groundTruth.length > 0) {
      // Build ground truth context
      const gtContext = buildGroundTruthContext(groundTruth);

      for (const faq of rawFaqs) {
        const validation = await validateFAQ(faq, gtContext, profile, lovableApiKey);
        
        if (validation.relevant) {
          validatedFaqs.push({
            ...faq,
            answer: validation.modified_answer || faq.answer,
            validation_notes: validation.reason
          });
        } else {
          skippedFaqs.push({ question: faq.question, reason: validation.reason });
        }
      }
    } else {
      // No ground truth - accept all FAQs
      for (const faq of rawFaqs) {
        validatedFaqs.push({ ...faq, validation_notes: 'No ground truth validation' });
      }
    }

    console.log(`[${FUNCTION_NAME}] Validated ${validatedFaqs.length}/${rawFaqs.length} FAQs`);

    // -------------------------------------------------------------------------
    // Step 5: Tailor FAQs to user's voice
    // -------------------------------------------------------------------------
    let tailoredFaqs = validatedFaqs;

    if (voiceProfile && validatedFaqs.length > 0) {
      tailoredFaqs = await tailorFAQsToVoice(validatedFaqs, voiceProfile, profile, lovableApiKey);
    }

    // -------------------------------------------------------------------------
    // Step 6: Save to knowledge_base_faqs with priority 5
    // -------------------------------------------------------------------------
    let faqsAdded = 0;

    if (tailoredFaqs.length > 0) {
      const faqsToInsert = tailoredFaqs.map(faq => ({
        workspace_id,
        question: faq.question.slice(0, 500),
        answer: faq.answer.slice(0, 2000),
        category: faq.category || 'General',
        source: 'competitor',
        source_url: site.url,
        source_domain: site.domain,
        priority: 5,
        is_validated: true,
        validation_notes: faq.validation_notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      const { error: insertError, data: inserted } = await supabase
        .from('knowledge_base_faqs')
        .upsert(faqsToInsert, { onConflict: 'workspace_id,question' })
        .select('id');

      if (insertError) {
        console.error(`[${FUNCTION_NAME}] Insert error:`, insertError);
      } else {
        faqsAdded = inserted?.length || 0;
      }
    }

    // -------------------------------------------------------------------------
    // Step 7: Update site record
    // -------------------------------------------------------------------------
    await supabase
      .from('competitor_sites')
      .update({
        scrape_status: 'scraped',
        pages_scraped: pagesToScrape.length,
        content_extracted: combinedContent.substring(0, 10000),
        faqs_generated: rawFaqs.length,
        faqs_validated: validatedFaqs.length,
        faqs_added: faqsAdded,
        scraped_at: new Date().toISOString()
      })
      .eq('id', site_id);

    // Update job totals if job_id provided
    if (job_id) {
      const { data: jobData } = await supabase
        .from('competitor_research_jobs')
        .select('sites_scraped, faqs_extracted, faqs_generated, faqs_added')
        .eq('id', job_id)
        .single();

      await supabase
        .from('competitor_research_jobs')
        .update({
          sites_scraped: (jobData?.sites_scraped || 0) + 1,
          faqs_extracted: (jobData?.faqs_extracted || 0) + rawFaqs.length,
          faqs_generated: (jobData?.faqs_generated || 0) + validatedFaqs.length,
          faqs_added: (jobData?.faqs_added || 0) + faqsAdded,
          heartbeat_at: new Date().toISOString()
        })
        .eq('id', job_id);
    }

    const duration = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Completed ${site.domain} in ${duration}ms: ${rawFaqs.length} → ${validatedFaqs.length} → ${faqsAdded}`);

    return new Response(
      JSON.stringify({
        success: true,
        site_id,
        domain: site.domain,
        pages_scraped: pagesToScrape.length,
        faqs_found: rawFaqs.length,
        faqs_validated: validatedFaqs.length,
        faqs_added: faqsAdded,
        skipped: skippedFaqs.slice(0, 5),
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[${FUNCTION_NAME}] Error:`, error.message);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: FUNCTION_NAME,
        duration_ms: duration
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function buildGroundTruthContext(facts: GroundTruthFact[]): string {
  const services = facts.filter(f => f.fact_type === 'service').map(f => f.fact_value);
  const areas = facts.filter(f => f.fact_type === 'service_area').map(f => `${f.fact_key}: ${f.fact_value}`);
  const prices = facts.filter(f => f.fact_type === 'price').map(f => `${f.fact_key}: ${f.fact_value}`);
  const policies = facts.filter(f => f.fact_type === 'policy').map(f => `${f.fact_key}: ${f.fact_value}`);

  return `
SERVICES OFFERED: ${services.join(', ') || 'Not specified'}
SERVICE AREA: ${areas.join('; ') || 'Not specified'}
PRICING: ${prices.join('; ') || 'Not specified'}
POLICIES: ${policies.join('; ') || 'Not specified'}
`.trim();
}

async function validateFAQ(
  faq: ExtractedFAQ,
  groundTruthContext: string,
  profile: any,
  apiKey: string
): Promise<ValidationResult> {
  const prompt = `Validate if this competitor FAQ is relevant for a business with these characteristics:

BUSINESS GROUND TRUTH:
${groundTruthContext}
Business Name: ${profile?.business_name || 'Unknown'}
Services: ${(profile?.services || []).join(', ') || 'Not specified'}

COMPETITOR FAQ TO VALIDATE:
Q: ${faq.question}
A: ${faq.answer}
Category: ${faq.category}

Rules:
1. RELEVANT if the FAQ is about a service/topic the business offers
2. NOT RELEVANT if it's about a service the business doesn't offer
3. NOT RELEVANT if it contradicts the business's ground truth (e.g., wrong prices, different areas)
4. If RELEVANT, optionally modify the answer to be generic (remove competitor-specific details)

Respond with JSON only:
{ "relevant": true/false, "reason": "brief explanation", "modified_answer": "optional revised answer" }`;

  try {
    const response = await fetch(LOVABLE_AI_GATEWAY, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: 'system', content: 'You validate FAQs against business ground truth. Return JSON only.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      return { relevant: true, reason: 'Validation API error - accepting by default' };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.warn('Validation error:', err);
  }

  return { relevant: true, reason: 'Validation failed - accepting by default' };
}

async function tailorFAQsToVoice(
  faqs: Array<ExtractedFAQ & { validation_notes: string }>,
  voice: { tone: string; greeting_style?: string; sample_phrases?: string[] },
  profile: any,
  apiKey: string
): Promise<Array<ExtractedFAQ & { validation_notes: string }>> {
  const prompt = `Rewrite these FAQs to match the business's voice/tone.

VOICE PROFILE:
Tone: ${voice.tone}
Greeting Style: ${voice.greeting_style || 'Standard'}
Sample Phrases: ${(voice.sample_phrases || []).join(', ') || 'None'}

BUSINESS: ${profile?.business_name || 'Our company'}

FAQs TO REWRITE:
${JSON.stringify(faqs, null, 2)}

Rewrite ONLY the answers to match the voice profile. Keep questions as-is.
Make answers sound like they come from "${profile?.business_name || 'this business'}".

Return JSON array with same structure.`;

  try {
    const response = await fetch(LOVABLE_AI_GATEWAY, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You rewrite FAQ answers to match a specific voice/tone. Return JSON array only.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      return faqs;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.warn('Voice tailoring error:', err);
  }

  return faqs;
}
