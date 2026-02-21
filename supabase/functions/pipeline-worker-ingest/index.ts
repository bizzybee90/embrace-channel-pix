import {
  assertWorkerToken,
  auditJob,
  createServiceClient,
  deadletterJob,
  DEFAULT_TIME_BUDGET_MS,
  HttpError,
  isUuidLike,
  jsonResponse,
  queueDelete,
  readQueue,
  touchPipelineRun,
  withinBudget,
} from "../_shared/pipeline.ts";
import type { MaterializeJob } from "../_shared/types.ts";

const QUEUE_NAME = "bb_ingest_jobs";
const VT_SECONDS = 150;
const MAX_ATTEMPTS = 6;

Deno.serve(async (req) => {
  const startMs = Date.now();
  try {
    if (req.method !== "POST") {
      throw new HttpError(405, "Method not allowed");
    }

    assertWorkerToken(req);
    const supabase = createServiceClient();
    const batchSize = Number(Deno.env.get("BB_INGEST_BATCH_SIZE") || "25");

    const jobs = await readQueue<MaterializeJob>(
      supabase,
      QUEUE_NAME,
      VT_SECONDS,
      Math.max(1, Math.min(60, batchSize)),
    );

    let processed = 0;
    for (const record of jobs) {
      if (!withinBudget(startMs, DEFAULT_TIME_BUDGET_MS)) {
        break;
      }

      const job = record.message;
      if (!job || job.job_type !== "MATERIALIZE" || !isUuidLike(job.event_id)) {
        await queueDelete(supabase, QUEUE_NAME, record.msg_id);
        await auditJob(supabase, {
          workspaceId: job?.workspace_id,
          runId: job?.run_id,
          queueName: QUEUE_NAME,
          jobPayload: (job || {}) as unknown as Record<string, unknown>,
          outcome: "discarded",
          error: "Invalid MATERIALIZE job",
          attempts: record.read_ct,
        });
        continue;
      }

      try {
        const { data, error } = await supabase.rpc("bb_materialize_event", {
          p_event_id: job.event_id,
        });

        if (error) {
          throw new Error(`bb_materialize_event failed: ${error.message}`);
        }

        const result = Array.isArray(data) ? data[0] : data;

        if (job.run_id) {
          await touchPipelineRun(supabase, {
            runId: job.run_id,
            metricsPatch: {
              last_materialize_event_id: job.event_id,
              last_materialized_at: new Date().toISOString(),
              materialize_did_work: Boolean(result?.did_work),
            },
          });
        }

        await queueDelete(supabase, QUEUE_NAME, record.msg_id);
        await auditJob(supabase, {
          workspaceId: job.workspace_id,
          runId: job.run_id,
          queueName: QUEUE_NAME,
          jobPayload: job as unknown as Record<string, unknown>,
          outcome: "processed",
          attempts: record.read_ct,
        });

        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("pipeline-worker-ingest job error", {
          msg_id: record.msg_id,
          attempts: record.read_ct,
          event_id: job.event_id,
          error: message,
        });

        if (record.read_ct >= MAX_ATTEMPTS) {
          await deadletterJob(supabase, {
            fromQueue: QUEUE_NAME,
            msgId: record.msg_id,
            attempts: record.read_ct,
            workspaceId: job.workspace_id,
            runId: job.run_id,
            jobPayload: job as unknown as Record<string, unknown>,
            error: message,
            scope: "pipeline-worker-ingest",
          });

          await supabase
            .from("message_events")
            .update({ status: "failed", last_error: message, updated_at: new Date().toISOString() })
            .eq("id", job.event_id)
            .neq("status", "drafted");
        } else {
          await auditJob(supabase, {
            workspaceId: job.workspace_id,
            runId: job.run_id,
            queueName: QUEUE_NAME,
            jobPayload: job as unknown as Record<string, unknown>,
            outcome: "failed",
            error: message,
            attempts: record.read_ct,
          });

          await supabase
            .from("message_events")
            .update({ last_error: message, updated_at: new Date().toISOString() })
            .eq("id", job.event_id)
            .neq("status", "drafted");
        }
      }
    }

    return jsonResponse({
      ok: true,
      queue: QUEUE_NAME,
      fetched_jobs: jobs.length,
      processed,
      elapsed_ms: Date.now() - startMs,
    });
  } catch (error) {
    console.error("pipeline-worker-ingest fatal", error);
    if (error instanceof HttpError) {
      return jsonResponse({ ok: false, error: error.message }, error.status);
    }

    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected error",
      elapsed_ms: Date.now() - startMs,
    }, 500);
  }
});
