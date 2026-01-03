import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Use EdgeRuntime.waitUntil when available so we can continue work after responding
const waitUntil = (promise: Promise<unknown>) => {
  const er = (globalThis as any).EdgeRuntime;
  if (er?.waitUntil) return er.waitUntil(promise);
  promise.catch((e) => console.error("[scrape-customer-website] background error", e));
};

type StartBody = {
  workspaceId: string;
  websiteUrl: string;
  businessName?: string;
  businessType?: string;
};

async function processScrape(params: StartBody) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

  const { workspaceId, websiteUrl, businessName, businessType } = params;

  if (!websiteUrl) return;
  if (!APIFY_API_KEY) throw new Error("Apify API key not configured");
  if (!ANTHROPIC_API_KEY) throw new Error("Anthropic not configured");
  if (!OPENAI_API_KEY) throw new Error("OpenAI not configured");

  // Format URL
  let formattedUrl = websiteUrl.trim();
  if (!formattedUrl.startsWith("http://") && !formattedUrl.startsWith("https://")) {
    formattedUrl = `https://${formattedUrl}`;
  }

  console.log("[scrape-customer-website] Starting Apify website-content-crawler...", formattedUrl);

  // Update status to scraping
  await supabase
    .from("business_context")
    .update({
      knowledge_base_status: "scraping",
      knowledge_base_started_at: new Date().toISOString(),
      custom_flags: {
        website_scrape: {
          url: formattedUrl,
          pages_scraped: 0,
          status: "crawling",
        },
      },
    })
    .eq("workspace_id", workspaceId);

  // Call Apify Website Content Crawler (synchronous run)
  const apifyResponse = await fetch(
    `https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: formattedUrl }],
        maxCrawlPages: 30, // Crawl up to 30 pages
        maxCrawlDepth: 3,
        crawlerType: "cheerio", // Fast, lightweight
        includeUrlGlobs: [],
        excludeUrlGlobs: [
          "**/privacy**", "**/terms**", "**/cookie**",
          "**/login**", "**/register**", "**/cart**",
          "**/checkout**", "**/*.pdf", "**/*.jpg", "**/*.png",
          "**/wp-admin**", "**/wp-login**",
        ],
      }),
    }
  );

  if (!apifyResponse.ok) {
    const errorText = await apifyResponse.text();
    console.error("[scrape-customer-website] Apify error:", apifyResponse.status, errorText);
    throw new Error(`Apify error: ${apifyResponse.status}`);
  }

  const crawlData = await apifyResponse.json();
  console.log(`[scrape-customer-website] Apify returned ${crawlData.length} pages`);

  if (!crawlData || crawlData.length === 0) {
    console.log("[scrape-customer-website] No content found from crawl");
    await supabase
      .from("business_context")
      .update({
        knowledge_base_status: "complete",
        knowledge_base_completed_at: new Date().toISOString(),
        website_faqs_generated: 0,
        custom_flags: {
          website_scrape: {
            url: formattedUrl,
            pages_scraped: 0,
            status: "complete",
          },
        },
      })
      .eq("workspace_id", workspaceId);
    return;
  }

  // Update pages scraped count
  await supabase
    .from("business_context")
    .update({
      custom_flags: {
        website_scrape: {
          url: formattedUrl,
          pages_scraped: crawlData.length,
          status: "extracting",
        },
      },
    })
    .eq("workspace_id", workspaceId);

  // Build prompt content from Apify results
  const allContent = crawlData
    .map((page: any) => {
      const url = page.url || "";
      const text = page.text || "";
      return `--- PAGE: ${url} ---\n${text}`;
    })
    .filter((c: string) => c.length > 100)
    .join("\n\n")
    .slice(0, 80000);

  const prompt = `You are extracting FAQs from a ${businessType || "business"} website for "${businessName || "this business"}".

Your goal is to generate as many SPECIFIC, USEFUL Q&A pairs as possible. These FAQs will be used by an AI to answer customer questions, so they must contain EXACT information.

WEBSITE CONTENT:
${allContent}

EXTRACT FAQs FOR EACH CATEGORY:

**PRICING** (generate multiple FAQs per service):
- What is the exact price for [service]? Include currency (£) and any variations
- What are the minimum charges?
- Are there any additional fees?
- Payment methods accepted?

**SERVICES** (one FAQ per distinct service):
- What does [service name] include?
- How long does [service] take?

**COVERAGE AREA**:
- What areas do you cover? (list all postcodes/towns mentioned)

**BOOKING & AVAILABILITY**:
- How do I book?
- What's your cancellation policy?
- What are your opening hours?

**ABOUT THE BUSINESS**:
- Are you insured?

RULES:
1. Use EXACT figures from the website
2. Be specific and factual
3. Generate at least 20 FAQs if sufficient content exists

OUTPUT FORMAT (JSON array only, no other text):
[
  {"question": "...", "answer": "...", "category": "pricing", "tags": ["..."]}
]`;

  console.log("[scrape-customer-website] Calling Claude for FAQ extraction...");

  const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 6000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!claudeResponse.ok) {
    const errorText = await claudeResponse.text();
    console.error("[scrape-customer-website] Claude API error:", claudeResponse.status, errorText);
    throw new Error(`Claude API error: ${claudeResponse.status}`);
  }

  const claudeData = await claudeResponse.json();
  const content = claudeData.content?.[0]?.text || "";

  let faqs: any[] = [];
  try {
    const match = content.match(/\[[\s\S]*\]/);
    if (match) faqs = JSON.parse(match[0]);
  } catch (e) {
    console.error("[scrape-customer-website] Error parsing Claude response:", e);
  }

  console.log(`[scrape-customer-website] Extracted ${faqs.length} FAQs`);

  if (faqs.length === 0) {
    await supabase
      .from("business_context")
      .update({
        knowledge_base_status: "complete",
        knowledge_base_completed_at: new Date().toISOString(),
        website_faqs_generated: 0,
        custom_flags: {
          website_scrape: {
            url: formattedUrl,
            pages_scraped: crawlData.length,
            status: "complete",
          },
        },
      })
      .eq("workspace_id", workspaceId);
    return;
  }

  // Embeddings + insert with priority = 10 (own website = highest priority)
  const faqsToInsert: any[] = [];

  for (const faq of faqs) {
    if (!faq?.question || !faq?.answer) continue;

    const embResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: `${faq.question} ${faq.answer}`,
      }),
    });

    if (!embResponse.ok) {
      const errorText = await embResponse.text();
      console.error("[scrape-customer-website] OpenAI embedding error:", embResponse.status, errorText);
      continue;
    }

    const embData = await embResponse.json();
    const embedding = embData?.data?.[0]?.embedding;
    if (!embedding) continue;

    faqsToInsert.push({
      question: faq.question,
      answer: faq.answer,
      category: faq.category || "general",
      keywords: faq.tags || [],
      embedding,
      workspace_id: workspaceId,
      is_own_content: true,
      is_industry_standard: false,
      source_company: businessName || null,
      source_url: formattedUrl,
      source: "own_website", // Mark as own website content
      generation_source: "website_scrape",
      priority: 10, // HIGHEST PRIORITY - business-specific content
      is_active: true,
      enabled: true,
    });
  }

  console.log(`[scrape-customer-website] Inserting ${faqsToInsert.length} FAQs with priority=10`);

  if (faqsToInsert.length > 0) {
    const { error: insertError } = await supabase.from("faq_database").insert(faqsToInsert);
    if (insertError) throw insertError;
  }

  await supabase
    .from("business_context")
    .update({
      knowledge_base_status: "complete",
      knowledge_base_completed_at: new Date().toISOString(),
      website_faqs_generated: faqsToInsert.length,
      custom_flags: {
        website_scrape: {
          url: formattedUrl,
          pages_scraped: crawlData.length,
          faqs_generated: faqsToInsert.length,
          status: "complete",
        },
      },
    })
    .eq("workspace_id", workspaceId);

  console.log("[scrape-customer-website] Completed successfully");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: StartBody | null = null;

  try {
    body = (await req.json()) as StartBody;

    const { workspaceId, websiteUrl, businessName, businessType } = body;

    if (!websiteUrl) {
      return new Response(
        JSON.stringify({ success: true, faqsGenerated: 0, pagesScraped: 0, message: "No website URL provided" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Kick off the background job and respond immediately so the browser doesn't time out.
    waitUntil(
      (async () => {
        try {
          await processScrape({ workspaceId, websiteUrl, businessName, businessType });
        } catch (e: any) {
          console.error("[scrape-customer-website] Fatal error:", e);

          try {
            const supabase = createClient(
              Deno.env.get("SUPABASE_URL")!,
              Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
            );
            await supabase
              .from("business_context")
              .update({ 
                knowledge_base_status: "error",
                custom_flags: {
                  website_scrape: {
                    status: "error",
                    error: e.message,
                  },
                },
              })
              .eq("workspace_id", workspaceId);
          } catch {
            // ignore
          }
        }
      })()
    );

    return new Response(
      JSON.stringify({ success: true, status: "scraping" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[scrape-customer-website] Request error:", error);
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
