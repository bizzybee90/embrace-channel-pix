# Switch to Google SERP-Based Discovery ✅ IMPLEMENTED

## Problem Analysis

The current Google Places approach has fundamental limitations:
- `customGeolocation` is a **hint**, not a strict filter
- Google Places prioritizes "relevance" (reviews, popularity) over proximity
- Businesses from Bedford, Hitchin, Letchworth appear because they have better Google profiles
- Only 3 businesses within 5 miles of Luton are being returned

## Solution: Organic SERP Discovery ✅

Uses **Google Search SERP scraping** instead of Google Places. When a user searches "window cleaner luton", Google returns what customers actually see - businesses optimized for that local search.

### Why This Works Better

| Google Places | Google SERP |
|---------------|-------------|
| Returns by coordinates | Returns by search relevance |
| Ignores local SEO | Respects local SEO |
| Scattered results | Location-focused results |
| No "near me" context | Simulates real customer search |

### Search Strategy

Generates multiple location-specific search queries:
```text
1. "window cleaning luton"
2. "window cleaning in luton" 
3. "window cleaning near luton"
4. "window cleaner luton" (singular/plural variations)
5. "window cleaning luton UK"
```

---

## Implementation Complete ✅

### New Edge Function: `competitor-serp-discovery`

**Apify Actor:** `apify/google-search-scraper`

**Features:**
- Generates 5 location-specific search queries
- Uses UK Google domain (`google.co.uk`)
- Fetches up to 200 results per query (100 per page × 2 pages)
- Triggers webhook on completion

### Updated: `competitor-webhooks`

**New Handler:** `handleSerpDiscoveryWebhook`

**Features:**
- Parses Google organic results (skips ads)
- **Expanded directory blocklist** (40+ domains):
  - UK directories: yell.com, checkatrade.com, bark.com, rated-people.com, etc.
  - Social media: facebook.com, instagram.com, linkedin.com, etc.
  - Aggregators: trustpilot.com, tripadvisor.com, etc.
- Deduplicates by domain (first occurrence = higher SERP position wins)
- Ranks by SERP position (position 1-10 = most relevant to location)
- Auto-selects top N results

### Updated: `CompetitorResearchStep.tsx`

Now calls `competitor-serp-discovery` instead of `competitor-discovery-start`

---

## Files Modified

| File | Action |
|------|--------|
| `supabase/functions/competitor-serp-discovery/index.ts` | ✅ NEW |
| `supabase/functions/competitor-webhooks/index.ts` | ✅ Updated with SERP handler |
| `src/components/onboarding/CompetitorResearchStep.tsx` | ✅ Updated invocation |
| `supabase/config.toml` | ✅ Added function config |

---

## Expected Improvement

| Metric | Before (Places) | After (SERP) |
|--------|-----------------|--------------|
| Businesses within 5mi | 3 | 15-20 |
| Actually target "Luton" | ~30% | ~90% |
| Relevant to search intent | Low | High |
| Directory noise | Medium | Low (filtered) |
