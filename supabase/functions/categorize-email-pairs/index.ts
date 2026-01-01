import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 30; // Process 30 pairs at a time to stay within token limits

function buildCategorizationPrompt(pairs: any[]): string {
  return `Analyze these email conversations and categorize them.

For each pair, provide:
1. category: quote_request | complaint | booking_change | payment | general_inquiry | job_application | supplier | marketing | other
2. subcategory: more specific classification (e.g., "price_inquiry", "schedule_change", "refund_request")
3. inbound_sentiment: positive | neutral | negative | urgent
4. response_quality: 1-10 (clarity, helpfulness, professionalism)
5. key_elements: array of what the response included (e.g., ["specific_price", "availability", "call_to_action"])
6. has_price: boolean - does the response mention a price?
7. has_cta: boolean - does the response have a call to action (book now, call me, reply, etc.)?
8. has_question: boolean - does the response ask a follow-up question?

EMAIL PAIRS TO ANALYZE:
${pairs.map((p, i) => `
--- Pair ${i} (ID: ${p.id}) ---
INBOUND: ${(p.inbound_body || "").substring(0, 400)}
RESPONSE: ${(p.outbound_body || "").substring(0, 400)}
RESPONSE TIME: ${p.response_time_minutes} minutes
`).join("\n")}

Return ONLY a JSON array with analysis for each pair (use the pair index, not the ID):
[
  {
    "index": 0,
    "category": "quote_request",
    "subcategory": "window_cleaning_quote",
    "inbound_sentiment": "neutral",
    "response_quality": 8,
    "key_elements": ["specific_price", "availability", "call_to_action"],
    "has_price": true,
    "has_cta": true,
    "has_question": false
  }
]`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspace_id } = await req.json();
    console.log("[categorize-email-pairs] Starting for workspace:", workspace_id);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!ANTHROPIC_API_KEY) {
      console.error("[categorize-email-pairs] Missing ANTHROPIC_API_KEY");
      // Skip categorization, go to style analysis
      await supabase.from("onboarding_progress").update({
        categorization_status: "skipped",
      }).eq("workspace_id", workspace_id);
      
      supabase.functions.invoke("analyze-voice-profile", {
        body: { workspace_id }
      }).catch(err => console.error("Voice analysis failed:", err));
      
      return new Response(JSON.stringify({ skipped: true, reason: "No API key" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get uncategorized pairs
    const { data: pairs, error: pairsError } = await supabase
      .from("email_pairs")
      .select("id, inbound_body, outbound_body, response_time_minutes")
      .eq("workspace_id", workspace_id)
      .is("category", null)
      .limit(500); // Process up to 500 pairs

    if (pairsError) throw pairsError;

    if (!pairs || pairs.length === 0) {
      console.log("[categorize-email-pairs] No pairs to categorize");
      await supabase.from("onboarding_progress").update({
        categorization_status: "completed",
        categorization_progress: 100,
      }).eq("workspace_id", workspace_id);
      
      // Move to style analysis
      supabase.functions.invoke("analyze-voice-profile", {
        body: { workspace_id }
      }).catch(err => console.error("Voice analysis failed:", err));
      
      return new Response(JSON.stringify({ success: true, categorized: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[categorize-email-pairs] Processing ${pairs.length} pairs`);

    let categorized = 0;
    const totalBatches = Math.ceil(pairs.length / BATCH_SIZE);

    // Process in batches
    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batchStart = batchIdx * BATCH_SIZE;
      const batch = pairs.slice(batchStart, batchStart + BATCH_SIZE);
      
      console.log(`[categorize-email-pairs] Processing batch ${batchIdx + 1}/${totalBatches}`);

      const prompt = buildCategorizationPrompt(batch);

      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4000,
            messages: [{
              role: "user",
              content: prompt,
            }],
          }),
        });

        if (!response.ok) {
          console.error(`[categorize-email-pairs] API error: ${response.status}`);
          continue;
        }

        const data = await response.json();
        const content = data.content?.[0]?.text || "";

        // Extract JSON from response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          console.error("[categorize-email-pairs] No JSON found in response");
          continue;
        }

        const results = JSON.parse(jsonMatch[0]);

        // Update each pair with its category
        for (const result of results) {
          const pair = batch[result.index];
          if (!pair) continue;

          await supabase.from("email_pairs").update({
            category: result.category,
            subcategory: result.subcategory,
            sentiment_inbound: result.inbound_sentiment,
            quality_score: result.response_quality,
            response_has_price: result.has_price,
            response_has_cta: result.has_cta,
            response_has_question: result.has_question,
          }).eq("id", pair.id);

          categorized++;
        }

      } catch (err) {
        console.error(`[categorize-email-pairs] Batch ${batchIdx} error:`, err);
      }

      // Update progress
      const progress = Math.round(((batchIdx + 1) / totalBatches) * 100);
      await supabase.from("onboarding_progress").update({
        categorization_progress: progress,
        pairs_categorized: categorized,
      }).eq("workspace_id", workspace_id);
    }

    console.log(`[categorize-email-pairs] Complete: ${categorized} pairs categorized`);

    // Get category distribution for insights
    const { data: categoryStats } = await supabase
      .from("email_pairs")
      .select("category")
      .eq("workspace_id", workspace_id)
      .not("category", "is", null);

    const categoryCounts: Record<string, number> = {};
    categoryStats?.forEach(p => {
      categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
    });

    const topCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    // Update progress to complete
    await supabase.from("onboarding_progress").update({
      categorization_status: "completed",
      categorization_progress: 100,
      pairs_categorized: categorized,
      top_categories: topCategories,
      style_analysis_status: "running",
    }).eq("workspace_id", workspace_id);

    await supabase.from("email_provider_configs").update({
      sync_stage: "analyzing_style",
    }).eq("workspace_id", workspace_id);

    // Trigger style analysis
    console.log("[categorize-email-pairs] Starting style analysis...");
    supabase.functions.invoke("analyze-voice-profile", {
      body: { workspace_id }
    }).catch(err => console.error("Voice analysis failed:", err));

    return new Response(JSON.stringify({
      success: true,
      categorized,
      topCategories,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[categorize-email-pairs] Error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
