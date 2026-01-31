
# Fix: Dynamic Industry-Aware Competitor Filtering

## Overview

Make the competitor discovery and filtering work for **any business type** the user searches for, not just window cleaning. The system will dynamically generate relevant keywords based on the user's industry input.

## How It Works

### Dynamic Keyword Generation

Instead of hardcoded lists, we'll use AI to generate industry-specific keywords on-the-fly:

```text
User searches: "Plumber Luton"
→ Exact matches: plumber, plumbing, heating engineer
→ Related services: boiler repair, gas engineer, bathroom fitter
→ Exclusions: electrician, builder, roofer, locksmith
```

```text
User searches: "Dog Grooming Manchester"
→ Exact matches: dog grooming, pet grooming, dog salon
→ Related services: pet spa, mobile dog grooming, dog wash
→ Exclusions: dog walking, pet sitting, vet, kennels
```

This approach means ANY industry the user enters will get intelligent filtering without needing to maintain hardcoded keyword lists.

## Technical Changes

### File 1: `supabase/functions/handle-discovery-complete/index.ts`

Add dynamic relevance scoring using the job's `niche_query`:

```text
Changes:
1. Fetch job's niche_query alongside coordinates
2. Generate keywords dynamically from the niche
3. Score each result based on business name matching
4. Add match_reason field to each competitor
5. Sort by: (1) address contains location, (2) relevance score, (3) distance
```

Key logic:
```typescript
// Generate keywords from the user's niche query
function generateKeywords(niche: string) {
  const nicheWords = niche.toLowerCase().split(/\s+/);
  const exactKeywords = nicheWords; // "window", "cleaning"
  
  // Common exclusions that apply to most service businesses
  const genericExclusions = [
    'car wash', 'hand car wash', 'valeting',
    'roofing', 'roofer', 'solar panel',
    'windscreen', 'auto glass', 'car glass',
    'estate agent', 'letting agent',
    'accountant', 'solicitor', 'lawyer'
  ];
  
  return { exactKeywords, genericExclusions };
}

// Score each business based on relevance
function scoreRelevance(businessName: string, niche: string, location: string) {
  const name = businessName.toLowerCase();
  const nicheWords = niche.toLowerCase().split(/\s+/);
  
  // Check if business name contains niche keywords
  const matchesNiche = nicheWords.some(word => 
    word.length > 3 && name.includes(word)
  );
  
  // Check for obviously wrong categories
  const isExcluded = genericExclusions.some(excl => name.includes(excl));
  
  // Check if address contains target location
  const inTargetArea = address?.toLowerCase().includes(location.toLowerCase());
  
  if (isExcluded) return { score: 0, reason: 'Weak: Unrelated' };
  if (matchesNiche && inTargetArea) return { score: 100, reason: niche };
  if (matchesNiche) return { score: 80, reason: niche };
  if (inTargetArea) return { score: 60, reason: 'Local business' };
  return { score: 40, reason: 'Manual check' };
}
```

### File 2: `supabase/functions/start-competitor-research/index.ts`

Include location in search terms for any industry:

```text
Current:
searchStringsArray: [industry]

New:
searchStringsArray: [
  `${industry} ${location}`,          // "Plumber Luton"
  `${industry} services ${location}`, // "Plumber services Luton"  
  `${industry} near ${location}`,     // "Plumber near Luton"
]
```

### File 3: Database Migration

Add `match_reason` column to store why each competitor was included:

```sql
ALTER TABLE competitor_sites 
ADD COLUMN IF NOT EXISTS match_reason TEXT;
```

### File 4: `src/components/onboarding/CompetitorReviewScreen.tsx`

Display match reason badge with appropriate styling:

```text
Badge colors:
- Green (default): Exact industry match (e.g., "Window Cleaning")
- Blue (secondary): Related service (e.g., "Related: Gutter Cleaning")
- Amber (outline): Weak match (e.g., "Weak: Check manually")
- Gray: "Manual check" or "Local business"
```

## Sorting Priority (Any Industry)

Results will be sorted in this order:

1. **In target area + matches industry** (score 100)
   - Address contains "Luton" AND name contains "window" or "cleaning"
   
2. **Matches industry** (score 80)
   - Name contains niche keywords but may be nearby town
   
3. **In target area** (score 60)
   - Address in Luton but business name unclear
   
4. **Other** (score 40)
   - Nearby businesses that need manual review

5. **Excluded** (score 0)
   - Obviously unrelated (car wash, roofing, etc.) - filtered out or marked "Weak"

## Example Results

**User searches: "Accountant Leeds"**

| Business | Match Reason | Distance |
|----------|--------------|----------|
| Smith & Co Accountants | Accountant ✓ | 0.5 mi |
| Leeds Accounting Services | Accountant ✓ | 1.2 mi |
| Bradford Tax Advisors | Related: Tax | 8.4 mi |
| Yorkshire Business Services | Manual check | 3.1 mi |
| ~~Leeds Roofing Co~~ | ~~Weak: Unrelated~~ | - |

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/start-competitor-research/index.ts` | Include location in search terms (already done in previous plan) |
| `supabase/functions/handle-discovery-complete/index.ts` | Add dynamic relevance scoring using job's niche_query |
| `src/components/onboarding/CompetitorReviewScreen.tsx` | Display match_reason badge with color coding |
| Database migration | Add `match_reason` column to competitor_sites |

## Expected Outcome

1. Works for **any business type** - plumbers, accountants, dog groomers, etc.
2. Luton/local businesses appear first (address-based priority)
3. Irrelevant businesses (car wash, roofing) marked as "Weak" or filtered out
4. Each competitor shows why it was included
5. No hardcoded industry lists - fully dynamic based on user input
