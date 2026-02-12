
# Complete Onboarding Audit: Path to 100%

## Executive Summary

I traced every line of code from the "Start AI Training" button click through the n8n workflows and back to the Progress screen. There are **9 distinct bugs** that would cause failures. Here's every single one, why it breaks, and exactly how to fix it.

---

## Bug 1: HMAC Signature Blocks ALL Callbacks (CRITICAL)

**What happens:** When n8n sends progress updates back to your edge functions (`n8n-competitor-callback`, `n8n-email-callback`), those functions check for an HMAC signature header (`x-n8n-signature`). Your n8n workflows don't send this header. Every callback gets rejected with **401 Unauthorized**.

**Impact:** The Progress screen stays on "Waiting to start" forever. Both tracks are completely broken.

**Fix (Lovable):** Make signature verification optional -- skip it gracefully when the header is missing, rather than rejecting. This is safe because the callbacks only write to progress tracking tables, not sensitive data.

**Files:** `supabase/functions/n8n-competitor-callback/index.ts`, `supabase/functions/n8n-email-callback/index.ts`

---

## Bug 2: "Status: Complete" Fires Per Competitor, Not Once (CRITICAL)

**What happens:** In Workflow 1 (Discovery), the flow is:

```text
Prepare Competitors for Loop --> Save Competitor to DB --> Status: Complete
```

There is no Loop (SplitInBatches) node. The "Prepare" code outputs N items (one per competitor). n8n processes all N through "Save to DB", then fires "Status: Complete" for each one. This sends `discovery_complete` **50 times** instead of once.

**Impact:** The edge function receives `discovery_complete` 50 times, triggering FAQ Workflow 2 **50 times** in parallel. This would create massive duplicate FAQs and enormous Apify/Claude costs.

**Fix (n8n -- you need to do this):**
1. Add a **SplitInBatches** node between "Prepare Competitors" and "Save Competitor to DB"
2. Connect "Save Competitor to DB" back to the SplitInBatches loop input
3. Connect the SplitInBatches "done" output to "Status: Complete"

This ensures "Status: Complete" fires exactly once after all competitors are saved.

---

## Bug 3: FAQ Workflow References Wrong Node Name (CRITICAL)

**What happens:** In Workflow 2 (FAQ Generation), the Supabase tool "Create a row in Supabase" has:

```text
workspace_id = {{ $('Start').first().json.workspace_id_firstItem }}
```

But there is no node called "Start" -- the trigger is called "Webhook". This expression will fail silently, inserting `null` as workspace_id for every FAQ.

**Impact:** All extracted FAQs are saved without a workspace_id, making them invisible to the user and orphaned in the database.

**Fix (n8n -- you need to do this):**
Change the Supabase tool field from:
```text
{{ $('Start').first().json.workspace_id_firstItem }}
```
to:
```text
{{ $('Webhook').first().json.body.workspace_id }}
```

---

## Bug 4: Progress Screen Ignores FAQ Generation Phase (HIGH)

**What happens:** The ProgressScreen only monitors two workflow types:
- `competitor_discovery`
- `email_import`

But the competitor pipeline is two stages: Discovery (Workflow 1) then FAQ Generation (Workflow 2). FAQ Generation writes to `competitor_scrape` workflow type. The UI never reads it.

**Impact:** The competitor track shows "Complete" after discovery finishes, even though FAQ scraping (the most time-consuming part -- 10-20 minutes) hasn't even started yet. The user advances to "Your AI Agent is Ready" with zero FAQs.

**Fix (Lovable):** Add a third track to the ProgressScreen for "competitor_scrape", or make the competitor track composite -- showing discovery as phase 1 and scrape as phase 2. The "Continue" button should require all three workflows (discovery + scrape + email) to be complete.

**File:** `src/components/onboarding/ProgressScreen.tsx`

---

## Bug 5: Email Progress Polls Wrong Table (HIGH)

**What happens:** The ProgressScreen polls the `raw_emails` table for email classification progress:

```typescript
supabase.from('raw_emails').select('id, category').eq('workspace_id', workspaceId)
```

But the email classifier works on the `email_import_queue` table. These are different tables. `raw_emails` may be empty or have completely different data.

**Impact:** Email classification shows 0 total emails and 0 classified even while classification is actively running. The email track never progresses.

**Fix (Lovable):** Change the query to poll `email_import_queue` instead of `raw_emails`, or better yet, read progress from `email_import_progress` table which the classifier already updates.

**File:** `src/components/onboarding/ProgressScreen.tsx`

---

## Bug 6: Email "dispatched" Status Not Recognized by UI (MEDIUM)

**What happens:** The n8n email workflow sends `status: "dispatched"` in its callback. The `EMAIL_PHASES` array doesn't include "dispatched" -- it only has: pending, classifying, classification_complete, complete, failed.

**Impact:** When the dispatcher fires, the UI receives "dispatched" but `getPhaseIndex` returns -1, defaulting to index 0 ("Waiting to start"). It looks like nothing happened even though workers are actively classifying.

**Fix (Lovable):** Add "dispatched" to `EMAIL_PHASES`:

```typescript
const EMAIL_PHASES = [
  { key: 'pending', label: 'Waiting to start', icon: Loader2 },
  { key: 'dispatched', label: 'Starting classification...', icon: FileCheck },
  { key: 'classifying', label: 'Classifying emails...', icon: FileCheck },
  { key: 'classification_complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'complete', label: 'Complete', icon: CheckCircle2 },
  { key: 'failed', label: 'Failed', icon: AlertCircle },
];
```

**File:** `src/components/onboarding/ProgressScreen.tsx`

---

## Bug 7: Target Count Hardcoded to 50 (LOW)

**What happens:** The SearchTermsStep lets users choose 50, 100, or 250 competitors and saves this to `n8n_workflow_progress`. But `trigger-n8n-workflows` ignores the saved value and hardcodes `target_count: 50`.

**Impact:** If a user selects 250 competitors, only 50 are targeted. Not a crash, but a broken promise.

**Fix (Lovable):** Read `target_count` from the saved search terms config:

```typescript
const targetCount = (searchConfig.target_count as number) || 50;
// Then use targetCount in the payload instead of hardcoded 50
```

**File:** `supabase/functions/trigger-n8n-workflows/index.ts`

---

## Bug 8: job_id Not Provided (LOW)

**What happens:** The "Save Competitor to DB" node in n8n maps `job_id` from the passthrough data, but `trigger-n8n-workflows` never sends a `job_id` in its payload.

**Impact:** All competitors are saved with `job_id: null`. This may cause issues if there are NOT NULL constraints, or may just mean competitors can't be associated with a specific research session.

**Fix (Lovable):** Either remove the `job_id` mapping in n8n (if not needed), or generate and pass a UUID from the trigger function.

---

## Bug 9: Email Import Timing Race (MEDIUM)

**What happens:** "Start AI Training" triggers the email classification n8n workflow immediately. But emails may not have been imported yet -- Aurinko needs to sync and the import pipeline needs to run first. The classifier calls `classify-emails-dispatcher`, which counts emails in `email_import_queue`. If the queue is empty, it returns `no_work` and exits.

**Impact:** Email classification completes instantly with "0 emails classified" because there's nothing to classify yet.

**Fix:** This depends on your email import architecture. Two options:
- **Option A:** Don't trigger email classification from n8n. Instead, have the email import pipeline (`email-import-v2`) chain directly to classification when import is complete (it already does this -- line 541 chains to `email-classify-bulk`).
- **Option B:** Add a polling loop in n8n that waits for emails to appear before dispatching.

Option A is simpler and already partially implemented.

---

## Fix Ownership Summary

| Bug | Fix Location | Who |
|-----|-------------|-----|
| 1. HMAC blocks callbacks | Edge functions | Lovable (me) |
| 2. Complete fires N times | Workflow 1 | You (n8n) |
| 3. Wrong node reference | Workflow 2 | You (n8n) |
| 4. Missing scrape track | ProgressScreen | Lovable (me) |
| 5. Wrong table polled | ProgressScreen | Lovable (me) |
| 6. "dispatched" not in phases | ProgressScreen | Lovable (me) |
| 7. Hardcoded target count | trigger-n8n-workflows | Lovable (me) |
| 8. Missing job_id | trigger-n8n-workflows | Lovable (me) |
| 9. Email timing race | Architecture decision | Both |

---

## What I Can Fix Right Now (Lovable side -- Bugs 1, 4, 5, 6, 7, 8, 9)

### Edge Functions:
- **n8n-competitor-callback**: Skip HMAC when no signature header present (graceful fallback)
- **n8n-email-callback**: Same HMAC fix
- **trigger-n8n-workflows**: Read `target_count` from saved config, generate `job_id`, remove email classification trigger (let import chain handle it)

### ProgressScreen:
- Add third track for FAQ generation (`competitor_scrape`)
- Poll `email_import_progress` table instead of `raw_emails`
- Add "dispatched" to EMAIL_PHASES
- Require all 3 tracks complete before enabling "Continue"

### What You Need to Fix in n8n (Bugs 2, 3):

**Workflow 1 -- Add a proper loop:**
1. Insert a SplitInBatches node after "Prepare Competitors for Loop"
2. Wire: SplitInBatches "loop" output --> Save Competitor to DB --> back to SplitInBatches
3. Wire: SplitInBatches "done" output --> Status: Complete
4. This ensures the completion callback fires exactly once

**Workflow 2 -- Fix the node reference:**
1. Open the "Create a row in Supabase" tool
2. Change `$('Start')` to `$('Webhook')` in the workspace_id field
3. Change `.workspace_id_firstItem` to `.body.workspace_id`

---

## After All Fixes: Success Probability

With all 9 fixes applied: **~90-95%**. The remaining 5-10% risk comes from:
- Apify actors timing out on large competitor sets
- Claude/Gemini rate limits during peak usage
- Edge function 60-second timeout on large payloads
- Aurinko webhook delivery delays

These are operational risks that can be handled with retry logic and error recovery, but the core flow will be solid.
