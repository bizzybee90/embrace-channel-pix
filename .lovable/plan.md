
# Switch to Google SERP-Based Discovery

## Problem Analysis

The current Google Places approach has fundamental limitations:
- `customGeolocation` is a **hint**, not a strict filter
- Google Places prioritizes "relevance" (reviews, popularity) over proximity
- Businesses from Bedford, Hitchin, Letchworth appear because they have better Google profiles
- Only 3 businesses within 5 miles of Luton are being returned

## Proposed Solution: Organic SERP Discovery

Use **Google Search SERP scraping** instead of Google Places. When a user searches "window cleaner luton", Google returns what customers actually see - businesses optimized for that local search.

### Why This Works Better

| Google Places | Google SERP |
|---------------|-------------|
| Returns by coordinates | Returns by search relevance |
| Ignores local SEO | Respects local SEO |
| Scattered results | Location-focused results |
| No "near me" context | Simulates real customer search |

### Search Strategy

Generate multiple location-specific search queries:
```text
1. "window cleaning luton"
2. "window cleaner luton" 
3. "window cleaning near luton"
4. "window cleaning luton dunstable"  (nearby towns)
5. "window cleaner bedfordshire"
```

This mirrors how real customers search and returns businesses that are actually targeting Luton customers.

---

## Technical Implementation

### New Edge Function: `competitor-serp-discovery`

**Apify Actor:** `apify/google-search-scraper`

**Input Configuration:**
```typescript
{
  queries: [
    "window cleaning luton",
    "window cleaner luton",
    "window cleaning near luton uk"
  ],
  countryCode: "gb",
  languageCode: "en",
  resultsPerPage: 100,
  maxPagesPerQuery: 3,
  // Target UK Google
  googleDomain: "google.co.uk"
}
```

**Output Processing:**
1. Extract organic results (skip ads)
2. Filter out directories (Yell, Checkatrade, Bark, etc.)
3. Deduplicate by domain
4. Extract business websites
5. Sort by SERP position (higher = more relevant to "luton")

### Changes to Existing Functions

**`competitor-discovery-start`:**
- Add option: `discoveryMethod: 'places' | 'serp'` (default: 'serp')
- Generate location-specific search queries
- Call SERP actor instead of Places actor

**`competitor-webhooks`:**
- Handle `type: 'serp_discovery'`
- Parse organic results format
- Apply directory blocklist
- No distance calculation needed (SERP already filters by location intent)

---

## User Experience Flow

```text
User enters:
  Industry: "Window Cleaning"
  Location: "Luton"
  
System generates searches:
  → "window cleaning luton"
  → "window cleaner luton" 
  → "window cleaning luton uk"

SERP returns:
  → Position 1: crystalclearwindows-luton.co.uk
  → Position 2: lutonwindowcleaners.com
  → Position 3: abc-cleaning-luton.co.uk
  ...

Result: Businesses that actively target Luton customers
```

---

## Directory Blocklist (Expanded)

Organic results will include directory sites. Expand blocklist:

```text
yell.com, checkatrade.com, bark.com, rated-people.com,
trustatrader.com, mybuilder.com, which.co.uk, 
freeindex.co.uk, cyclex.co.uk, yelp.com, 
192.com, thebestof.co.uk, thomsonlocal.com,
scoot.co.uk, hotfrog.co.uk, businessmagnet.co.uk,
facebook.com, nextdoor.com, gumtree.com
```

---

## Hybrid Approach (Optional)

For best results, combine both methods:

1. **SERP Discovery** (Primary): Get businesses targeting that location
2. **Places Validation** (Secondary): Verify they have a physical presence

This ensures we get:
- Businesses that market to Luton (SERP)
- Businesses that actually operate near Luton (Places cross-reference)

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/functions/competitor-serp-discovery/index.ts` | NEW - SERP-based discovery |
| `supabase/functions/competitor-webhooks/index.ts` | Add SERP result handler |
| `src/components/onboarding/CompetitorResearchStep.tsx` | Use new discovery function |
| Database: `directory_blocklist` | Add 20+ new directory domains |

---

## Expected Improvement

| Metric | Before (Places) | After (SERP) |
|--------|-----------------|--------------|
| Businesses within 5mi | 3 | 15-20 |
| Actually target "Luton" | ~30% | ~90% |
| Relevant to search intent | Low | High |
| Directory noise | Medium | Low (filtered) |

---

## Alternative: Keep Places but Add SERP Validation

If you prefer to keep the Places approach:

1. Keep current Places discovery
2. ADD a SERP check: Search "business name + luton"
3. If business doesn't appear in top 50 for "luton" searches → deprioritize
4. This validates they actually serve the area

This is more API calls but uses both data sources.
