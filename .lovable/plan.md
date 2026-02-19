
## Problem Summary

When n8n finishes the website scrape, it inserts FAQs into `faq_database` but **never updates `scraping_jobs` status to `completed`**. The frontend (`WebsitePipelineProgress`) polls `scraping_jobs` exclusively, so it sees `pending` forever and eventually shows an error — even though the data is there. The 3-minute auto-retry also fires a second n8n execution via Firecrawl unnecessarily.

## Solution: Direct FAQ Polling in KnowledgeBaseStep

Replace the `WebsitePipelineProgress` component (which relies on `scraping_jobs` callbacks) with a lightweight inline polling UI inside `KnowledgeBaseStep` that watches `faq_database` directly. When FAQs appear, update `scraping_jobs` to `completed` in the database, then show the success screen.

## Files to Change

### 1. `src/components/onboarding/KnowledgeBaseStep.tsx`

**Key changes:**

**New state:**
- Replace `'running'` status with a `'polling'` status that drives the new inline progress UI
- Add `pollingFaqCount` state to display live FAQ count as n8n inserts rows
- Add `jobDbId` (the `scraping_jobs.id` returned from `trigger-n8n-workflow`) for the final update

**After `startScraping()` succeeds:**
- Switch to `'polling'` status instead of `'running'` (no longer mount `WebsitePipelineProgress`)
- Store the `jobId` from the response for the DB update

**New polling `useEffect` (active only when `status === 'polling'`):**
- Polls `faq_database` every 8 seconds: `select count(*) where workspace_id = ... and is_own_content = true`
- Updates `pollingFaqCount` on each tick so the user sees live growth
- Detects completion: two consecutive polls with the same count ≥ 5 FAQs, OR 5-minute maximum timeout
- On completion:
  1. Calls `supabase.from('scraping_jobs').update({ status: 'completed', faqs_found: count, completed_at: now() }).eq('id', jobDbId)` — persists to DB so re-entry `checkExisting` works
  2. Sets `existingKnowledge` with the FAQ count
  3. Transitions to `'already_done'` to show the existing success UI (reuses the "Knowledge Base Ready" screen)
- On timeout (5 min): if count > 0, treat as complete; if count = 0, show error

**New `'polling'` render branch:**
- Shows a clean progress card:
  - Header: "Extracting your website knowledge..."
  - Subtitle: the website URL
  - Three stage rows (Discover, Scrape, Extract) — all show as `in_progress` spinner until FAQs appear, then animate to `done`
  - Live counter: `{pollingFaqCount} FAQs found so far` (updates in real-time)
  - Elapsed timer (seconds → minutes)
  - Skip button for impatient users

**Remove:** The `status === 'running'` branch that mounted `WebsitePipelineProgress` — no longer needed.

### 2. `src/components/onboarding/WebsitePipelineProgress.tsx` — Remove auto-retry

Disable the Firecrawl auto-retry `useEffect` (lines 337–349). The 3-minute trigger fires when `pagesFound === 0`, which is always the case in our n8n flow (n8n never updates `scraping_jobs.total_pages_found`). This was causing duplicate executions.

Change: Wrap the auto-retry effect body with an early return so it never fires, or simply remove the `onRetry` call inside it.

## Data Flow After Fix

```text
User clicks "Start Scraping"
  → trigger-n8n-workflow (creates scraping_jobs row, returns jobId)
  → KnowledgeBaseStep switches to 'polling'
  → n8n runs independently, inserts FAQs into faq_database (is_own_content=true)
  → Poll every 8s: SELECT COUNT(*) FROM faq_database WHERE workspace_id=... AND is_own_content=true
  → Count grows: 0 → 12 → 31 → 47 (shown live to user)
  → Two consecutive polls same count ≥ 5
  → UPDATE scraping_jobs SET status='completed', faqs_found=47, completed_at=now()
  → Transition to 'already_done' → show "Knowledge Base Ready" success screen
  → User clicks Continue
```

## What This Achieves

- No n8n changes required
- No duplicate Firecrawl executions
- User sees live FAQ count growing (better UX than a frozen spinner)
- `scraping_jobs` gets updated to `completed` in the DB — re-entry detection works correctly
- 5-minute safety timeout handles edge cases
- Skip button always available so users are never truly stuck
