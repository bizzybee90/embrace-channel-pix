
# Two Changes: Auto-Advance Competitor Scrape + Fix Email Import Chain

## What We're Fixing

### Change 1: Remove the manual "Start Analysis" gate

Currently, when competitor discovery finishes, the Progress Screen shows an "InlineCompetitorReview" panel and waits for the user to click "Start Analysis" before scraping begins. With 20+ competitors already found, this manual step adds unnecessary friction.

The fix automatically fires the `faq_generation` workflow as soon as `competitor_discovery` completes — no user click needed.

### Change 2: Fix the broken email import chain

The database currently shows:
- Email provider connected (`michael@maccleaning.uk`) but `sync_status: pending`
- Email import queue: 0 rows (import never ran)
- Email classification: ran against an empty queue, falsely reporting completion

The root cause: `email-import-v2` (historical Aurinko fetch) was never triggered after OAuth. The Progress Screen fired classification immediately without checking whether emails actually existed.

---

## Technical Changes (one file only)

**File:** `src/components/onboarding/ProgressScreen.tsx`

### 1. Add `autoScrapeTriggeredRef`

A new ref alongside the existing `autoTriggeredRef` to prevent the faq_generation trigger from firing more than once per session.

### 2. Auto-fire `faq_generation` in the polling loop

Inside `pollProgress()`, after the scrape record is read, add:

```typescript
if (scrapeRecord?.status === 'review_ready' && !autoScrapeTriggeredRef.current) {
  autoScrapeTriggeredRef.current = true;
  supabase.functions.invoke('trigger-n8n-workflow', {
    body: { workspace_id: workspaceId, workflow_type: 'faq_generation' },
  }).catch(...);
}
```

This replaces the manual "Start Analysis" button click.

### 3. Guard the `email_classification` auto-trigger

Replace the unconditional email classification trigger (lines 412–417) with a check:

```
IF email_import_queue count > 0 → trigger classification
IF email_import_queue count = 0 → skip (import hasn't run yet)
```

### 4. Add email import recovery trigger on mount

In the same `autoTrigger()` function, after the classification guard, add a recovery path:

```
IF email_provider_configs row exists with sync_status = 'pending'
AND email_import_queue count = 0
→ invoke email-import-v2 (fire-and-forget)
```

This handles the current stuck state and will also protect against future cases where OAuth completes but import doesn't auto-start.

### 5. Hide "Start Analysis" button once auto-trigger has fired

The `InlineCompetitorReview` panel stays visible as a read-only list (users can see which competitors were found), but the "Start Analysis" button is hidden once `autoScrapeTriggeredRef.current` is true. This keeps the UI informative without blocking progress.

---

## What Happens After These Changes

| Track | Current State | After Fix |
|---|---|---|
| Competitor Discovery | Complete (21 found) | No change |
| Competitor Scrape | Stuck waiting for manual click | Auto-starts immediately on next poll |
| Email Import | Never ran (queue is empty) | Auto-triggered on Progress Screen mount |
| Email Classification | Ran on empty queue (false complete) | Fires only after emails are in the queue |

---

## No Edge Function Changes Needed

`email-import-v2` and `trigger-n8n-workflow` already exist and handle these cases correctly. This is purely a frontend orchestration fix in `ProgressScreen.tsx`.

---

## Expected Timeline After Fix

- Competitor scrape: starts within ~10 seconds (next poll interval), takes 5–15 minutes for 21 competitors
- Email import: starts within ~5 seconds (on mount), takes 3–8 minutes for historical fetch
- Email classification: auto-chains after import completes (n8n handles this)
