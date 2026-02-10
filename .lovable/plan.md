

# Disable Redundant pg_cron Workers After n8n Migration

## Problem
Five pg_cron scheduled functions poll every 60-120 seconds (24/7), costing ~5,760+ idle invocations daily. With n8n handling competitor discovery and email processing, these workers are redundant.

## What Changes

### 1. Remove pg_cron Schedules
Disable the following scheduled jobs via a database migration:

- `hydrate-worker` (every 60s)
- `classification-worker` (every 60s)
- `process-worker` (every 60s)
- `pipeline-watchdog` (every 2 mins)
- `competitor-research-watchdog` (every 2 mins)

### 2. Keep the Edge Functions (Don't Delete)
The function code stays in place as a safety net. Only the automatic scheduling is removed. They can still be called manually from the admin DevOps dashboard if needed for debugging.

### 3. What Replaces Them
- **n8n workflows** manage retries, error handling, and orchestration natively
- **`n8n-competitor-callback`** receives status updates from n8n (event-driven, zero idle cost)
- **`n8n-email-callback`** receives email import progress from n8n (event-driven, zero idle cost)
- **`trigger-n8n-workflow`** is called on-demand from the onboarding UI (zero idle cost)

### 4. Estimated Savings
- ~5,760 function invocations per day eliminated
- ~40,320 per week
- Each invocation currently costs boot time (168-867ms) plus execution even when doing nothing

## Technical Details

### Database Migration SQL
```sql
-- Remove all polling cron jobs that n8n now handles
SELECT cron.unschedule('hydrate-worker');
SELECT cron.unschedule('classification-worker');
SELECT cron.unschedule('process-worker');
SELECT cron.unschedule('pipeline-watchdog');
SELECT cron.unschedule('competitor-research-watchdog');
```

Note: The exact job names will be confirmed by querying `cron.job` before running the migration.

### Safety Check
Before disabling, verify n8n workflows are active and tested:
- Competitor discovery workflow responds to webhook trigger
- Email import workflow responds to webhook trigger
- Both callback endpoints are reachable from n8n

### Rollback
If n8n has issues, the cron jobs can be re-added with a simple migration re-inserting the schedules.

