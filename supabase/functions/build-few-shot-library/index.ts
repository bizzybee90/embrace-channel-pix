import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXAMPLES_PER_CATEGORY = 10;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspace_id } = await req.json();
    console.log("[build-few-shot-library] Starting for workspace:", workspace_id);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Update progress
    await supabase.from("onboarding_progress").update({
      few_shot_status: "running",
    }).eq("workspace_id", workspace_id);

    await supabase.from("email_provider_configs").update({
      sync_stage: "building_examples",
    }).eq("workspace_id", workspace_id);

    // Get distinct categories
    const { data: categoryData } = await supabase
      .from("email_pairs")
      .select("category")
      .eq("workspace_id", workspace_id)
      .not("category", "is", null);

    const categories = [...new Set(categoryData?.map(c => c.category) || [])];
    console.log(`[build-few-shot-library] Found ${categories.length} categories`);

    let totalExamples = 0;

    // For each category, select top examples
    for (const category of categories) {
      // Get top pairs by quality score for this category
      const { data: topPairs } = await supabase
        .from("email_pairs")
        .select("id, inbound_body, outbound_body, quality_score, led_to_booking")
        .eq("workspace_id", workspace_id)
        .eq("category", category)
        .order("led_to_booking", { ascending: false, nullsFirst: false })
        .order("quality_score", { ascending: false, nullsFirst: false })
        .limit(EXAMPLES_PER_CATEGORY);

      if (!topPairs || topPairs.length === 0) continue;

      // Insert as few-shot examples
      for (let i = 0; i < topPairs.length; i++) {
        const pair = topPairs[i];
        
        const { error } = await supabase.from("few_shot_examples").insert({
          workspace_id,
          email_pair_id: pair.id,
          category,
          inbound_text: pair.inbound_body,
          outbound_text: pair.outbound_body,
          quality_score: pair.quality_score || 5,
          rank_in_category: i + 1,
          selection_reason: pair.led_to_booking 
            ? "led_to_booking" 
            : pair.quality_score >= 7 
              ? "high_quality" 
              : "representative",
        });

        if (!error) totalExamples++;
      }
    }

    console.log(`[build-few-shot-library] Created ${totalExamples} examples across ${categories.length} categories`);

    // Mark complete
    await supabase.from("onboarding_progress").update({
      few_shot_status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("workspace_id", workspace_id);

    await supabase.from("email_provider_configs").update({
      sync_stage: "complete",
      voice_profile_status: "complete",
    }).eq("workspace_id", workspace_id);

    return new Response(JSON.stringify({
      success: true,
      totalExamples,
      categories: categories.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[build-few-shot-library] Error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
