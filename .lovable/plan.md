# Bulletproof Pipeline: IMPLEMENTED ✅

## Implementation Complete (2026-01-29)

All three reliability layers are now in place and working:

### Layer 1: Self-Invocation Relay ✅
- Edge function chains to itself every 30-60 seconds
- Maintains continuity without browser needing to be open
- Adaptive backoff on rate limits

### Layer 2: pg_cron Watchdog ✅
- Runs every 2 minutes via `pipeline-watchdog`
- 8-minute stale threshold before resurrection
- Auto-cleans ghost jobs (total_to_classify = 0)
- Only resurrects ONE job per workspace (most recent)
- Cleans up stale locks (>3 min)
- Handles paused jobs from graceful degradation

### Layer 3: Job State Machine ✅
- States: pending → in_progress → completed/failed/paused
- Single active job enforcement per workspace
- Heartbeat updates every 2 sub-batches to prevent false stall detection
- Graceful degradation after 10 consecutive LLM failures → paused state with 30s retry
- **NEW (2026-01-29 12:15):** Job validation on resume - invalidated jobs (failed/completed/ghost) are not resumed

---

## Bug Fix: UI Flickering (2026-01-29 12:15)

**Root Cause:** Two classification jobs were running simultaneously, both updating `email_import_progress.emails_classified` with different counts. This caused the UI to flicker between values.

**Fix Applied:**
1. Killed orphan job `0906992c` that was still running despite being marked as ghost
2. Added job validation on resume - if a job_id is passed but the job is `failed`, `completed`, or has `total_to_classify=0`, the classifier now looks for a valid active job instead of blindly resuming

**Key Code Change in `email-classify-v2/index.ts`:**
```typescript
if (data.status === 'failed' || data.status === 'completed') {
  console.warn(`Job ${job_id} was ${data.status} externally, looking for active job instead`);
} else if (data.total_to_classify === 0) {
  console.warn(`Job ${job_id} is a ghost job (total=0), looking for active job instead`);
} else {
  job = data as ClassifyJob;
}
```

---

## Current Status

**Classification is running autonomously:**
- Processing ~400-500 emails per batch
- Self-invoking every 50-60 seconds
- Watchdog catches any stalls within 8 minutes
- Only ONE job running per workspace (enforced)

---

## Files Changed

| File | Changes |
|------|---------|
| `pipeline-watchdog/index.ts` | Complete rewrite with bulletproof logic |
| `email-classify-v2/index.ts` | Ghost cleanup, single-job enforcement, heartbeat, graceful degradation, job validation on resume |

---

## Reliability Guarantees

| Scenario | Before | After |
|----------|--------|-------|
| Edge function dies silently | Stuck indefinitely | Resumed in ~8 minutes |
| Ghost jobs (0 emails) | Resurrected forever | Auto-closed immediately |
| Multiple jobs per workspace | Confusion/duplicates, UI flickers | Only ONE active |
| Rate limiting | Sometimes stalls | Graceful backoff + relay |
| Consecutive LLM errors | Silent death | Pauses + retries with 30s delay |
| Job invalidated externally | Zombie resumes | Looks for valid job instead |

---

## Google OAuth

Lovable Cloud now supports Google OAuth! Options:
1. **Managed by Lovable** - Zero configuration needed
2. **BYOK** - Use your own credentials

Can implement after pipeline stabilization.
