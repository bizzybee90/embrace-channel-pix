# Fix Competitor Research Pipeline: Complete Target Count & Site Reuse

## ✅ IMPLEMENTATION COMPLETE

All changes have been implemented and deployed.

---

## Changes Made

### 1. UI: Switch to Apify-Based Discovery ✅
**File:** `src/components/onboarding/CompetitorResearchStep.tsx`
- Changed from `competitor-discover` (Google API, ~15-20 max) to `start-competitor-research` (Apify, 50-200)
- Removed redundant job creation in UI (now handled by edge function)
- Updated parameters: `industry`, `location`, `radiusMiles`, `maxCompetitors`

### 2. Backend: Fix UPSERT Logic ✅
**File:** `supabase/functions/handle-discovery-complete/index.ts`
- Changed from bulk insert with wrong conflict column to per-site check+update/insert
- Sites already in workspace are now "adopted" by new jobs (job_id updated)
- Reset status to 'approved' and scrape_status to 'pending' for re-scraping

### 3. Backend: Increase Apify Request Limit ✅
**File:** `supabase/functions/start-competitor-research/index.ts`
- Changed from `maxCompetitors + 20` (cap 100) to `maxCompetitors * 2` (cap 200)
- Accounts for ~50% filtering loss (directories, social media, no-website)

---

## Expected Behavior

| Target Count | Apify Request | After Filtering |
|--------------|---------------|-----------------|
| 50           | 100 places    | ~50 competitors |
| 100          | 200 places    | ~100 competitors |
| 250          | 200 places    | ~100-150 competitors* |

*Note: For 250+ targets, may need multiple search queries in future enhancement

---

## Verification Steps

1. Start a new competitor research with target count = 100
2. Job should show "discovering" status
3. Wait 1-3 minutes for Apify webhook
4. Check `competitor_sites` table for ~100 entries with current job_id
5. Scraping should proceed automatically
