import {
  assertWorkerToken,
  createServiceClient,
  HttpError,
  jsonResponse,
  queueSend,
  touchPipelineRun,
} from "../_shared/pipeline.ts";

async function hasRecentOpenIncident(params: {
  workspaceId: string;
  runId?: string | null;
  scope: string;
  lookbackMinutes: number;
}): Promise<boolean> {
  const supabase = createServiceClient();
  let query = supabase
    .from("pipeline_incidents")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", params.workspaceId)
    .eq("scope", params.scope)
    .is("resolved_at", null)
    .gte("created_at", new Date(Date.now() - params.lookbackMinutes * 60_000).toISOString());

  if (params.runId) {
    query = query.eq("run_id", params.runId);
  }

  const { count, error } = await query;
  if (error) {
    console.error("incident dedupe query failed", error.message);
    return false;
  }

  return (count || 0) > 0;
}

async function recordIncidentOnce(params: {
  workspaceId: string;
  runId?: string | null;
  severity: "info" | "warning" | "error" | "critical";
  scope: string;
  error: string;
  context?: Record<string, unknown>;
  dedupeMinutes?: number;
}): Promise<void> {
  const dedupeMinutes = params.dedupeMinutes ?? 10;
  const alreadyOpen = await hasRecentOpenIncident({
    workspaceId: params.workspaceId,
    runId: params.runId,
    scope: params.scope,
    lookbackMinutes: dedupeMinutes,
  });

  if (alreadyOpen) {
    return;
  }

  const supabase = createServiceClient();
  const { error } = await supabase.rpc("bb_record_incident", {
    p_workspace_id: params.workspaceId,
    p_run_id: params.runId || null,
    p_severity: params.severity,
    p_scope: params.scope,
    p_error: params.error,
    p_context: params.context || {},
  });

  if (error) {
    console.error("recordIncidentOnce failed", error.message, params);
  }
}

Deno.serve(async (req) => {
  const startMs = Date.now();
  try {
    if (req.method !== "POST") {
      throw new HttpError(405, "Method not allowed");
    }

    assertWorkerToken(req);
    const supabase = createServiceClient();

    const stalledRunMinutes = Number(Deno.env.get("BB_STALLED_RUN_MINUTES") || "6");
    const stalledEventMinutes = Number(Deno.env.get("BB_STALLED_EVENT_MINUTES") || "10");
    const nudgeLimit = Number(Deno.env.get("BB_SUPERVISOR_NUDGE_LIMIT") || "25");

    const stalledRunCutoff = new Date(Date.now() - stalledRunMinutes * 60_000).toISOString();
    const stalledEventCutoff = new Date(Date.now() - stalledEventMinutes * 60_000).toISOString();

    const { data: stalledRuns, error: stalledRunsError } = await supabase
      .from("pipeline_runs")
      .select("id, workspace_id, config_id, channel, mode, state, last_heartbeat_at, params, metrics")
      .eq("state", "running")
      .lt("last_heartbeat_at", stalledRunCutoff)
      .order("last_heartbeat_at", { ascending: true })
      .limit(100);

    if (stalledRunsError) {
      throw new Error(`Failed loading stalled runs: ${stalledRunsError.message}`);
    }

    for (const run of stalledRuns || []) {
      await recordIncidentOnce({
        workspaceId: run.workspace_id,
        runId: run.id,
        severity: "warning",
        scope: "pipeline-supervisor:stalled-run",
        error: `Run heartbeat stale since ${run.last_heartbeat_at}`,
        context: {
          run_id: run.id,
          channel: run.channel,
          mode: run.mode,
          last_heartbeat_at: run.last_heartbeat_at,
          threshold_minutes: stalledRunMinutes,
        },
      });

      await touchPipelineRun(supabase, {
        runId: run.id,
        metricsPatch: {
          supervisor_last_checked_at: new Date().toISOString(),
        },
      });
    }

    const { data: stalledEvents, error: stalledEventsError } = await supabase
      .from("message_events")
      .select("id, workspace_id, run_id, channel, config_id, status, updated_at")
      .in("status", ["received", "materialized", "classified"])
      .lt("updated_at", stalledEventCutoff)
      .order("updated_at", { ascending: true })
      .limit(Math.max(1, Math.min(200, nudgeLimit * 3)));

    if (stalledEventsError) {
      throw new Error(`Failed loading stalled events: ${stalledEventsError.message}`);
    }

    let nudgedMaterialize = 0;
    for (const event of stalledEvents || []) {
      await recordIncidentOnce({
        workspaceId: event.workspace_id,
        runId: event.run_id,
        severity: "warning",
        scope: "pipeline-supervisor:stalled-event",
        error: `Event ${event.id} is stalled in status ${event.status}`,
        context: {
          event_id: event.id,
          status: event.status,
          updated_at: event.updated_at,
          threshold_minutes: stalledEventMinutes,
        },
        dedupeMinutes: 15,
      });

      if (event.status === "received" && nudgedMaterialize < nudgeLimit) {
        await queueSend(supabase, "bb_ingest_jobs", {
          job_type: "MATERIALIZE",
          event_id: event.id,
          workspace_id: event.workspace_id,
          run_id: event.run_id,
          channel: event.channel,
          config_id: event.config_id,
          supervisor_nudge: true,
          nudged_at: new Date().toISOString(),
        }, 0);

        await supabase
          .from("message_events")
          .update({
            updated_at: new Date().toISOString(),
            last_error: "Supervisor nudge: materialize re-enqueued",
          })
          .eq("id", event.id)
          .eq("status", "received");

        nudgedMaterialize += 1;
      }
    }

    const { data: conversationsNeedingClassification, error: classifyNudgeError } = await supabase
      .from("conversations")
      .select("id, workspace_id, channel, last_inbound_message_id, last_classified_message_id, last_classify_enqueued_message_id")
      .not("last_inbound_message_id", "is", null)
      .limit(Math.max(1, Math.min(150, nudgeLimit * 3)));

    if (classifyNudgeError) {
      throw new Error(`Failed loading conversations needing classification: ${classifyNudgeError.message}`);
    }

    let nudgedClassify = 0;
    for (const conversation of conversationsNeedingClassification || []) {
      if (nudgedClassify >= nudgeLimit) {
        break;
      }

      if (!conversation.last_inbound_message_id) {
        continue;
      }

      if (conversation.last_inbound_message_id === conversation.last_classified_message_id) {
        continue;
      }

      if (conversation.last_inbound_message_id === conversation.last_classify_enqueued_message_id) {
        continue;
      }

      const { data: event, error: eventError } = await supabase
        .from("message_events")
        .select("id, workspace_id, run_id, config_id, channel, direction")
        .eq("materialized_conversation_id", conversation.id)
        .eq("materialized_message_id", conversation.last_inbound_message_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (eventError || !event) {
        continue;
      }

      if (event.direction !== "inbound") {
        continue;
      }

      const { error: markEnqueuedError } = await supabase
        .from("conversations")
        .update({
          last_classify_enqueued_message_id: conversation.last_inbound_message_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation.id)
        .neq("last_classify_enqueued_message_id", conversation.last_inbound_message_id);

      if (markEnqueuedError) {
        console.error("Failed marking classify enqueued", markEnqueuedError.message);
        continue;
      }

      await queueSend(supabase, "bb_classify_jobs", {
        job_type: "CLASSIFY",
        workspace_id: event.workspace_id,
        run_id: event.run_id || null,
        config_id: event.config_id,
        channel: event.channel,
        event_id: event.id,
        conversation_id: conversation.id,
        target_message_id: conversation.last_inbound_message_id,
        supervisor_nudge: true,
      }, 0);

      await recordIncidentOnce({
        workspaceId: event.workspace_id,
        runId: event.run_id,
        severity: "info",
        scope: "pipeline-supervisor:nudge-classify",
        error: `Supervisor re-enqueued classify for conversation ${conversation.id}`,
        context: {
          conversation_id: conversation.id,
          event_id: event.id,
          target_message_id: conversation.last_inbound_message_id,
        },
        dedupeMinutes: 30,
      });

      nudgedClassify += 1;
    }

    return jsonResponse({
      ok: true,
      stalled_runs: (stalledRuns || []).length,
      stalled_events: (stalledEvents || []).length,
      nudged_materialize: nudgedMaterialize,
      nudged_classify: nudgedClassify,
      elapsed_ms: Date.now() - startMs,
    });
  } catch (error) {
    console.error("pipeline-supervisor fatal", error);
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
