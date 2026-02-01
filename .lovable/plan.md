
# Show Exact Search Queries Before Discovery

## Problem Summary

You've identified a critical transparency issue: the user enters "Window Cleaning" + "Luton" but has **no visibility into the actual search queries** being executed. If the system is searching for something different (e.g., just "window cleaning" without location anchoring), the results won't match what you'd see on Google.

Currently, the search queries are generated **hidden inside the backend** (lines 1098-1104 of `competitor-webhooks.ts`):

```typescript
const queries = [
  `${industry} ${location}`,           // "Window Cleaning Luton"
  `${industry} near ${location}`,      // "Window Cleaning near Luton"
  `best ${industry} ${location}`,      // "best Window Cleaning Luton"
  `local ${industry} ${location}`,     // "local Window Cleaning Luton"
  `${industry} services ${location}`,  // "Window Cleaning services Luton"
];
```

The user never sees these queries and can't verify they match real Google searches.

---

## Proposed Solution: Search Query Preview Step

Add a **"Preview Search Terms"** section **before** starting discovery, allowing the user to:
1. See exactly what searches will be run
2. Edit or add their own search terms
3. Verify these match what they'd type into Google

### User Flow

```text
CURRENT FLOW:
┌─────────────────────────────┐
│ Industry: [Window Cleaning] │
│ Location: [Luton]          │
│           [Start Research] │
└─────────────────────────────┘
          ↓
    (Hidden search queries)
          ↓
    Review competitors

PROPOSED FLOW:
┌─────────────────────────────────────────┐
│ Industry: [Window Cleaning]             │
│ Location: [Luton]                       │
│                                         │
│ ┌─ Search Terms Preview ──────────────┐ │
│ │                                     │ │
│ │ We'll search Google for:            │ │
│ │                                     │ │
│ │ ☑ window cleaning luton             │ │
│ │ ☑ window cleaner luton              │ │
│ │ ☑ window cleaning near luton        │ │
│ │ ☑ best window cleaning luton        │ │
│ │ ☐ luton window cleaning services    │ │
│ │                                     │ │
│ │ [+ Add custom search term]          │ │
│ │                                     │ │
│ │ Tip: Use exact terms you'd search   │ │
│ │ for on Google to find competitors   │ │
│ └─────────────────────────────────────┘ │
│                                         │
│            [Start Research]             │
└─────────────────────────────────────────┘
```

---

## Technical Implementation

### 1. Update Frontend: `CompetitorResearchStep.tsx`

Add a **"Search Terms Preview"** section that:
- Auto-generates default queries from industry + location
- Allows toggling queries on/off
- Allows adding custom search terms
- Passes selected queries to the backend

**New state:**
```typescript
const [searchQueries, setSearchQueries] = useState<{query: string; enabled: boolean}[]>([]);

// Auto-generate when industry/location changes
useEffect(() => {
  if (nicheQuery && serviceArea) {
    const industry = nicheQuery.toLowerCase();
    const location = serviceArea.toLowerCase();
    
    setSearchQueries([
      { query: `${industry} ${location}`, enabled: true },
      { query: `${industry.replace('cleaning', 'cleaner')} ${location}`, enabled: true },
      { query: `${industry} near ${location}`, enabled: true },
      { query: `best ${industry} ${location}`, enabled: true },
      { query: `local ${industry} ${location}`, enabled: false },
      { query: `${location} ${industry} services`, enabled: false },
    ]);
  }
}, [nicheQuery, serviceArea]);
```

**New UI section:**
```tsx
{searchQueries.length > 0 && (
  <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
    <Label className="text-sm font-medium">
      Google Search Terms
    </Label>
    <p className="text-xs text-muted-foreground">
      Select the searches that will find your competitors
    </p>
    
    <div className="space-y-2 mt-3">
      {searchQueries.map((sq, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Checkbox
            checked={sq.enabled}
            onCheckedChange={(checked) => toggleQuery(idx, checked)}
          />
          <span className="text-sm font-mono bg-background px-2 py-1 rounded">
            {sq.query}
          </span>
        </div>
      ))}
    </div>
    
    {/* Add custom query */}
    <div className="flex gap-2 mt-3">
      <Input
        placeholder="Add custom search term..."
        value={customQuery}
        onChange={(e) => setCustomQuery(e.target.value)}
      />
      <Button variant="outline" size="sm" onClick={addCustomQuery}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  </div>
)}
```

### 2. Update Backend: `competitor-hybrid-discovery`

Accept custom search queries from the frontend:

```typescript
const { 
  workspaceId, 
  industry, 
  location, 
  radiusMiles = 20,
  maxCompetitors = 50,
  customQueries = []  // NEW: User-provided search terms
} = await req.json();
```

### 3. Update Webhook: `competitor-webhooks.ts`

Use user-provided queries instead of auto-generating:

```typescript
// Use custom queries if provided, otherwise generate defaults
const queries = customQueries?.length > 0 
  ? customQueries 
  : [
      `${industry} ${location}`,
      `${industry} near ${location}`,
      `best ${industry} ${location}`,
    ];
```

### 4. Store Queries in Job Record

Save the actual queries used for debugging/transparency:

```sql
ALTER TABLE competitor_research_jobs 
ADD COLUMN IF NOT EXISTS search_queries_used JSONB;
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/onboarding/CompetitorResearchStep.tsx` | Add search query preview UI |
| `supabase/functions/competitor-hybrid-discovery/index.ts` | Accept `customQueries` parameter |
| `supabase/functions/competitor-webhooks/index.ts` | Use custom queries in SERP phase |
| Database migration | Add `search_queries_used` column |

---

## Expected Outcome

After this change:
1. User enters "Window Cleaning" + "Luton"
2. **Sees exact search terms** that will be used: "window cleaning luton", "window cleaner luton", etc.
3. Can **edit or add** their preferred terms
4. Clicks "Start Research"
5. Results will **exactly match** what those Google searches return
6. In Review screen, can see which queries found which competitors

---

## Alternative: "Test This Search" Button

For even more transparency, add a "Preview Results" button that:
1. Runs a quick Firecrawl search (3-5 results)
2. Shows a preview of what the search term finds
3. Helps user verify the term before committing to full discovery

This would add ~$0.02 per preview but gives complete confidence in the search terms.
