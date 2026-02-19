
# Onboarding Process Audit — Full Findings & Fix Plan

## Current State (What We Know From the Database)

- `email_provider_configs`: **0 rows** — email is NOT connected
- `email_import_progress`: **0 rows** — no import has ever started
- `scraping_jobs`: **0 rows** — jobs were cleared but new scrape hasn't run
- `faq_database`: **18 rows** — from the previous scrape (still has data from before the delete)
- `n8n_workflow_progress`: **2 rows** — `own_website_scrape` (pending, from 3:37am) and `search_terms_config` (completed)
- `competitor_sites`: **0 rows** — no competitor discovery has run
- `competitor_research_jobs`: **0 rows** — none

---

## Issue 1 — Email OAuth Only Works on Published URL (BLOCKER)

**Root cause:** `aurinko-auth-callback` hardcodes `appOrigin = 'https://embrace-channel-pix.lovable.app'` as the redirect destination after OAuth completes. Google OAuth also only allows this domain as a valid redirect URI.

**Symptoms:** When you click "Connect Gmail" from the preview URL, Aurinko redirects back to the *published* URL's `/onboarding?aurinko=success` — not the preview. So on the preview URL, `checkEmailConnection()` never sees the success param, and the database record still gets written (by the edge function) but the frontend on the preview doesn't know.

**Fix:** After OAuth completes, the edge function redirects to the published URL, which is correct. But the user is *testing on the preview URL*. The `email_provider_configs` record IS being written server-side. The issue is that the `aurinko-auth-start` function passes `window.location.origin` as the `origin` in state — but the callback ignores it and always uses the hardcoded published URL. So the connection happens but the **preview window never sees the redirect**.

**Resolution for testing:** The email OAuth **must be tested on the published URL**. However, we can also make the UI on the preview URL re-check for connection status on mount (which it already does), so if you connect on the published URL and then come back to preview, it should show as connected.

---

## Issue 2 — Website Scrape FAQs Are Orphaned (Data Integrity)

**Root cause:** The `scraping_jobs` table was cleared (`0 rows`) but `faq_database` still has 18 rows from the previous scrape. When `KnowledgeBaseStep` mounts, it checks for a completed `scraping_jobs` row first — finds none — then queries `faq_database` for `is_own_content=true` rows and finds 18. So it shows **"Knowledge Base Ready"** immediately (the `already_done` state).

This means when we click "Start Scraping Again", it goes straight to the `already_done` screen with stale data rather than running a fresh scrape.

**Fix:** When the user clicks "Re-scrape", we need to also delete the stale `faq_database` rows for `is_own_content=true` before starting. The "Re-scrape" button in `KnowledgeBaseStep` currently just calls `setStatus('idle')` without clearing DB rows — so the next mount immediately re-detects the stale 18 rows and shows `already_done` again.

---

## Issue 3 — `startImport` in EmailConnectionStep Goes Straight to `onNext()` (UX Break)

**Root cause:** In `EmailConnectionStep.startImport()`, after triggering the n8n workflow, it immediately calls `onNext()` (line 326) and advances to the Progress Screen — **before** the user sees any import feedback. The `email_classification` workflow itself will likely fail because there are no emails in `email_import_queue` (the Aurinko sync hasn't happened yet).

**The correct flow should be:**
1. User connects email → Aurinko OAuth → `aurinko-auth-callback` triggers `email-import-v2`
2. `email-import-v2` imports emails → on completion, chains email classification
3. `onNext()` should only be called once connected; the email import runs in the background on the Progress Screen

The "Start AI Training" button is being used as a manual trigger for a flow that should be automatic after OAuth. It's redundant and causes confusion.

---

## Issue 4 — ProgressScreen "Continue" Button Never Unlocks

**Root cause:** `allComplete` requires `isDiscoveryComplete && isScrapeComplete && isEmailComplete`. Since:
- `competitor_research_jobs` = 0 (no discovery ever ran)
- `n8n_workflow_progress` has no `competitor_discovery` row
- `email_import_progress` = 0 rows

All three tracks stay at `pending` status forever, and the "Continue" button is permanently disabled (spinning). There's a "Skip for now" link, but it's small and users may miss it.

---

## Issue 5 — `scraping_jobs` Still Shows as `pending` After Scrape Completes

**Root cause:** n8n completes the scrape and writes to `faq_database`, but never updates the `scraping_jobs` row to `completed`. The `KnowledgeBaseStep` polling logic is supposed to do this client-side (via `markComplete()`), but:
- The `stableCountRef` needs 2 consecutive polls with the same count ≥5
- If the user navigates away before 2 stable polls, `scraping_jobs` stays `pending`
- On re-entry, `KnowledgeBaseStep` checks `scraping_jobs` first (finds `pending`), then falls through to `faq_database` count check (finds 18), showing `already_done` — which is correct, but the `scraping_jobs` row stays dirty

This isn't blocking, but causes the "Re-scrape" flow to be confused.

---

## Fix Plan

### Fix A — Clear stale `faq_database` rows when Re-scraping (KnowledgeBaseStep)

The "Re-scrape" button currently only resets local UI state. It needs to also delete `faq_database` rows where `is_own_content=true` AND delete/reset the `scraping_jobs` row, so that on next mount it shows `idle` rather than `already_done`.

```
// In the Re-scrape button onClick:
await supabase.from('faq_database').delete()
  .eq('workspace_id', workspaceId).eq('is_own_content', true);
await supabase.from('scraping_jobs').delete()
  .eq('workspace_id', workspaceId);
setExistingKnowledge(null);
setStatus('idle');
```

### Fix B — Remove the "Start AI Training" manual trigger; make email step self-contained

The `EmailConnectionStep` should:
1. Show "Connect Email" → user completes OAuth → returns with `?aurinko=success`
2. On success, show the connected email and a simple "Continue" button (calling `onNext()`)
3. Remove `startImport()` entirely — email import is automatically triggered by `aurinko-auth-callback` via `chainNextBatch`
4. The Progress Screen is where the email classification status is tracked

### Fix C — Add a visible "Skip & Continue" button to the ProgressScreen

Since all three tracks may take 3–10 minutes (especially competitor discovery which requires n8n), make the "Skip for now" button more prominent — upgrade it from a ghost link to an outline button so users don't get stuck.

### Fix D — Ensure `scraping_jobs` is marked `completed` at the end of the `startScraping()` flow

Currently the `markComplete()` function in `KnowledgeBaseStep` updates `scraping_jobs` only if `jobDbId` is set. The issue is that `jobDbId` may not be set if the component remounts. We should query for the most recent `scraping_jobs` row by `workspace_id` if `jobDbId` is null.

---

## Implementation Files to Change

```text
src/components/onboarding/KnowledgeBaseStep.tsx
  - Fix A: Delete faq_database + scraping_jobs rows on Re-scrape click
  - Fix D: Fallback query for jobDbId in markComplete()

src/components/onboarding/EmailConnectionStep.tsx
  - Fix B: Replace "Start AI Training" button with simple "Continue" button
  - Remove startImport(), importStarted state, and polling logic (no longer needed)

src/components/onboarding/ProgressScreen.tsx
  - Fix C: Make "Skip for now" button more visible (outline style)
  - No logic changes needed
```

---

## Testing Instructions After Fixes

1. **Website Scrape:** Open onboarding on the **preview URL**, go to Knowledge Base step, click "Re-scrape" → it should clear the 18 stale FAQs and start fresh polling
2. **Email OAuth:** Must be tested on the **published URL** (`https://embrace-channel-pix.lovable.app`) — click "Connect Gmail", complete Google OAuth, confirm redirect back shows connected email, then click "Continue"
3. **Progress Screen:** After email step, the Progress Screen will show email import progressing automatically (no manual trigger needed). Competitor discovery needs n8n to be configured to receive the trigger
