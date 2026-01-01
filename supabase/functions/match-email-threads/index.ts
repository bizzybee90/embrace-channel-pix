import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspace_id } = await req.json();
    console.log("[match-email-threads] Starting for workspace:", workspace_id);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Update progress
    await supabase.from("onboarding_progress").update({
      thread_matching_status: "running",
      thread_matching_progress: 0,
    }).eq("workspace_id", workspace_id);

    await supabase.from("email_provider_configs").update({
      sync_stage: "matching_threads",
    }).eq("workspace_id", workspace_id);

    // Get all conversations with their messages for this workspace
    const { data: conversations, error: convError } = await supabase
      .from("conversations")
      .select(`
        id,
        customer_id,
        metadata,
        messages (
          id,
          direction,
          body,
          actor_name,
          created_at
        )
      `)
      .eq("workspace_id", workspace_id)
      .eq("channel", "email")
      .order("created_at", { ascending: false });

    if (convError) {
      console.error("[match-email-threads] Error fetching conversations:", convError);
      throw convError;
    }

    console.log(`[match-email-threads] Found ${conversations?.length || 0} conversations`);

    let pairsMatched = 0;
    let ignoredCount = 0;
    let totalResponseTimeMinutes = 0;
    let responseCount = 0;

    // Process each conversation
    for (let i = 0; i < (conversations?.length || 0); i++) {
      const conv = conversations![i];
      const messages = conv.messages || [];
      
      // Sort messages by created_at
      messages.sort((a: any, b: any) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      // Find inbound messages and their following outbound replies
      for (let j = 0; j < messages.length; j++) {
        const msg = messages[j];
        if (msg.direction !== "inbound") continue;

        // Find the next outbound message after this inbound
        const nextOutbound = messages.slice(j + 1).find((m: any) => m.direction === "outbound");

        if (nextOutbound) {
          // Calculate response time
          const inboundTime = new Date(msg.created_at).getTime();
          const outboundTime = new Date(nextOutbound.created_at).getTime();
          const responseTimeMinutes = Math.round((outboundTime - inboundTime) / 60000);

          // Create email pair
          const { error: pairError } = await supabase.from("email_pairs").insert({
            workspace_id,
            conversation_id: conv.id,
            inbound_message_id: msg.id,
            inbound_from: msg.actor_name,
            inbound_body: msg.body?.substring(0, 5000),
            inbound_received_at: msg.created_at,
            outbound_message_id: nextOutbound.id,
            outbound_body: nextOutbound.body?.substring(0, 5000),
            outbound_sent_at: nextOutbound.created_at,
            response_time_minutes: responseTimeMinutes,
            response_word_count: (nextOutbound.body || "").split(/\s+/).length,
          });

          if (!pairError) {
            pairsMatched++;
            totalResponseTimeMinutes += responseTimeMinutes;
            responseCount++;
          }
        } else {
          // No reply found - this email was ignored
          const fromDomain = (msg.actor_name || "").split("@")[1] || "unknown";
          
          await supabase.from("ignored_emails").insert({
            workspace_id,
            inbound_message_id: msg.id,
            from_domain: fromDomain,
            ignore_reason: "no_reply",
          });
          
          ignoredCount++;
        }
      }

      // Update progress every 50 conversations
      if (i % 50 === 0) {
        const progress = Math.round((i / conversations!.length) * 100);
        await supabase.from("onboarding_progress").update({
          thread_matching_progress: progress,
          pairs_matched: pairsMatched,
        }).eq("workspace_id", workspace_id);
      }
    }

    // Calculate response rate
    const totalInbound = pairsMatched + ignoredCount;
    const responseRatePercent = totalInbound > 0 
      ? Math.round((pairsMatched / totalInbound) * 100) 
      : 0;
    const avgResponseTimeHours = responseCount > 0 
      ? Math.round((totalResponseTimeMinutes / responseCount) / 60 * 10) / 10 
      : 0;

    console.log(`[match-email-threads] Complete: ${pairsMatched} pairs, ${ignoredCount} ignored, ${responseRatePercent}% response rate`);

    // Update progress to complete
    await supabase.from("onboarding_progress").update({
      thread_matching_status: "completed",
      thread_matching_progress: 100,
      pairs_matched: pairsMatched,
      response_rate_percent: responseRatePercent,
      avg_response_time_hours: avgResponseTimeHours,
      ignored_email_count: ignoredCount,
      categorization_status: "running",
    }).eq("workspace_id", workspace_id);

    await supabase.from("email_provider_configs").update({
      sync_stage: "categorizing_emails",
    }).eq("workspace_id", workspace_id);

    // Trigger categorization if we have enough pairs
    if (pairsMatched >= 10) {
      console.log("[match-email-threads] Starting categorization phase...");
      supabase.functions.invoke("categorize-email-pairs", {
        body: { workspace_id }
      }).catch(err => console.error("Categorization failed:", err));
    } else {
      // Skip to style analysis with limited data
      console.log("[match-email-threads] Not enough pairs for categorization, going to style analysis");
      supabase.functions.invoke("analyze-voice-profile", {
        body: { workspace_id }
      }).catch(err => console.error("Voice analysis failed:", err));
    }

    return new Response(JSON.stringify({
      success: true,
      pairsMatched,
      ignoredCount,
      responseRatePercent,
      avgResponseTimeHours,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[match-email-threads] Error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
