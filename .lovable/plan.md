

# Fix Competitor Research Pipeline: Complete Target Count & Site Reuse

## Problem Summary

The competitor research pipeline has **three core issues**:

### Issue 1: Only Finding 15-20 Competitors (Not 50-100)

**Root Cause:** The Google Places Text Search API only returns ~20 results per search. The `competitor-discover` function runs 4 search queries but:
- Each query returns at most 20 results
- Many are duplicates across queries
- After filtering directories/social media, you end up with ~15 unique sites

The **Apify-based path** (`start-competitor-research`) should find more, but it's **not being used** — the UI is calling `competitor-discover` directly.

### Issue 2: Unique Constraint Blocking Reuse

**Root Cause:** There's a unique constraint on `(workspace_id, url)`:
```
competitor_sites_workspace_url_unique: UNIQUE (workspace_id, url)
```

When a new research job runs:
1. Discovery finds the same competitors as previous jobs
2. Insert fails silently due to duplicate key
3. No sites are linked to the new `job_id`
4. Scrape-worker queries `WHERE job_id = [new_job] AND status = 'approved'` → 0 rows

### Issue 3: Two Discovery Paths Are Competing

There are **two separate discovery systems**:

| Function | Method | Expected Count | Currently Used? |
|----------|--------|----------------|-----------------|
| `competitor-discover` | Google Places API (direct) | ~15-20 | **YES** (UI calls this) |
| `start-competitor-research` | Apify Google Maps Scraper | 50-100+ | NO |

The `start-competitor-research` → `handle-discovery-complete` pipeline uses Apify with `maxCrawledPlacesPerSearch: 100` and should find many more competitors, but it's not being invoked.

---

## Solution Architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                        CURRENT (Broken) Flow                             │
├──────────────────────────────────────────────────────────────────────────┤
│  UI → competitor-discover (Google Places API)                            │
│  └─ Returns ~15-20 results (API limit)                                   │
│  └─ Insert fails on duplicate (workspace_id, url)                        │
│  └─ Scrape-worker finds 0 sites for new job_id                           │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                         FIXED Flow                                        │
├──────────────────────────────────────────────────────────────────────────┤
│  UI → start-competitor-research (Apify Google Maps Scraper)              │
│  └─ Fetches 50-100+ places via compass~crawler-google-places             │
│  └─ Webhook triggers handle-discovery-complete                           │
│      └─ Filters via directory_blocklist                                  │
│      └─ UPSERT into competitor_sites (relink to current job_id)          │
│      └─ Triggers website scraping                                        │
│  └─ Scrape-worker finds all sites linked to job_id                       │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Fix UI to Use Apify-Based Discovery

**File:** `src/components/onboarding/CompetitorResearchStep.tsx`

Change the discovery function call from `competitor-discover` to `start-competitor-research`:

```typescript
// BEFORE (line 176):
const { error: invokeError } = await supabase.functions.invoke('competitor-discover', {
  body: { jobId: job.id, workspaceId, nicheQuery, serviceArea, targetCount }
});

// AFTER:
const { error: invokeError } = await supabase.functions.invoke('start-competitor-research', {
  body: { 
    workspaceId,
    industry: nicheQuery,
    location: serviceArea,
    radiusMiles: 25,
    maxCompetitors: targetCount  // Pass the user's requested count
  }
});
```

Also update job creation to align with the expected schema:
- Remove redundant job creation in UI (let `start-competitor-research` create it)
- OR update job ID linkage after receiving response

### Step 2: Fix UPSERT Logic in handle-discovery-complete

**File:** `supabase/functions/handle-discovery-complete/index.ts`

Change from `INSERT` with `ignoreDuplicates: true` to proper `UPSERT` that relinks sites to the current job:

```typescript
// BEFORE (line 131-136):
const { error: insertError } = await supabase
  .from('competitor_sites')
  .upsert(validCompetitors, { 
    onConflict: 'job_id,domain',  // WRONG - unique is on (workspace_id, url)
    ignoreDuplicates: true        // Sites are ignored, not relinked!
  });

// AFTER:
// Since the constraint is on (workspace_id, url), we need to:
// 1. For each competitor, try upsert on (workspace_id, url)
// 2. Update job_id to current job when conflict occurs
for (const comp of validCompetitors) {
  await supabase
    .from('competitor_sites')
    .upsert({
      ...comp,
      job_id: jobId,
      status: 'approved',
      discovered_at: new Date().toISOString()
    }, {
      onConflict: 'workspace_id,url',
      ignoreDuplicates: false  // Update on conflict!
    });
}
```

### Step 3: Ensure Apify Returns Enough Results

**File:** `supabase/functions/start-competitor-research/index.ts`

The current config already passes `maxCrawledPlacesPerSearch: maxCompetitors + 20`, but verify the Apify actor configuration:

```typescript
// Current (line 186):
maxCrawledPlacesPerSearch: Math.min(maxCompetitors + 20, 100),
```

This caps at 100 results. For 250 competitors, we may need to:
- Run multiple searches with different query variations
- Or use pagination with Apify's dataset API

### Step 4: Keep competitor-discover as Fallback

Keep `competitor-discover` but mark it as a fallback for when:
- Apify API is unavailable
- Apify credits are exhausted
- User prefers faster/cheaper discovery

---

## Technical Details

### Database Constraint
```sql
UNIQUE (workspace_id, url)  -- Not (job_id, url)!
```

This means the same URL can only exist once per workspace, regardless of how many research jobs are run. The fix ensures new jobs "adopt" previously discovered sites.

### Apify Actor Configuration
```json
{
  "searchStringsArray": ["end of tenancy cleaning"],
  "locationQuery": "Luton, UK",
  "maxCrawledPlacesPerSearch": 120,
  "countryCode": "gb",
  "customGeolocation": {
    "type": "Point",
    "coordinates": [-0.4200, 51.8787],
    "radiusKm": 40
  }
}
```

### Filtering Pipeline
1. **Google Places discovery:** Returns 50-100+ raw results
2. **Directory blocklist:** Filters yell.com, checkatrade.com, etc. (24+ domains)
3. **Social media filter:** Filters facebook.com, instagram.com, etc.
4. **Website validation:** Only keeps places with valid website URLs
5. **Distance sorting:** Prioritizes closest competitors

---

## Files to Modify

1. **src/components/onboarding/CompetitorResearchStep.tsx**
   - Change function call from `competitor-discover` to `start-competitor-research`
   - Update job creation logic to work with Apify pipeline
   - Update parameters to match expected schema

2. **supabase/functions/handle-discovery-complete/index.ts**
   - Fix `onConflict` column from `job_id,domain` to `workspace_id,url`
   - Set `ignoreDuplicates: false` to allow updates
   - Relink existing sites to current job_id

3. **supabase/functions/start-competitor-research/index.ts**
   - Ensure `maxCrawledPlacesPerSearch` respects user's `targetCount`
   - Add fallback for when Apify returns fewer results than requested

---

## Verification Steps

After implementation:
1. Select "100 competitors" in the UI
2. Click "Start Research"
3. Verify job status shows "discovering" (not "error")
4. Wait for Apify webhook (1-3 minutes)
5. Verify `competitor_sites` table shows ~100 entries linked to new job_id
6. Verify scraping proceeds with all discovered sites

