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
    const { configId, mode } = await req.json();
    if (!configId) {
      return new Response(JSON.stringify({ error: "Missing configId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load config with access token to get total count
    const { data: config, error: configError } = await supabase
      .from("email_provider_configs")
      .select("id, workspace_id, import_mode, access_token")
      .eq("id", configId)
      .single();

    if (configError || !config) {
      return new Response(JSON.stringify({ error: "Email config not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const importMode = mode || config.import_mode || "last_1000";

    // Get total email count from Aurinko for progress percentage
    let totalEmailCount = 0;
    try {
      // Fetch count of inbox emails (use limit=1 and get totalSize from response)
      const countResponse = await fetch('https://api.aurinko.io/v1/email/messages?limit=1', {
        headers: { 'Authorization': `Bearer ${config.access_token}` },
      });
      if (countResponse.ok) {
        const countData = await countResponse.json();
        totalEmailCount = countData.totalSize || countData.length || 0;
        console.log('Total inbox email count:', totalEmailCount);
      }
    } catch (e) {
      console.log('Could not get email count:', e);
    }

    // Create a new resumable sync job (idempotent: if a running job exists, reuse it)
    const { data: existingJob } = await supabase
      .from("email_sync_jobs")
      .select("id, status")
      .eq("config_id", configId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let jobId = existingJob?.id as string | undefined;

    if (!jobId) {
      const { data: newJob, error: jobError } = await supabase
        .from("email_sync_jobs")
        .insert({
          workspace_id: config.workspace_id,
          config_id: configId,
          status: "queued",
          import_mode: importMode,
          inbound_cursor: "START",
          sent_cursor: "START",
          inbound_processed: 0,
          sent_processed: 0,
          threads_linked: 0,
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (jobError || !newJob) {
        return new Response(JSON.stringify({ error: "Failed to create sync job" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      jobId = newJob.id;
    }

    // Update UI-facing status with total count
    await supabase
      .from("email_provider_configs")
      .update({
        sync_status: "syncing",
        sync_stage: "fetching_inbox",
        sync_started_at: new Date().toISOString(),
        sync_error: null,
        sync_total: totalEmailCount > 0 ? totalEmailCount : null,
      })
      .eq("id", configId);

    // Kick off worker (do not await)
    supabase.functions
      .invoke("email-sync-worker", {
        body: { jobId, configId },
      })
      .catch((err) => console.error("Failed to start email-sync-worker:", err));

    return new Response(JSON.stringify({ success: true, jobId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("email-sync starter error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
