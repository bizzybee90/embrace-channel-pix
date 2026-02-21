

# Deploy Unified Communication Pipeline

## Current State
- The branch has been merged -- all migration SQL files and edge functions are in the codebase
- The migrations have NOT been applied because the **pgmq extension is not enabled**
- `pg_cron` and `pg_net` are already enabled
- There are also 10 TypeScript build errors (simple casting fix needed across 4 edge functions)

## Plan

### Step 1: Fix build errors (TypeScript casting)
Change all `as Record<string, unknown>` casts to `as unknown as Record<string, unknown>` in:
- `pipeline-worker-classify/index.ts` (lines 379, 535, 544)
- `pipeline-worker-draft/index.ts` (lines 97, 237, 254)
- `pipeline-worker-import/index.ts` (lines 44, 58, 88)
- `pipeline-worker-ingest/index.ts` (line 52)

### Step 2: Enable pgmq extension
Run `CREATE EXTENSION IF NOT EXISTS pgmq;` via the SQL tool. This is a prerequisite for the migration.

### Step 3: Run the main pipeline migration
Execute `20260221150000_unified_pipeline.sql` content via the SQL tool. This creates:
- Tables: `pipeline_runs`, `pipeline_incidents`, `customer_identities`, `message_events`, `conversation_refs`, `pipeline_job_audit`
- Columns on `conversations`: `last_inbound_message_id`, `last_inbound_message_at`, etc.
- Columns on `messages`: `external_id`, `external_thread_id`, `config_id`
- Queue wrapper functions: `bb_queue_send`, `bb_queue_read`, `bb_queue_delete`, etc.
- Core functions: `bb_ingest_unified_messages`, `bb_materialize_event`, `bb_trigger_worker`, `bb_schedule_pipeline_crons`
- 5 PGMQ queues: `bb_import_jobs`, `bb_ingest_jobs`, `bb_classify_jobs`, `bb_draft_jobs`, `bb_deadletter_jobs`
- Views: `bb_open_incidents`, `bb_stalled_events`, `bb_pipeline_progress`, `bb_queue_depths`, `bb_needs_classification`
- RLS policies on all new tables

### Step 4: Run the fixes migration
Execute `20260221160000_pipeline_fixes.sql` content via the SQL tool. This:
- Fixes UK phone normalization (07... to +447...)
- Backfills `customer_identities` from existing customers
- Backfills `conversation_refs` from existing conversations
- Creates `bb_merge_customers` function

### Step 5: Add Vault secrets
Add 7 Vault secrets using the SQL tool:
- `bb_worker_anon_key` -- the Supabase anon key
- `bb_worker_token` -- a random token for worker auth
- `bb_worker_import_url`, `bb_worker_ingest_url`, `bb_worker_classify_url`, `bb_worker_draft_url`, `bb_worker_supervisor_url` -- edge function URLs

### Step 6: Set BB_WORKER_TOKEN env var
The edge functions need `BB_WORKER_TOKEN` as an environment variable. This will be set as a secret.

### Step 7: Verify
Run verification queries to confirm:
- Tables exist and backfills worked
- `bb_norm_identifier` returns correct values
- Queue depths show 0 (queues created)

### Step 8: Schedule cron jobs
Run `SELECT bb_schedule_pipeline_crons()` to start the 5 cron workers.

## Important Notes
- The migrations are large (1,400+ lines for the main one). They will be run via the SQL insert tool since they are data/schema operations.
- Vault secrets cannot be created through the migration tool -- they'll be inserted directly via SQL.
- The `BB_WORKER_TOKEN` secret needs to match what's stored in Vault as `bb_worker_token`.

