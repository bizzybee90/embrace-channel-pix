
# Phase 1: Instant Onboarding with Background Deep Backfill

## Problem
When a user connects their email, the `email-import-v2` function imports ALL emails (up to 30,000) before chaining to classification. This means the user waits 30-60+ minutes on the Progress Screen before classification even begins, let alone voice learning.

## Solution: Two-Stage Import

Split the import into a **Speed Phase** (during onboarding) and a **Deep Backfill** (after onboarding completes).

```text
CURRENT FLOW:
  Email Connect --> Import 30,000 --> Classify 30,000 --> Voice Learn --> Done (60+ min)

NEW FLOW:
  Email Connect --> Import 2,500 --> Classify 2,500 --> Voice Learn --> Continue (3-5 min)
                         |
                    [User proceeds through onboarding]
                         |
                    Background: Import remaining 27,500 --> Classify --> Re-learn (silent)
```

## Changes

### 1. Database Migration
Add a `backfill_status` column to `email_import_progress` to track the background import state:
- `'pending'` -- backfill hasn't started yet
- `'running'` -- background import + classify in progress
- `'complete'` -- all historical emails processed

### 2. Edge Function: `email-import-v2` (modify)
- Accept a new `speed_phase` boolean parameter (default: `false`)
- When `speed_phase: true`:
  - Set `total_target` to **2,500** (1,250 SENT + 1,250 INBOX) regardless of `import_mode`
  - On completion, chain to `email-classify-bulk` as normal (this triggers voice learning when done)
  - Set `backfill_status = 'pending'` in `email_import_progress`
- When `speed_phase: false` (default / backfill mode): behaves exactly as today

### 3. Edge Function: `email-import-v2` completion chain (modify)
When the speed phase completes and chains to classification, also write `backfill_status: 'pending'` to `email_import_progress`. The actual backfill is triggered later.

### 4. New Edge Function: `backfill-classify`
A thin orchestrator that:
1. Reads the `email_import_jobs` record to get the original `import_mode` / `total_target`
2. Creates a new `email_import_jobs` record with `import_mode: 'backfill'` and the full target (e.g., 30,000)
3. Updates `email_import_progress.backfill_status = 'running'`
4. Invokes `email-import-v2` with the new job (non-speed-phase), which will skip already-imported emails (upsert with `ignoreDuplicates`)
5. The existing chain (`email-import-v2` --> `email-classify-bulk` --> `voice-learning`) handles the rest automatically
6. On completion, updates `backfill_status = 'complete'`

### 5. Trigger the Backfill
Modify the `voice-learning` completion path (or the `handlePartitionComplete` in `email-classify-bulk`) to fire-and-forget invoke `backfill-classify` when `backfill_status = 'pending'`. This means the backfill starts silently right after the speed phase's voice learning completes.

### 6. Edge Function: `trigger-n8n-workflows` (modify)
Currently this only triggers competitor discovery (email classification chains from `email-import-v2`). No changes needed here -- the import was already triggered during the Email Connection step.

### 7. `EmailConnectionStep.tsx` (modify)
When starting the import, pass `speed_phase: true` to `email-import-v2` so it only imports 2,500 emails. The `importMode` selection from the UI will be saved to `email_provider_configs` for the backfill to read later.

The import mode selector UI stays as-is -- the user still chooses how much history they want. The difference is that onboarding only processes 2,500 immediately, and the rest happens in the background.

### 8. `ProgressScreen.tsx` (modify)
- The email track will complete much faster (3-5 min instead of 30-60 min)
- Add a subtle "Deep learning will continue in the background" note when email track completes
- No blocking change -- the Continue button logic stays the same (all 3 tracks must complete)

### 9. `BackgroundImportBanner.tsx` (modify)
After onboarding, show a non-intrusive banner on the main app indicating background backfill progress:
- "BizzyBee is still learning from your older emails (45% complete)"
- Auto-dismiss when `backfill_status = 'complete'`

## What Stays the Same
- The parallel relay-race dispatcher and bulk classification logic
- The voice learning pipeline
- The competitor discovery/scrape pipeline
- The Progress Screen's 3-track model (discovery, scrape, email)
- All existing import modes and database tables

## Expected Impact
- **Onboarding time**: 30-60 min --> **3-5 min**
- **Voice learning quality**: Good from 2,500 emails, then improves silently with backfill
- **User experience**: No waiting, no blocking -- they can start using the app immediately
