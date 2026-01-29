

# Bulletproof Pipeline: Zero-Failure Architecture

## Current Status (Good News First)

**Classification is working right now:**
- 6,300 / 18,618 emails processed (34%)
- Last update: 0.5 seconds ago
- Running at ~100-200 emails/minute

**The relay race IS working**, but there are reliability gaps that cause it to stall under certain conditions.

---

## Root Causes of Stalls

### 1. Ghost Jobs Creating Noise
Two orphaned `classification_jobs` with `total_to_classify=0` keep getting resurrected every 2 minutes, causing:
- Log spam: "RESURRECTING stalled classification job..."
- Wasted function invocations
- Potential lock contention

### 2. Lock Contention Pattern
Current flow:
```text
Worker A: acquire_lock() → success → start processing
Watchdog: resurrects ghost job B
Worker B: acquire_lock() → blocked → exit
Worker C: acquire_lock() → blocked → exit
```

This is working (lock prevents duplicates), but wastes resources.

### 3. No "Single Active Job" Enforcement
The watchdog resurrects ALL stalled jobs, but there should only ever be ONE classification job running per workspace.

### 4. Silent Death Without Proper Retry
If the Edge Function dies mid-execution (e.g., network timeout, OOM), the relay breaks. The watchdog catches this, but only after 5 minutes.

---

## Solution: Three-Layer Reliability

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: Self-Invocation Relay (Fast - Every 30-60 seconds)            │
│ Function chains to itself before timeout, maintaining continuity        │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: pg_cron Watchdog (Slow - Every 2 minutes)                      │
│ Catches silent failures, resurrects ONLY the active job                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: Job State Machine (Persistent)                                 │
│ Clear states: pending → in_progress → completed/failed                  │
│ Only ONE job can be in_progress per workspace                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Step 1: Clean Up Ghost Jobs (Database)

Execute SQL to mark orphaned jobs as failed:

```sql
UPDATE classification_jobs 
SET status = 'failed', 
    completed_at = NOW(),
    last_error = 'Cleaned up: ghost job with no emails'
WHERE workspace_id = '681ad707-3105-4238-a552-f5346577810f'
  AND status = 'in_progress'
  AND total_to_classify = 0
  AND id != '5bc43e99-500e-4aa8-98f3-7e5d8ed7100a';
```

### Step 2: Smarter Watchdog Logic

Modify `pipeline-watchdog/index.ts` to:

1. **Only resurrect ONE job per workspace** - the most recent one with actual progress
2. **Skip ghost jobs** - jobs with `total_to_classify = 0` should be auto-completed, not resurrected
3. **Longer stale threshold** - increase from 5 minutes to 8 minutes (gives more time for legitimate retries)
4. **Log when skipping** - visibility into why jobs weren't resurrected

Changes to watchdog logic:
```typescript
// Get only the LATEST active job per workspace (not all stalled jobs)
const { data: stalledJobs } = await supabase
  .from('classification_jobs')
  .select('id, workspace_id, status, classified_count, total_to_classify, updated_at')
  .eq('status', 'in_progress')
  .gt('total_to_classify', 0)  // Skip ghost jobs
  .lt('updated_at', staleThreshold)
  .order('updated_at', { ascending: false });

// Group by workspace, only resurrect ONE per workspace
const workspaceJobs = new Map<string, typeof stalledJobs[0]>();
for (const job of stalledJobs || []) {
  if (!workspaceJobs.has(job.workspace_id)) {
    workspaceJobs.set(job.workspace_id, job);
  }
}
```

### Step 3: Single Active Job Enforcement in Classifier

Modify `email-classify-v2/index.ts` to:

1. **Check for existing active job FIRST** - before creating a new one
2. **Cancel/complete ghost jobs** - if we find orphaned jobs, mark them failed
3. **Early exit if no work** - if `total_to_classify = 0`, complete immediately

Add at job creation:
```typescript
// Cancel any ghost jobs (no emails to classify)
await supabase
  .from('classification_jobs')
  .update({ status: 'failed', last_error: 'No emails to classify' })
  .eq('workspace_id', workspace_id)
  .eq('status', 'in_progress')
  .eq('total_to_classify', 0);

// Check if there's already an active job with work
const { data: existingJob } = await supabase
  .from('classification_jobs')
  .select('*')
  .eq('workspace_id', workspace_id)
  .eq('status', 'in_progress')
  .gt('total_to_classify', 0)
  .order('updated_at', { ascending: false })
  .limit(1)
  .single();

if (existingJob) {
  // Resume existing job instead of creating new one
  job = existingJob;
} else {
  // Create new job...
}
```

### Step 4: Heartbeat During Long Operations

Add periodic progress updates during LLM calls to prevent false-positive stall detection:

```typescript
// Inside the sub-batch processing loop
if (subBatchIndex % 2 === 0) {
  await refreshLock(supabase, workspace_id, LOCK_FUNCTION_NAME);
  await supabase
    .from('classification_jobs')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', job.id);
}
```

### Step 5: Graceful Degradation on Persistent Errors

If LLM keeps failing, don't let the pipeline die silently:

```typescript
if (consecutiveFailures >= MAX_RETRIES) {
  console.error(`[${FUNCTION_NAME}] Too many consecutive failures, pausing for extended backoff`);
  
  await supabase
    .from('classification_jobs')
    .update({ 
      status: 'paused',
      last_error: 'Too many LLM failures, waiting for retry',
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);
  
  // Self-invoke with long delay (30 seconds)
  chainNextBatch(supabaseUrl, FUNCTION_NAME, {
    workspace_id,
    job_id: job.id,
    _relay_depth: _relay_depth + 1,
    _sleep_ms: 30000,
  }, supabaseServiceKey);
}
```

---

## Technical Summary

| File | Changes |
|------|---------|
| `pipeline-watchdog/index.ts` | Single-job-per-workspace logic, skip ghost jobs, 8-min threshold |
| `email-classify-v2/index.ts` | Ghost job cleanup, existing job reuse, heartbeat updates, paused state |
| Database (one-time) | Clean up existing ghost jobs |

---

## Expected Outcome After Implementation

| Scenario | Before | After |
|----------|--------|-------|
| Edge function dies silently | Stuck for 15 hours | Resumed in ~2 minutes |
| Ghost jobs created | Resurrected forever | Auto-cleaned up |
| Multiple jobs per workspace | Causes confusion | Only ONE active |
| Rate limiting | Sometimes stalls | Graceful backoff + retry |
| LLM errors | Silent death | Pauses + retries with visibility |

---

## Google Auth Question

**Yes, Lovable Cloud now supports Google OAuth!** Two options:

1. **Managed by Lovable (default)** - Zero configuration needed
2. **Bring Your Own Key (BYOK)** - Use your own Google Cloud credentials

This is separate from the email classification pipeline and works out of the box. If you want to add Google login to BizzyBee, I can implement that after we stabilize the import pipeline.

