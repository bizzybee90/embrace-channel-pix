import {
  assertWorkerToken,
  createServiceClient,
  HttpError,
  jsonResponse,
} from "../_shared/pipeline.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      throw new HttpError(405, "Method not allowed");
    }

    assertWorkerToken(req);
    const supabase = createServiceClient();

    const queues = ["bb_ingest", "bb_classify", "bb_draft"];
    const results: Record<string, string> = {};

    for (const queue of queues) {
      try {
        const { error } = await supabase.rpc("bb_purge_queue", { queue_name: queue });
        if (error) {
          // Fallback: try direct pgmq.purge_queue
          const { error: fallbackError } = await supabase.rpc("bb_queue_purge_archived", { queue_name: queue });
          results[queue] = fallbackError ? `error: ${fallbackError.message}` : "purged (fallback)";
        } else {
          results[queue] = "purged";
        }
      } catch (e) {
        results[queue] = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    return jsonResponse({ ok: true, results });
  } catch (error) {
    console.error("nightly-queue-cleanup fatal", error);
    if (error instanceof HttpError) {
      return jsonResponse({ ok: false, error: error.message }, error.status);
    }
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});
