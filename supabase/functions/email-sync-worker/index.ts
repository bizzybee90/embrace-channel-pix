import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Legacy worker kept only for backward compatibility.
 *
 * IMPORTANT:
 * This worker used to fetch full bodies for every email, which can trigger Aurinko 429 rate limits.
 * It now redirects to the 3-phase import pipeline:
 * start-email-import -> email-scan (metadata) -> email-analyze (threads) -> email-fetch-bodies (conversations only)
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId, configId } = await req.json();
    console.log("[email-sync-worker] Redirecting legacy job to 3-phase importer:", { jobId, configId });

    if (!jobId || !configId) {
      return new Response(JSON.stringify({ error: "Missing jobId or configId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Best-effort: read legacy job to forward mode
    const { data: legacyJob } = await supabase
      .from("email_sync_jobs")
      .select("import_mode")
      .eq("id", jobId)
      .maybeSingle();

    const mode = legacyJob?.import_mode ?? "all";

    const { data, error } = await supabase.functions.invoke("start-email-import", {
      body: { configId, mode },
    });

    if (error) {
      console.error("[email-sync-worker] Failed to invoke start-email-import:", error);
      await supabase
        .from("email_sync_jobs")
        .update({ status: "error", error_message: "Redirect to 3-phase importer failed" })
        .eq("id", jobId);

      return new Response(JSON.stringify({ error: "Failed to start import" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark legacy job as cancelled to avoid repeated invocations.
    await supabase
      .from("email_sync_jobs")
      .update({
        status: "cancelled",
        error_message: "Deprecated: redirected to 3-phase email import pipeline",
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return new Response(JSON.stringify({ success: true, redirected: true, ...data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[email-sync-worker] Error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
