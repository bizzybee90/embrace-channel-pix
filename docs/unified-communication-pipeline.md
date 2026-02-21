# BizzyBee Unified Communication Pipeline

This pipeline unifies bulk import and live webhook ingestion across channels:

`Channel Adapter -> bb_ingest_unified_messages -> queues -> workers -> materialized conversations/messages/customers`

It is implemented with Postgres state machine tables + Supabase Queues (PGMQ) + scheduled Edge workers.

## Architecture

### Core tables

- `message_events`: channel-agnostic ingest state machine and audit row per provider message.
- `customer_identities`: maps normalized channel identifiers (email/phone/social) to a canonical `customers.id`.
- `conversation_refs`: maps external provider thread ids to internal `conversations.id`.
- `pipeline_runs`: import/live run-level state, metrics, heartbeat.
- `pipeline_incidents`: durable incidents/warnings/errors.
- `pipeline_job_audit`: append-only job outcomes for debugging.

### Existing table extensions

- `conversations`:
  - `last_inbound_message_id`
  - `last_inbound_message_at`
  - `last_classified_message_id`
  - `last_classify_enqueued_message_id`
  - `last_draft_message_id`
  - `last_draft_enqueued_message_id`
- `messages`:
  - `external_id`
  - `external_thread_id`
  - `config_id`

### Queues

- `bb_import_jobs`
- `bb_ingest_jobs`
- `bb_classify_jobs`
- `bb_draft_jobs`
- `bb_deadletter_jobs`

### Queue wrappers (server-only)

Use wrapper RPCs instead of direct `pgmq_public` access:

- `bb_queue_send`
- `bb_queue_send_batch`
- `bb_queue_read`
- `bb_queue_delete`
- `bb_queue_archive`

`EXECUTE` is revoked from `anon`/`authenticated` and granted to `service_role` only.

## Job payload contracts

### `bb_import_jobs`

```json
{
  "job_type": "IMPORT_FETCH",
  "workspace_id": "uuid",
  "run_id": "uuid",
  "config_id": "uuid",
  "folder": "SENT|INBOX",
  "pageToken": "optional",
  "cap": 2500,
  "fetched_so_far": 0,
  "pages": 0,
  "rate_limit_count": 0
}
```

### `bb_ingest_jobs`

```json
{
  "job_type": "MATERIALIZE",
  "event_id": "uuid",
  "workspace_id": "uuid",
  "run_id": "uuid|null",
  "channel": "email|whatsapp|sms|facebook|voice",
  "config_id": "uuid"
}
```

### `bb_classify_jobs`

```json
{
  "job_type": "CLASSIFY",
  "workspace_id": "uuid",
  "run_id": "uuid|null",
  "config_id": "uuid",
  "channel": "email|whatsapp|sms|facebook|voice",
  "event_id": "uuid",
  "conversation_id": "uuid",
  "target_message_id": "uuid"
}
```

### `bb_draft_jobs`

```json
{
  "job_type": "DRAFT",
  "workspace_id": "uuid",
  "run_id": "uuid|null",
  "conversation_id": "uuid",
  "target_message_id": "uuid",
  "event_id": "uuid|null"
}
```

## Worker responsibilities

### `pipeline-worker-import`

- Reads `bb_import_jobs` with VT=180s.
- Fetches exactly one Aurinko page (`limit=100`) per job.
- Converts Aurinko messages to `UnifiedMessage`.
- Calls `bb_ingest_unified_messages`.
- Updates run heartbeat + metrics (`fetched_so_far`, `pages`, `rate_limit_count`).
- Re-enqueues next page or switches `SENT -> INBOX`.
- Enforces `cap` server-side.
- Handles 429 with exponential backoff and delayed requeue.
- DLQs at `read_ct >= 6`.

### `pipeline-worker-ingest`

- Reads `bb_ingest_jobs` with VT=150s.
- Calls `bb_materialize_event(event_id)`.
- `bb_materialize_event` is idempotent and uses advisory locks for:
  - identity creation
  - conversation thread mapping
- Worker heartbeats runs and DLQs on max attempts.

### `pipeline-worker-classify`

- Reads `bb_classify_jobs` with VT=180s.
- Stale guards:
  - skip if `last_inbound_message_id != target_message_id`
  - skip if `last_classified_message_id == target_message_id`
- Runs sender-rule pre-triage first.
- Batches remaining jobs to Lovable AI gateway (`gemini-2.5-flash` default).
- Applies decision engine:
  - `auto_handled` for notification/newsletter/spam
  - `needs_human` if confidence < 0.7
  - otherwise `act_now`/`quick_win`
- Updates conversation classification fields and `message_events.status = decided`.
- Enqueues draft job only once per inbound target using `last_draft_enqueued_message_id`.

### `pipeline-worker-draft`

- Reads `bb_draft_jobs` with VT=180s.
- Stale guards:
  - skip if `last_inbound_message_id != target_message_id`
  - skip if `last_draft_message_id == target_message_id`
- Uses Anthropic to produce `ai_draft_response`.
- Updates `conversations.last_draft_message_id` and `message_events.status = drafted`.
- DLQs after max attempts.

### `pipeline-supervisor`

- Detects stalled runs (`state=running`, heartbeat old).
- Detects stalled events in `received/materialized/classified`.
- Creates incidents with dedupe window.
- Conservative nudges:
  - re-enqueue `MATERIALIZE` for stale `received` events
  - re-enqueue `CLASSIFY` when conversation has unclassified latest inbound and no classify enqueue marker

## Ingest entry points

### `unified-ingest` (HTTP)

- Validates `workspace_id/config_id/channel/messages[]`.
- Calls `bb_ingest_unified_messages` only (no AI/materialization in HTTP path).

### `start-email-import` (HTTP, UI-triggered)

- Validates caller auth and workspace access.
- Creates `pipeline_runs` row with mode + cap.
- Enqueues initial `IMPORT_FETCH` job (`SENT` first).

### `aurinko-webhook` (HTTP adapter)

- Verifies webhook signature when `AURINKO_WEBHOOK_SECRET` is configured.
- Resolves provider config.
- Fetches full message if webhook carries only reference.
- Computes direction using owner/aliases.
- Converts to `UnifiedMessage` and calls `bb_ingest_unified_messages`.
- No direct writes to `conversations/messages`.

## Observability

### Views

- `bb_open_incidents`
- `bb_stalled_events`
- `bb_pipeline_progress`
- `bb_queue_depths`
- `bb_needs_classification`

### Useful queries

```sql
-- Live run progress
select * from public.bb_pipeline_progress order by started_at desc;

-- Queue backlog
select * from public.bb_queue_depths;

-- Active incidents
select * from public.bb_open_incidents;

-- Stalled event rows
select * from public.bb_stalled_events;

-- DLQ payload inspection (queue table)
select * from pgmq.q_bb_deadletter_jobs order by msg_id desc limit 100;
```

## Cron scheduling and Vault secrets

Migration provides:

- `bb_schedule_pipeline_crons()`
- `bb_unschedule_pipeline_crons()`
- `bb_trigger_worker(secret_name, body)`

Required Vault secret names:

- `bb_worker_import_url`
- `bb_worker_ingest_url`
- `bb_worker_classify_url`
- `bb_worker_draft_url`
- `bb_worker_supervisor_url`
- `bb_worker_anon_key`
- `bb_worker_token`

Schedule defaults:

- import: `10 seconds`
- ingest: `10 seconds`
- classify: `10 seconds`
- draft: `25 seconds`
- supervisor: `2 minutes`

Workers require header: `x-bb-worker-token`.

## Operational knobs

Environment variables used by workers/functions:

- `BB_WORKER_TOKEN`
- `BB_IMPORT_BATCH_SIZE`
- `BB_INGEST_BATCH_SIZE`
- `BB_CLASSIFY_BATCH_SIZE`
- `BB_DRAFT_BATCH_SIZE`
- `BB_IMPORT_CAP_MAX`
- `BB_STALLED_RUN_MINUTES`
- `BB_STALLED_EVENT_MINUTES`
- `BB_SUPERVISOR_NUDGE_LIMIT`
- `AURINKO_API_BASE_URL`
- `AURINKO_WEBHOOK_SECRET`
- `LOVABLE_AI_GATEWAY_URL`
- `LOVABLE_AI_GATEWAY_KEY`
- `LOVABLE_CLASSIFY_MODEL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_API_URL`

## Add a new channel adapter (WhatsApp/SMS/etc)

1. Implement adapter function that maps provider payload to `UnifiedMessage[]`.
2. Set `channel` and proper `direction`/identifiers.
3. Call `bb_ingest_unified_messages(workspace_id, config_id, run_id?, channel, messages)`.
4. Do not write directly to `conversations/messages/customers`.
5. Keep adapter thin; all orchestration remains queue-driven.

## Troubleshooting

### Duplicate messages/conversations

- Check unique keys:
  - `message_events(workspace_id, channel, config_id, external_id)`
  - `conversation_refs(workspace_id, channel, config_id, external_thread_id)`
  - `messages(conversation_id, external_id) where external_id is not null`
- Replays should no-op in `bb_materialize_event`.

### Stuck pipeline

1. Inspect `bb_open_incidents` and `bb_stalled_events`.
2. Check queue depth (`bb_queue_depths`).
3. Inspect `pipeline_job_audit` for repeated failures.
4. Inspect `bb_deadletter_jobs` queue payloads.
5. Requeue safely by sending corrected jobs back to source queues.

### Frequent 429s

- Confirm Aurinko API quota and backoff behavior.
- Reduce import worker frequency/batch size.
- Keep one-page-per-job contract and rely on delayed retries.
