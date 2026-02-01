
# Hybrid Competitor Discovery: Google Places + SERP

## Problem Summary

The current SERP-only discovery is failing because:
1. **No UK-specific targeting** - Missing `proxyConfiguration` and `locationUule` parameters
2. **Low result count** - Only 6 results returned when 50+ expected
3. **Location accuracy** - Businesses from wrong cities still appearing

## Solution: Hybrid Places + SERP Discovery

Combines the **precision of Google Places** (verified locations with coordinates) with the **local SEO relevance of SERP** (businesses actively targeting that search term).

### Architecture Overview

```text
User enters: "Window Cleaning" + "Luton"
                    ↓
┌─────────────────────────────────────────────────────┐
│         PHASE 1: Google Places Discovery            │
│   (75% of target count - verified businesses)       │
│                                                      │
│   • Precise radius filtering (Haversine formula)   │
│   • Verified business data (phone, address, rating)│
│   • Coordinates for distance calculation            │
│   • Uses compass/crawler-google-places              │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│         PHASE 2: SERP Discovery (Deduplicated)      │
│   (25% of target count - SEO-strong competitors)    │
│                                                      │
│   • UK proxies (apifyProxyCountry: 'GB')           │
│   • UULE location encoding for precise targeting   │
│   • Filters out directories (40+ blocked domains)  │
│   • Skip domains already found in Phase 1          │
│   • Uses apify/google-search-scraper               │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│         PHASE 3: Quality Scoring & Ranking          │
│                                                      │
│   Quality Score (0-30 points):                      │
│   • Distance: 0-10 pts (closer = higher)           │
│   • Rating: 0-10 pts (4.5+ = 10 pts)               │
│   • Reviews: 0-5 pts (100+ = 5 pts)                │
│   • Domain TLD: 0-5 pts (.co.uk = 5 pts)           │
│                                                      │
│   Priority Tiers:                                   │
│   • High (25-30 pts): Scrape 15 pages              │
│   • Medium (15-24 pts): Scrape 5 pages             │
│   • Low (0-14 pts): Scrape 2 pages                 │
└─────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### 1. New Edge Function: `competitor-hybrid-discovery`

**Key Features:**
- Triggers Google Places scraper first (Phase 1)
- Webhook saves Places results and triggers SERP scraper (Phase 2)
- Final webhook merges and scores all results (Phase 3)

**UULE Generation for Location Precision:**
```typescript
// UULE codes anchor Google search to a specific location
function generateUULE(location: string): string {
  const encoded = btoa(unescape(encodeURIComponent(location)));
  return `w+CAIQICI${encoded}`;
}
```

**UK Proxy Configuration:**
```typescript
const apifyInput = {
  queries: [...],
  countryCode: "gb",
  languageCode: "en",
  locationUule: generateUULE("Luton, Bedfordshire, UK"),
  proxyConfiguration: {
    useApifyProxy: true,
    apifyProxyCountry: "GB"  // Routes through UK IPs
  }
};
```

### 2. Quality Scoring Algorithm

```typescript
function calculateQualityScore(competitor: Competitor): number {
  let score = 0;
  
  // Distance (closer = better) - 0 to 10 points
  if (competitor.distance_miles !== null) {
    if (competitor.distance_miles <= 5) score += 10;
    else if (competitor.distance_miles <= 10) score += 8;
    else if (competitor.distance_miles <= 20) score += 5;
    else if (competitor.distance_miles <= 30) score += 2;
  }
  
  // Google Rating - 0 to 10 points
  const rating = competitor.rating || 0;
  if (rating >= 4.5) score += 10;
  else if (rating >= 4.0) score += 7;
  else if (rating >= 3.5) score += 4;
  else if (rating >= 3.0) score += 2;
  
  // Review Count - 0 to 5 points
  const reviews = competitor.reviews_count || 0;
  if (reviews >= 100) score += 5;
  else if (reviews >= 50) score += 4;
  else if (reviews >= 20) score += 2;
  else if (reviews >= 5) score += 1;
  
  // Domain TLD - 0 to 5 points
  const domain = competitor.domain || '';
  if (domain.endsWith('.co.uk')) score += 5;
  else if (domain.endsWith('.uk')) score += 4;
  else if (domain.endsWith('.com')) score += 2;
  
  return score;
}

function assignPriorityTier(score: number): 'high' | 'medium' | 'low' {
  if (score >= 25) return 'high';
  if (score >= 15) return 'medium';
  return 'low';
}
```

### 3. Database Schema Updates

**New columns for `competitor_sites`:**
```sql
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT 0;
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS priority_tier TEXT DEFAULT 'medium';
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS is_places_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS google_place_id TEXT;
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS serp_position INTEGER;
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS search_query_used TEXT;

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_competitor_sites_quality 
  ON competitor_sites(job_id, quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_sites_priority 
  ON competitor_sites(job_id, priority_tier);
```

**Market Intelligence View:**
```sql
CREATE OR REPLACE VIEW competitor_market_intelligence AS
SELECT 
  job_id,
  COUNT(*) as total_competitors,
  COUNT(*) FILTER (WHERE is_places_verified = TRUE) as verified_count,
  COUNT(*) FILTER (WHERE discovery_source = 'google_places') as from_places,
  COUNT(*) FILTER (WHERE discovery_source = 'google_serp') as from_serp,
  AVG(distance_miles) FILTER (WHERE distance_miles IS NOT NULL) as avg_distance,
  AVG(rating) FILTER (WHERE rating IS NOT NULL) as avg_rating,
  AVG(reviews_count) FILTER (WHERE reviews_count IS NOT NULL) as avg_reviews,
  COUNT(*) FILTER (WHERE priority_tier = 'high') as high_priority,
  COUNT(*) FILTER (WHERE priority_tier = 'medium') as medium_priority,
  COUNT(*) FILTER (WHERE priority_tier = 'low') as low_priority
FROM competitor_sites
WHERE is_selected = TRUE
GROUP BY job_id;
```

### 4. Updated Webhook Handler

**Three-phase webhook processing:**

1. **`places_discovery`**: Saves Places results, triggers SERP discovery
2. **`serp_discovery`**: Saves SERP results, deduplicates against Places
3. **`scoring_complete`**: Calculates quality scores and assigns priority tiers

### 5. Frontend Updates

**CompetitorResearchStep.tsx changes:**
- Call `competitor-hybrid-discovery` instead of `competitor-serp-discovery`
- Display source breakdown (Places vs SERP count)
- Show quality scores and priority tiers in review screen

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/competitor-hybrid-discovery/index.ts` | **CREATE** | New unified discovery function |
| `supabase/functions/_shared/uule-generator.ts` | **CREATE** | UULE code generation for UK cities |
| `supabase/functions/_shared/quality-scorer.ts` | **CREATE** | Quality scoring algorithm |
| `supabase/functions/competitor-webhooks/index.ts` | **UPDATE** | Add hybrid webhook handlers |
| `supabase/config.toml` | **UPDATE** | Register new function |
| `src/components/onboarding/CompetitorResearchStep.tsx` | **UPDATE** | Use hybrid discovery |
| Database migration | **CREATE** | Add quality_score, priority_tier columns |

---

## Expected Results

| Metric | Before (SERP-only) | After (Hybrid) |
|--------|-------------------|----------------|
| Results found | 6 | 75-100 |
| Verified businesses | 0% | ~75% |
| With coordinates | 0% | ~75% |
| Location accuracy | ~30% | ~90% |
| Has phone/address | 0% | ~75% |
| Directory contamination | Medium | Very Low |

---

## Cost Estimate Per Job (100 competitors)

| Component | Cost |
|-----------|------|
| Google Places Scraper (75 places) | ~$1.50 |
| Google SERP Scraper (25 queries) | ~$0.05 |
| Website Content Crawler (tiered) | ~$0.50 |
| **Total** | **~$2.05** |

---

## Implementation Order

1. Create database migration for new columns
2. Create shared utilities (UULE generator, quality scorer)
3. Create `competitor-hybrid-discovery` edge function
4. Update `competitor-webhooks` with hybrid handlers
5. Update frontend to use new discovery function
6. Deploy and test with "Window Cleaning" + "Luton"

