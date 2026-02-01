
# Fix: Enforce Target Limit + Validate Website Availability

## Problem Summary

1. **Too many competitors displayed**: When user selects 50, system shows all 321 discovered sites
2. **Dead sites count toward limit**: 404 errors, expired domains, and unreachable websites are included
3. **No guarantee of 50 valid scrapes**: User pays for 50 but might only get 42 usable results

## Solution Overview

Implement a **three-phase validation system**:

1. **Pre-selection**: Auto-select only the top N sites based on relevance + proximity
2. **Health check**: Validate each site is reachable before counting it
3. **Smart replacement**: If a site fails, auto-swap in the next-best alternative

---

## Technical Changes

### Phase 1: Pre-Selection Limit

**File: `supabase/functions/handle-discovery-complete/index.ts`**

After sorting by relevance and distance, only mark the top `max_competitors` as `is_selected: true`:

```text
Changes:
1. Fetch job.max_competitors from database (e.g., 50)
2. After sorting competitors by relevance + distance
3. Loop through and set is_selected = true ONLY for first N items
4. Rest are stored but with is_selected = false
```

Logic:
```typescript
// Fetch max_competitors from job
const { data: jobData } = await supabase
  .from('competitor_research_jobs')
  .select('geocoded_lat, geocoded_lng, niche_query, location, max_competitors')
  .eq('id', jobId)
  .single();

const maxCompetitors = jobData?.max_competitors || 50;

// After sorting by relevance + distance...
validCompetitors.forEach((comp, index) => {
  // Only auto-select the top N competitors
  comp.is_selected = index < maxCompetitors && relevance.score >= 40;
});
```

---

### Phase 2: Website Health Check

**New Edge Function: `supabase/functions/validate-competitor-sites/index.ts`**

Before starting the deep scrape, run a lightweight health check on each selected site:

```text
For each selected site:
1. Send a HEAD request (fast, minimal data)
2. Check response status (200-399 = valid)
3. Timeout after 5 seconds
4. Mark site as validation_status: 'valid' | 'invalid' | 'timeout'
```

Health check logic:
```typescript
async function validateSite(url: string): Promise<'valid' | 'invalid' | 'timeout'> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    
    // Valid if 2xx or 3xx
    return response.status < 400 ? 'valid' : 'invalid';
  } catch (err) {
    clearTimeout(timeout);
    return err.name === 'AbortError' ? 'timeout' : 'invalid';
  }
}
```

**Database column additions to `competitor_sites`:**
- `validation_status`: 'pending' | 'valid' | 'invalid' | 'timeout'
- `validated_at`: timestamp

---

### Phase 3: Smart Replacement

If a selected site fails validation, automatically swap in the next-best unselected site:

```text
1. Count how many selected sites are valid
2. If count < targetCount:
   - Find next-best unselected site (by relevance + distance)
   - Validate it
   - If valid, mark as is_selected = true
3. Repeat until we have targetCount valid sites (or run out of candidates)
```

Logic:
```typescript
// After validation, check if we need replacements
const validSelected = selectedSites.filter(s => s.validation_status === 'valid');
const shortfall = targetCount - validSelected.length;

if (shortfall > 0) {
  // Get next-best unselected candidates
  const { data: candidates } = await supabase
    .from('competitor_sites')
    .select('*')
    .eq('job_id', jobId)
    .eq('is_selected', false)
    .eq('validation_status', 'pending')
    .order('relevance_score', { ascending: false })
    .limit(shortfall * 2); // Get extra in case some fail
  
  for (const candidate of candidates) {
    if (validSelected.length >= targetCount) break;
    
    const status = await validateSite(candidate.url);
    if (status === 'valid') {
      await supabase.from('competitor_sites')
        .update({ is_selected: true, validation_status: 'valid' })
        .eq('id', candidate.id);
      validSelected.push(candidate);
    }
  }
}
```

---

### Phase 4: UI Updates

**File: `src/components/onboarding/CompetitorReviewScreen.tsx`**

1. **Pass `targetCount` as prop** (already exists in pipeline)
2. **Show selection limit**: "47 of 50 selected"
3. **Enforce limit on toggle**: Prevent selecting more than `targetCount`
4. **Show validation status**: Badge for valid/invalid/pending sites
5. **Paginate results**: Show first 50, with "Show more" button

UI changes:
```text
Header:
- "47 of 50 selected" (with warning if over limit)
- "321 found" (total discovered)

Selection enforcement:
- When user clicks checkbox to select 51st item:
  - Toast: "Limit reached. Deselect one to add another."
  - OR auto-deselect the oldest selection

Validation badges:
- Green checkmark: Site verified as reachable
- Red X: Site returned 404 or unreachable
- Gray spinner: Validation pending

Pagination:
- Show first 50 by default (matches targetCount)
- "Show 50 more" button to reveal rest
- Selecting from "overflow" auto-swaps with an existing selection
```

**File: `src/components/onboarding/CompetitorPipelineProgress.tsx`**

Pass `targetCount` to `CompetitorReviewScreen`:
```typescript
<CompetitorReviewScreen
  workspaceId={workspaceId}
  jobId={jobId}
  nicheQuery={nicheQuery}
  serviceArea={serviceArea}
  targetCount={targetCount}  // NEW
  onConfirm={handleReviewConfirm}
  ...
/>
```

---

### Phase 5: Integration with Scrape Start

**File: `supabase/functions/competitor-scrape-start/index.ts`**

Before starting the Apify scrape:

1. **Trigger validation** for all selected sites
2. **Wait for validation** to complete (with timeout)
3. **Ensure exactly N valid sites** before proceeding
4. **Reject if insufficient valid sites** with clear error message

Flow:
```text
User clicks "Confirm & Start Analysis"
  ↓
competitor-scrape-start invoked
  ↓
Call validate-competitor-sites (parallel HEAD requests)
  ↓
Check: Do we have 50 valid sites?
  ├─ YES → Proceed to Apify scrape
  └─ NO → Run smart replacement, then check again
      ├─ Still not enough → Return error with count
      └─ Now have 50 → Proceed to Apify scrape
```

---

## Database Changes

Add columns to `competitor_sites`:
```sql
ALTER TABLE competitor_sites 
ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
```

Add column for sorting in `handle-discovery-complete`:
```sql
-- Already exists: match_reason TEXT
-- Need to persist: relevance_score INTEGER (for replacement sorting)
ALTER TABLE competitor_sites 
ADD COLUMN IF NOT EXISTS relevance_score INTEGER DEFAULT 0;
```

---

## User Experience Flow

```text
1. User selects "50 competitors" and starts research
   ↓
2. Discovery finds 321 businesses
   ↓
3. System auto-selects top 50 (by relevance + distance)
   ↓
4. Review screen shows:
   - "50 selected of 321 found"
   - Top 50 are pre-checked
   - "Show more" reveals the rest
   ↓
5. User reviews, maybe swaps a few
   ↓
6. User clicks "Confirm & Start Analysis"
   ↓
7. System validates 50 sites (fast HEAD requests)
   ↓
8. 3 sites are dead (404)
   ↓
9. System auto-swaps in 3 more from the unselected pool
   ↓
10. 50 valid sites proceed to deep scrape
   ↓
11. User gets exactly 50 competitor analyses
```

---

## Visual Mockup - Review Screen

```text
┌─────────────────────────────────────────────────────────────┐
│ Review Competitors                                          │
│ 50 of 50 selected  •  321 found in your area               │
│                                                             │
│ [Search...]                     [Select All] [Clear]        │
├─────────────────────────────────────────────────────────────┤
│ ☑ ✓ ABC Window Cleaning       0.5 mi   Window Cleaning      │
│ ☑ ✓ Crystal Clear Windows     1.2 mi   Window Cleaning      │
│ ☑ ✗ Old Company (Site down)   2.1 mi   Window Cleaning      │
│ ☑ ⟳ Pro Glass Services        2.8 mi   Local business       │
│ ... (46 more selected)                                      │
│                                                             │
│           [ Show 271 more competitors ]                     │
├─────────────────────────────────────────────────────────────┤
│ ⚠️ 3 sites could not be reached - they'll be replaced      │
│                                                             │
│ [Back]  [Redo]  [Skip]      [Confirm & Start (50/50)] ✓    │
└─────────────────────────────────────────────────────────────┘
```

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/handle-discovery-complete/index.ts` | Limit pre-selection to `max_competitors`, persist `relevance_score` |
| `supabase/functions/validate-competitor-sites/index.ts` | NEW: Health check edge function |
| `supabase/functions/competitor-scrape-start/index.ts` | Add validation + smart replacement before scraping |
| `src/components/onboarding/CompetitorReviewScreen.tsx` | Add `targetCount` prop, selection limit, validation badges, pagination |
| `src/components/onboarding/CompetitorPipelineProgress.tsx` | Pass `targetCount` to review screen |
| Database migration | Add `validation_status`, `validated_at`, `relevance_score` columns |

---

## Expected Outcome

1. **Exactly N valid competitors**: If user selects 50, they get 50 working websites
2. **No wasted scrape costs**: Dead sites are filtered before Apify runs
3. **Transparent limits**: UI shows "50 of 50 selected" with clear enforcement
4. **Smart fallback**: Invalid sites are auto-replaced from the discovery pool
5. **Future-proof**: Easy to adjust limits based on subscription tier
