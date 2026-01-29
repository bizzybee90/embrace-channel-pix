

# Fix Website Scraping Pipeline - Table Mismatch

## Problem Summary

The website knowledge extraction pipeline is frozen because the UI reads from a different table than the one the backend writes to:
- Backend writes to: `scraping_jobs`
- UI reads from: `website_scrape_jobs`

This is a critical data flow disconnect that prevents any progress from being displayed.

---

## Solution

Unify the pipeline to use the existing `scraping_jobs` table consistently across all components.

---

## Implementation Steps

### 1. Update WebsitePipelineProgress Component

Modify `src/components/onboarding/WebsitePipelineProgress.tsx` to read from `scraping_jobs` instead of `website_scrape_jobs`:

- Change the Supabase query from `.from('website_scrape_jobs')` to `.from('scraping_jobs')`
- Map the column names correctly (e.g., `total_pages_found` instead of `pages_found`)
- Update the realtime subscription to listen to `scraping_jobs`

### 2. Update Phase Mapping Logic

The `scraping_jobs` table uses these statuses:
- `scraping` (Apify crawler running)
- `processing` (extracting FAQs)
- `completed`
- `failed`

Map these to the UI phases:
- `scraping` → Stage 1 "Discover Pages" (in progress)
- `processing` → Stage 3 "Extract Knowledge" (in progress)
- `completed` → All stages done
- `failed` → Show error

### 3. Derive Stage Status from Data

Since the current schema doesn't track scraping vs. extraction separately, derive status from:
- `total_pages_found > 0` → Discovery done
- `pages_processed > 0` → Scraping in progress/done
- `faqs_found > 0` → Extraction in progress
- `status === 'completed'` → All done

---

## Technical Details

```text
┌─────────────────────────┐         ┌─────────────────────────┐
│  start-own-website-     │         │  process-own-website-   │
│  scrape                 │────────▶│  scrape (webhook)       │
│                         │  Apify  │                         │
│  Creates job in         │  calls  │  Updates job in         │
│  scraping_jobs          │         │  scraping_jobs          │
└─────────────────────────┘         └─────────────────────────┘
           │                                    │
           │ Both write to same table           │
           ▼                                    ▼
     ┌───────────────────────────────────────────────┐
     │            scraping_jobs table                │
     │  - status: scraping → processing → completed  │
     │  - total_pages_found                          │
     │  - pages_processed                            │
     │  - faqs_found                                 │
     └───────────────────────────────────────────────┘
                          │
                          │ UI reads from same table
                          ▼
     ┌───────────────────────────────────────────────┐
     │        WebsitePipelineProgress.tsx            │
     │  - Subscribe to scraping_jobs realtime        │
     │  - Derive stage status from data              │
     └───────────────────────────────────────────────┘
```

### Column Mapping

| UI Field | scraping_jobs Column |
|----------|---------------------|
| phase | status |
| pagesFound | total_pages_found |
| pagesScraped | pages_processed |
| faqsExtracted | faqs_found |
| errorMessage | error_message |

---

## Files to Modify

1. **src/components/onboarding/WebsitePipelineProgress.tsx**
   - Change table reference from `website_scrape_jobs` to `scraping_jobs`
   - Update column names in the query and state mapping
   - Update realtime subscription channel

---

## Verification

After implementation:
1. Refresh the onboarding page
2. The "Discover Pages" stage should either show progress or complete (based on current Apify run status)
3. If Apify has finished, the webhook should trigger and extraction will begin

