
# Competitor Research Pipeline: Complete Fix

## Problems Identified

### Problem 1: "0 Valid Websites"
The UI shows `sites_validated: 0` because:
- The pipeline uses **Apify deep scraping** (not the Firecrawl-based `competitor-scrape-worker`)
- When Apify webhook fires, `handle-scrape-complete` stores pages in `competitor_pages` table
- But it updates `competitor_sites.scrape_status` to `'completed'` without properly tracking "validated" count
- The job shows `sites_validated: 0` even though 59 sites were scraped

**Root cause**: The `sites_validated` column is never being set correctly. The pipeline skips a proper validation step.

### Problem 2: Stage 4 Stuck "In Progress" for Days
The job `e22e8b39-5c4f-4569-95cc-2252aa44e2f7` shows:
- Status: `extracting` (stuck since Jan 30)
- 59 sites completed scraping, 48 pages scraped
- Only 1 page exists in `competitor_pages` table (from a different old job)
- **The Apify webhook likely never fired** or failed silently

**Root cause**: `handle-scrape-complete` was never called (no logs found), OR the scraped data wasn't stored in `competitor_pages`. Without pages in that table, `extract-competitor-faqs` finds 0 pages and exits immediately.

### Problem 3: Scraping Only Gets Homepages
Looking at the scraped data:
- `pages_scraped: 0` for all completed sites
- Content is stored directly in `competitor_sites.content_extracted` (max 5000 chars)
- This is from the OLD `competitor-scrape-worker` function using Firecrawl

But the NEW pipeline uses Apify with `maxCrawlDepth: 2` and should scrape 8 pages per site. The confusion is that **two different scraping paths exist**:
1. **Apify path** (used by `competitor-scrape-start`) → stores in `competitor_pages` → uses `extract-competitor-faqs`
2. **Firecrawl path** (used by `competitor-scrape-worker`) → stores in `competitor_sites.content_extracted` → uses `competitor-faq-per-site`

### Problem 4: Runaway Costs
The extraction function keeps self-invoking when it finds 0 pages, then exits silently. The job stays in `extracting` status forever. Meanwhile, the UI keeps polling, and any manual retries might spin up duplicate processes.

---

## Solution: Unified Pipeline with Recovery

### Phase 1: Fix the Current Stalled Job

1. **Add a "Recover Stalled Job" button** that:
   - Checks if Apify run completed (using `scrape_run_id`)
   - Manually fetches dataset if webhook failed
   - Re-triggers extraction if pages exist
   - Marks job as `failed` with clear error if unrecoverable

2. **Fix the status tracking** to correctly show:
   - `sites_validated` = count of sites that were selected for scraping
   - `sites_scraped` = count of sites with successful content

### Phase 2: Consolidate on Single Pipeline

Choose ONE scraping approach (recommend **Apify** for reliability):
- Remove or deprecate `competitor-scrape-worker` (Firecrawl path)
- Ensure `handle-scrape-complete` properly stores all pages
- Add fallback polling if webhook doesn't arrive within 10 minutes

### Phase 3: Add Pipeline Watchdog Integration

Extend the existing `pipeline-watchdog` to:
- Detect jobs stuck in `extracting` for >15 minutes with 0 FAQs extracted
- Check Apify run status directly
- Either recover the data or mark job as failed

---

## Technical Changes

### File 1: `src/components/onboarding/CompetitorReviewScreen.tsx`
- Update status text to show "Valid Websites: X of Y selected" (not 0)
- Use `sites_approved` count instead of `sites_validated`

### File 2: `supabase/functions/competitor-scrape-start/index.ts`
- Set `sites_validated = selectedSites.length` when starting scrape (they've been validated by user selection)

### File 3: `supabase/functions/handle-scrape-complete/index.ts`
- Add logging to confirm webhook received
- Ensure ALL scraped pages get inserted (current code looks correct but may have issues with large datasets)
- Add error handling for Apify dataset fetch failures

### File 4: `supabase/functions/extract-competitor-faqs/index.ts`
- **Critical fix**: When 0 pages found, check if this is a bug vs expected
- If `job.pages_scraped > 0` but `competitor_pages` count is 0 → something went wrong → mark job as `error`
- Prevent infinite self-invocation on empty data

### File 5: NEW `supabase/functions/recover-competitor-job/index.ts`
- Manual recovery function that:
  1. Fetches Apify run status using `scrape_run_id`
  2. If succeeded, fetches dataset and stores pages
  3. Triggers extraction
  4. If failed, marks job with error message

### File 6: `src/components/onboarding/CompetitorPipelineProgress.tsx`
- Show "Recover" button when job is stalled (>15 min in extracting with 0 FAQs)
- Use `sites_approved` for "validated" display
- Add elapsed timer for Stage 4 extraction like Stage 1 has

---

## Summary of Fixes

| Issue | Root Cause | Fix |
|-------|------------|-----|
| 0 valid websites | `sites_validated` never set | Set it in `competitor-scrape-start` |
| Stage 4 stuck | Webhook never fired or pages not stored | Add recovery function + watchdog |
| Only homepage scraped | Confusion - actually uses Apify depth 2 | Data just wasn't retrieved properly |
| Runaway costs | Extraction self-invokes on empty data | Add early exit + error status |

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/functions/competitor-scrape-start/index.ts` | Modify - set `sites_validated` |
| `supabase/functions/handle-scrape-complete/index.ts` | Modify - add logging, fix domain matching |
| `supabase/functions/extract-competitor-faqs/index.ts` | Modify - add empty page guard |
| `supabase/functions/recover-competitor-job/index.ts` | Create - manual recovery function |
| `src/components/onboarding/CompetitorPipelineProgress.tsx` | Modify - add recovery UI, fix validated display |
