import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Legacy entrypoint kept for backward compatibility.
 *
 * This now proxies to the 3-phase import pipeline:
 * start-email-import -> email-scan (metadata) -> email-analyze (threads) -> email-fetch-bodies (conversations only)
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { configId, mode = "all" } = await req.json();

    if (!configId) {
      return new Response(JSON.stringify({ error: "Missing configId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Delegate to the 3-phase importer
    const { data, error } = await supabase.functions.invoke("start-email-import", {
      body: { configId, mode },
    });

    if (error) {
      console.error("[email-sync] Failed to invoke start-email-import:", error);
      return new Response(JSON.stringify({ error: "Failed to start import" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data ?? { success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[email-sync] Error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
