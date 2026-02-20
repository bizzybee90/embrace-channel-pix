

# Fix: Stop Auto-Firing FAQ Generation — Let Users Review Competitors First

## Problem

The Progress Screen has a race condition: when competitor discovery completes and sets status to `review_ready`, **two things happen simultaneously**:
1. The `InlineCompetitorReview` panel appears (so users can review/add competitors)
2. The `faq_generation` workflow auto-fires immediately (line 564)

This means the scrape always starts before the user can review or add manual competitors. In your case, because the discovered competitors were lost from the earlier cleanup, only the 1 manually added competitor was sent to n8n instead of all 21.

## Solution

Remove the auto-fire behaviour. Instead, when discovery completes:
1. Show the `InlineCompetitorReview` panel with **all** discovered competitors listed (checkboxes, add/remove)
2. The user reviews the list, optionally adds manual competitors
3. The user clicks **"Start Analysis"** to trigger `faq_generation` with all selected competitors
4. Only then does scraping begin

This is exactly what the `InlineCompetitorReview` component already supports — it has a "Start Analysis" button that calls `trigger-n8n-workflow` with `faq_generation`. The only change needed is to **stop bypassing it**.

## Technical Changes

### 1. `src/components/onboarding/ProgressScreen.tsx`

**Remove the auto-trigger block** (lines 562-571):
```
// DELETE this block:
if (scrapeRecord?.status === 'review_ready' && !autoScrapeTriggeredRef.current) {
  autoScrapeTriggeredRef.current = true;
  supabase.functions.invoke('trigger-n8n-workflow', {
    body: { workspace_id: workspaceId, workflow_type: 'faq_generation' },
  }).catch(...);
}
```

**Update `InlineCompetitorReview` rendering** (line 712-719): Remove the `autoStarted` prop (it will always be false now) and keep the panel visible until the user clicks "Start Analysis":
- Pass `autoStarted={false}` so the "Start Analysis" button is always visible when `review_ready`
- Remove the `autoScrapeTriggeredRef` since it's no longer needed

**Update `onStartAnalysis` callback**: Instead of just dismissing the panel, keep it visible but switch to showing the "Re-run Analysis" button after the first trigger (the existing `scrapeComplete` logic handles this).

### 2. `supabase/functions/trigger-n8n-workflow/index.ts` — `faq_generation` branch

**Filter by `is_selected`** (currently line ~258 only filters by `status != 'rejected'`). Add `.eq('is_selected', true)` so only user-confirmed competitors are sent to n8n. This ensures the checkbox selections in the UI are respected.

### 3. No changes to `n8n-competitor-callback`

The callback already correctly sets `review_ready` without auto-triggering. That's the right behaviour.

## Summary of UX Flow After Fix

```text
Discovery completes
       |
       v
Progress Screen shows "Finding Competitors: Complete"
       |
       v
InlineCompetitorReview panel appears with all discovered
competitors listed (checkboxes, sorted by relevance)
       |
       v
User can: toggle selections, add manual URLs, remove entries
       |
       v
User clicks "Start Analysis (N competitors)"
       |
       v
faq_generation triggers with only is_selected=true competitors
       |
       v
Scraping progress shown, panel switches to "Re-run Analysis"
```

## Files Modified

| File | Change |
|------|--------|
| `src/components/onboarding/ProgressScreen.tsx` | Remove auto-trigger block, remove `autoScrapeTriggeredRef`, always show Start Analysis button on `review_ready` |
| `supabase/functions/trigger-n8n-workflow/index.ts` | Add `is_selected = true` filter to `faq_generation` competitor query |

