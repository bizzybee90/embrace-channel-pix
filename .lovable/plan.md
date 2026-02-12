

# Fix Website FAQ Extraction Quality

## Problem Summary

The website knowledge extraction pipeline has several critical issues causing 185 duplicate/contradictory FAQs instead of ~30-40 clean ones:

1. **Deduplication is broken** - The `match_faqs` database function queries the `faqs` table, but `process-own-website-scrape` inserts into `faq_database`. Every similarity check returns zero matches, so nothing is ever deduplicated.

2. **No location page awareness** - Your site has ~20 location pages (e.g., `/window-cleaning-dunstable`, `/window-cleaning-flitwick`) that all contain the same core content with the town name swapped. Each page generates 8 near-identical FAQs independently.

3. **No contradiction detection** - Conflicting facts (cash vs card-only, different price ranges, different service frequencies) all get stored as equally valid.

4. **No post-extraction consolidation** - Unlike the competitor pipeline which has a dedicated `competitor-dedupe-faqs` step with embeddings, the own-website pipeline has no equivalent.

## Solution: Three-Phase Fix

### Phase 1: Fix the broken dedup function

Update the `match_faqs` database function to query `faq_database` instead of `faqs`, so the existing per-FAQ similarity check actually works.

### Phase 2: Add location page detection and skipping

In `process-own-website-scrape`, detect location/area pages by URL pattern (e.g., URLs containing town names, `/area/`, or matching a pattern like `/service-location`). Group them and only process 1-2 representative location pages instead of all 20+. The rest get marked as `skipped_duplicate_location`.

### Phase 3: Add a post-extraction consolidation pass

After all pages are processed, run a consolidation step (similar to what `competitor-dedupe-faqs` does):

1. Fetch all FAQs just stored for this job
2. Generate embeddings (already done during storage)
3. Find clusters of similar FAQs (similarity > 0.90)
4. For each cluster, keep the highest-quality entry and soft-delete the rest
5. Flag any contradictions (same topic, conflicting answers) for review

This brings the own-website pipeline to parity with the competitor pipeline's quality.

## Technical Details

### Database Migration

- Update `match_faqs` function to query `faq_database` table instead of `faqs`

### Edge Function: `process-own-website-scrape/index.ts`

**Location page detection** (in both `processDataset` and `processFirecrawl`):
- After storing page records, identify location pages by URL patterns
- Group them and keep only 2 representative pages; skip the rest
- Add `location_group` page type

**Post-extraction consolidation** (new function at end of processing):
- Query all FAQs with `workspace_id` and `is_own_content = true` that were just stored
- Use existing embeddings to find clusters with similarity > 0.90
- Merge clusters: keep highest quality_score entry, delete others
- Log dedup stats (e.g., "Consolidated 185 FAQs down to 34")

### Expected Outcome

- Location pages: ~20 pages skipped, saving API calls and preventing bulk duplication
- Dedup actually works: catches the remaining near-duplicates across non-location pages
- Post-consolidation: final count should land at 25-40 unique, high-quality FAQs
- Contradictions: flagged in logs for future review capability

### Files Changed

1. **New SQL migration** - Fix `match_faqs` to query correct table
2. **`supabase/functions/process-own-website-scrape/index.ts`** - Add location detection + consolidation pass

