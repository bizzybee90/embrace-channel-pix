
# Competitor Research Pipeline: Production-Grade Async Review Architecture

## ✅ IMPLEMENTED - January 30, 2026

This plan transformed the competitor research pipeline from a fragile "fire and hope" approach into a robust, async webhook-driven architecture with a **user review step**. The key innovation is pausing after discovery to let users approve/reject competitors and add manual URLs before expensive scraping begins.

### Implementation Summary

**Database:** Added `is_selected`, `location_data` columns + 30 new blocklist domains + `review_ready` status

**Backend:**
- `handle-discovery-complete` - Now stops at `review_ready`, removed `.slice(0,50)` limit, fixed `sites_validated` field
- `competitor-scrape-start` - New function with deep crawl config (maxCrawlDepth: 2, Playwright Chrome)

**Frontend:**
- `CompetitorReviewScreen.tsx` - New review UI with checkboxes, manual URL entry, cost estimate
- `CompetitorPipelineProgress.tsx` - Shows review screen when `review_ready`
- `CompetitorResearchStep.tsx` - Resumes `review_ready` jobs

---

## Current Problems Analysis

| Problem | Root Cause | Evidence |
|---------|------------|----------|
| **"0 valid websites confirmed"** | UI reads `sites_validated` but backend writes to `sites_filtered` | Line 249 of CompetitorPipelineProgress.tsx: `sitesValidated: data.sites_validated \|\| data.sites_approved \|\| 0` |
| **Only 48 of 99 sites scraped** | `slice(0, 50)` hardcoded in handle-discovery-complete (line 236) | Artificially limits even when 99 valid sites exist |
| **Only 1 page per site** | `maxCrawlDepth: 0` in scraper config (line 240) | Homepage-only mode misses FAQ/pricing/services pages |
| **Irrelevant results (directories)** | Blocklist has 24 domains, but misses many | yell.com is blocked but houzz.co.uk, trustpilot.com slip through |
| **No user control** | Pipeline auto-proceeds to scraping | Users can't remove bad sites or add known competitors |
| **Timeout risk** | Sync processing of 50+ sites in Edge Function | 10s CPU limit exceeded |

---

## New Architecture: 3-Stage Async Pipeline with Review Gate

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           STAGE 1: DISCOVERY                                     │
│                                                                                  │
│   User clicks "Start"          Apify runs              Webhook callback         │
│   ─────────────────────► (2-4 min async) ────────────► handle-discovery-complete│
│                                                                  │              │
│   Status: "discovering"                                          ▼              │
│   UI: Animated progress        compass/crawler-google-places     Filter sites   │
│                                with geocoded UK coordinates      Store in DB    │
│                                                                  │              │
│                                                                  ▼              │
│                                                       Status: "review_ready" ◄──┤
└─────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼ (PAUSE - Wait for user)
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        STAGE 2: REVIEW (NEW!)                                    │
│                                                                                  │
│   ┌───────────────────────────────────────────────────────────────────────────┐ │
│   │                     COMPETITOR REVIEW SCREEN                               │ │
│   │                                                                            │ │
│   │   Found 87 competitors in Luton for Window Cleaning                        │ │
│   │                                                                            │ │
│   │   ☑ ABC Window Cleaning  abcwindowcleaning.co.uk    ⭐ 4.8 (127 reviews)  │ │
│   │   ☑ Crystal Clear        crystalclear.co.uk         ⭐ 4.5 (89 reviews)   │ │
│   │   ☐ Yell.com             yell.com  ⚠️ Directory                           │ │
│   │   ☑ Sparkle Windows      sparklewindows.co.uk       ⭐ 4.2 (45 reviews)   │ │
│   │                                                                            │ │
│   │   ┌─────────────────────────────────────────────────────────────────────┐ │ │
│   │   │ + Add competitor: [lbcwindowcleaning.co.uk____________] [Add]       │ │ │
│   │   └─────────────────────────────────────────────────────────────────────┘ │ │
│   │                                                                            │ │
│   │   Selected: 82 competitors (~$8 estimated scrape cost)                     │ │
│   │                                                                            │ │
│   │   [Back]                               [Confirm & Start Deep Analysis]     │ │
│   └───────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼ (User clicks Confirm)
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           STAGE 3: DEEP SCRAPING                                 │
│                                                                                  │
│   competitor-scrape-start      Apify runs              Webhook callback         │
│   ─────────────────────► (5-15 min async) ────────────► handle-scrape-complete  │
│                                                                  │              │
│   Status: "scraping"           apify/website-content-crawler     ▼              │
│   UI: Progress bar             with Playwright + smart globs     Store pages    │
│                                                                  │              │
│   Config:                                                        ▼              │
│   - maxCrawlDepth: 2                                   Trigger extraction       │
│   - globs: [**/faq*, **/pricing*, **/services*]                  │              │
│   - crawlerType: "playwright:chrome"                             ▼              │
│   - ALL selected sites (no slice limit)               Status: "extracting"      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### Phase 1: Database Schema Updates

**1.1 Add columns to `competitor_sites` for review workflow:**

```sql
-- Add user review columns
ALTER TABLE competitor_sites
ADD COLUMN IF NOT EXISTS is_selected BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'maps'
  CHECK (source IN ('maps', 'manual', 'organic')),
ADD COLUMN IF NOT EXISTS location_data JSONB;

-- Add index for efficient review queries
CREATE INDEX IF NOT EXISTS idx_competitor_sites_job_selected 
  ON competitor_sites(job_id, is_selected) WHERE is_selected = true;

COMMENT ON COLUMN competitor_sites.is_selected IS 'User-togglable in review phase. true=will be scraped';
COMMENT ON COLUMN competitor_sites.source IS 'Discovery source: maps (Google Maps), manual (user-added), organic (future SERP)';
COMMENT ON COLUMN competitor_sites.location_data IS 'Raw Google Maps data: address, phone, rating, openingHours';
```

**1.2 Expand directory blocklist:**

```sql
INSERT INTO directory_blocklist (domain, reason) VALUES
  ('trustpilot.com', 'reviews'),
  ('houzz.co.uk', 'directory'),
  ('which.co.uk', 'directory'),
  ('lapage.co.uk', 'directory'),
  ('en-gb.facebook.com', 'social'),
  ('google.com', 'search'),
  ('gov.uk', 'government'),
  ('nhs.uk', 'government'),
  ('wikipedia.org', 'reference'),
  ('youtube.com', 'video'),
  ('instagram.com', 'social'),
  ('tiktok.com', 'social'),
  ('pinterest.com', 'social'),
  ('amazon.co.uk', 'marketplace'),
  ('ebay.co.uk', 'marketplace')
ON CONFLICT (domain) DO NOTHING;
```

---

### Phase 2: Backend Edge Functions

**2.1 Modify `handle-discovery-complete/index.ts`**

**Key Changes:**
1. Set status to `review_ready` instead of auto-starting scrape
2. Remove `slice(0, 50)` limit
3. Write to BOTH `sites_filtered` AND `sites_validated` to fix UI mismatch
4. Store `location_data` JSONB with full Google Maps info
5. Set `is_selected = true` for all valid competitors
6. DO NOT trigger scraping - wait for user

```typescript
// BEFORE (line 211):
status: validCompetitors.length > 0 ? 'scraping' : 'completed',

// AFTER:
status: validCompetitors.length > 0 ? 'review_ready' : 'completed',
sites_filtered: validCompetitors.length,
sites_validated: validCompetitors.length,  // Fix UI field mismatch!

// BEFORE (line 236):
const startUrls = validCompetitors.slice(0, 50).map(c => ({ url: c.url }))

// AFTER: Remove this section entirely - don't auto-start scraping
// The rest of the scraping logic (lines 236-287) should be REMOVED
```

**2.2 Create new `competitor-scrape-start/index.ts`**

This new function is triggered by the user clicking "Confirm & Start Analysis":

```typescript
// INPUTS: jobId, workspaceId, manualUrls (optional array)

// LOGIC:
// 1. Insert manualUrls into competitor_sites with source='manual', is_selected=true
// 2. Query competitor_sites WHERE job_id=jobId AND is_selected=true
// 3. Build startUrls array - NO slice limit!
// 4. Configure Apify website-content-crawler with:
//    - maxCrawlDepth: 2 (not 0!)
//    - maxCrawlPagesPerHostname: 8
//    - crawlerType: "playwright:chrome" (handles Wix/React/JS-heavy sites)
//    - saveMarkdown: true
//    - Priority globs: ['**/faq*', '**/pricing*', '**/services*', '**/about*']
//    - Exclude globs: ['**/blog/**', '**/privacy*', '**/terms*']
// 5. Set webhook to handle-scrape-complete
// 6. Update job status to 'scraping'
```

**2.3 Modify `handle-scrape-complete/index.ts`**

**Key Changes:**
1. Track which specific sites were successfully scraped
2. Update `competitor_sites.scrape_status` per-site
3. Store page content with proper metadata
4. Update accurate `sites_scraped` and `pages_scraped` counts

---

### Phase 3: Frontend UI Updates

**3.1 Create `CompetitorReviewScreen.tsx` (New Component)**

A dedicated screen for the `review_ready` state:

```typescript
interface CompetitorReviewScreenProps {
  workspaceId: string;
  jobId: string;
  onConfirm: (selectedCount: number) => void;
  onBack: () => void;
  onSkip: () => void;
}

// Features:
// - Fetch competitors from competitor_sites where job_id = jobId
// - Display as selectable list with checkboxes
// - Show: business_name, domain, rating, reviews_count
// - "Select All" / "Deselect All" toggles
// - Warning badge for known directories that slipped through
// - "Add competitor" input with URL validation
// - Cost estimate based on selected count
// - "Confirm & Start Deep Analysis" button
// - Loading state while calling competitor-scrape-start
```

**UI Layout:**
```text
┌──────────────────────────────────────────────────────────────────┐
│  Review Competitors                                              │
│  ────────────────────────────────────────────────────────────── │
│  We found 87 businesses. Uncheck any that aren't relevant.      │
│                                                                  │
│  [Search competitors...]                   [Select All] [Clear] │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ ☑ ABC Window Cleaning                                       │ │
│  │   abcwindowcleaning.co.uk · ⭐ 4.8 (127 reviews)           │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │ ☑ Crystal Clear Services                                   │ │
│  │   crystalclear.co.uk · ⭐ 4.5 (89 reviews)                 │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │ ☐ Houzz UK (⚠️ May be a directory)                         │ │
│  │   houzz.co.uk · No reviews                                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ───────────── Add a competitor we missed ─────────────────────│
│  [https://lbcwindowcleaning.co.uk        ]  [Add]               │
│                                                                  │
│  ────────────────────────────────────────────────────────────── │
│  82 competitors selected · Estimated cost: ~$8                   │
│                                                                  │
│  [Back]  [Skip]                    [Confirm & Start Analysis →] │
└──────────────────────────────────────────────────────────────────┘
```

**3.2 Modify `CompetitorPipelineProgress.tsx`**

Add handling for `review_ready` status:

```typescript
// In getStageStatuses():
case 'review_ready':
  return { discover: 'done', validate: 'done', scrape: 'pending', extract: 'pending', refine: 'pending' };

// In the component render, when status === 'review_ready':
// Show CompetitorReviewScreen instead of the pipeline stages
```

**3.3 Modify `CompetitorResearchStep.tsx`**

Update resume logic to handle `review_ready` status:

```typescript
// In activeStatuses Set:
const activeStatuses = new Set([
  'queued', 'geocoding', 'discovering', 'filtering',
  'review_ready',  // NEW - also resume this state
  'scraping', 'extracting', 'deduplicating', 'refining', 'embedding',
]);
```

---

### Phase 4: Deep Scraping Configuration

**Optimized Apify website-content-crawler settings:**

```typescript
const scrapeInput = {
  startUrls: selectedUrls.map(url => ({ url })),
  
  // DEPTH: Homepage + 2 levels (was 0)
  maxCrawlDepth: 2,
  
  // LIMIT per site to avoid runaway costs
  maxCrawlPagesPerHostname: 8,
  
  // TOTAL PAGES: Generous limit based on selected count
  maxCrawlPages: selectedCount * 8,
  
  // BROWSER: Full Chrome for JS-heavy sites (Wix, Squarespace)
  crawlerType: "playwright:chrome",
  
  // CONTENT
  saveHtml: false,
  saveMarkdown: true,
  removeCookieWarnings: true,
  
  // PRIORITY PAGES: Hunt for "money pages"
  globs: [
    '**/faq*',
    '**/faqs*',
    '**/frequently-asked*',
    '**/pricing*',
    '**/prices*',
    '**/cost*',
    '**/services*',
    '**/about*',
    '**/contact*',
    '**/areas*',
    '**/coverage*',
  ],
  
  // EXCLUDE: Skip low-value pages
  excludeGlobs: [
    '**/blog/**',
    '**/news/**',
    '**/privacy*',
    '**/terms*',
    '**/cookie*',
    '**/gdpr*',
    '**/sitemap*',
    '**/*.pdf',
  ],
}
```

---

## Cost Estimation

| Metric | Quick (50 sites) | Standard (100 sites) | Deep (250 sites) |
|--------|------------------|----------------------|------------------|
| Discovery (Maps) | ~$0.50 | ~$1.00 | ~$2.00 |
| Scraping (depth 2, 8 pg/site) | ~$4.00 | ~$8.00 | ~$20.00 |
| **Total** | **~$4.50** | **~$9.00** | **~$22.00** |

**UI will show:** "82 competitors selected · Estimated cost: ~$8"

---

## Files to Create/Modify Summary

| File | Action | Key Changes |
|------|--------|-------------|
| Database migration | CREATE | Add `is_selected`, `source`, `location_data` columns + expanded blocklist |
| `supabase/functions/handle-discovery-complete/index.ts` | MODIFY | Stop at `review_ready`, fix field mapping, remove auto-scrape |
| `supabase/functions/competitor-scrape-start/index.ts` | CREATE | New user-triggered scrape function with deep crawl config |
| `supabase/functions/handle-scrape-complete/index.ts` | MODIFY | Better per-site tracking |
| `src/components/onboarding/CompetitorReviewScreen.tsx` | CREATE | Full review UI with checkboxes and manual URL entry |
| `src/components/onboarding/CompetitorPipelineProgress.tsx` | MODIFY | Handle `review_ready` state, show review screen |
| `src/components/onboarding/CompetitorResearchStep.tsx` | MODIFY | Resume `review_ready` jobs on page refresh |
| `supabase/config.toml` | MODIFY | Add `competitor-scrape-start` function config |

---

## Implementation Order

1. **Database migration** - Add columns and blocklist entries
2. **Backend: handle-discovery-complete** - Stop at `review_ready`, fix field mismatch
3. **Backend: competitor-scrape-start** - Create new user-triggered function
4. **Backend: handle-scrape-complete** - Improve tracking
5. **Frontend: CompetitorReviewScreen** - Build the review UI
6. **Frontend: CompetitorPipelineProgress** - Integrate review state
7. **Config: supabase/config.toml** - Register new function
8. **Deploy and test end-to-end**

---

## Expected Outcomes

| Before | After |
|--------|-------|
| "0 websites validated" bug | Correct counts at every stage |
| Only 48/99 sites scraped | ALL user-selected sites scraped |
| 1 page per site (homepage only) | 5-10 pages per site (FAQ, pricing, services) |
| No user control | Review step with select/deselect and manual URL entry |
| Directories slip through | Expanded blocklist + user can deselect |
| Timeouts on large jobs | Fully async webhook architecture |
| Unknown cost | Estimated cost shown before scraping |

---

## Rollback Strategy

If issues occur:
1. The `review_ready` state is backwards-compatible - jobs already in `scraping` will continue
2. Old jobs in database won't have `is_selected` column - migration adds with `DEFAULT true`
3. UI falls back to current behavior if `review_ready` status is not recognized
