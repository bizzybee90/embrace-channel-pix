
# Show Search Terms During Stage 1 Discovery

## Problem Identified

The search terms are only visible in two places:
1. **Before starting** - in the setup form (collapsed by default, and bypassed when resuming a job)
2. **After completion** - in the Review Competitors screen

But they're **NOT visible during Stage 1** while discovery is actively running. This is exactly when users want to see them to understand what's being searched.

## Solution

Add a "Search terms being used" section **inside Stage 1** of `CompetitorPipelineProgress.tsx`, shown while discovery is `in_progress`.

### Visual Design

```text
┌─────────────────────────────────────────────────────────────┐
│ STAGE 1  Discover Competitors                  In Progress │
│ Finding businesses in your area                            │
│                                                            │
│ ┌─ Progress ───────────────────────────────────┐           │
│ │ ████████░░░░░░░░░░░░░░░░░░░░░░  12/50 found │           │
│ │ 🔵 Searching Google Maps...          1:23   │           │
│ └──────────────────────────────────────────────┘           │
│                                                            │
│ ┌─ Search terms being used ────────────────────┐           │
│ │ ⊛ window cleaning luton                      │           │
│ │ ⊛ window cleaner luton                       │           │
│ │ ⊛ window cleaning near luton                 │           │
│ │ ⊛ best window cleaning luton                 │           │
│ └──────────────────────────────────────────────┘           │
│                                                            │
│ 💡 This step uses Google Maps to find real businesses...  │
└─────────────────────────────────────────────────────────────┘
```

## Technical Implementation

### 1. Pass Search Queries to Pipeline Progress

**File: `src/components/onboarding/CompetitorResearchStep.tsx`**

When the job is running, pass the enabled search queries to `CompetitorPipelineProgress`:

```tsx
<CompetitorPipelineProgress
  workspaceId={workspaceId}
  jobId={jobId}
  nicheQuery={nicheQuery}
  serviceArea={serviceArea}
  targetCount={targetCount}
  searchQueries={enabledQueries}  // NEW: pass the queries
  onComplete={handlePipelineComplete}
  ...
/>
```

### 2. Display Search Queries in Stage 1

**File: `src/components/onboarding/CompetitorPipelineProgress.tsx`**

Add a new prop and display the queries inside the Stage 1 card:

```tsx
interface CompetitorPipelineProgressProps {
  // ... existing props
  searchQueries?: string[];  // NEW
}

// Inside Stage 1's children, after the progress section:
{searchQueries && searchQueries.length > 0 && (
  <div className="mt-3 p-3 bg-muted/30 rounded-lg border border-border/50">
    <div className="flex items-center gap-2 mb-2">
      <Eye className="h-3.5 w-3.5 text-primary" />
      <span className="text-xs font-medium text-foreground">
        Search terms being used
      </span>
    </div>
    <div className="flex flex-wrap gap-1.5">
      {searchQueries.map((query) => (
        <Badge 
          key={query} 
          variant="secondary" 
          className="font-mono text-xs"
        >
          {query}
        </Badge>
      ))}
    </div>
  </div>
)}
```

### 3. Fetch Queries from DB for Resumed Jobs

When a user refreshes the page and the job resumes, the `searchQueries` state will be empty. We need to fetch them from the database:

**File: `src/components/onboarding/CompetitorPipelineProgress.tsx`**

Add a useEffect to fetch the stored queries:

```tsx
const [storedSearchQueries, setStoredSearchQueries] = useState<string[]>([]);

useEffect(() => {
  const fetchJobQueries = async () => {
    const { data } = await supabase
      .from('competitor_research_jobs')
      .select('search_queries')
      .eq('id', jobId)
      .maybeSingle();
    
    if (data?.search_queries && Array.isArray(data.search_queries)) {
      setStoredSearchQueries(data.search_queries);
    }
  };
  
  fetchJobQueries();
}, [jobId]);

// Merge: prefer passed queries, fall back to stored
const displayQueries = searchQueries?.length 
  ? searchQueries 
  : storedSearchQueries;
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/onboarding/CompetitorResearchStep.tsx` | Pass `searchQueries` prop to pipeline |
| `src/components/onboarding/CompetitorPipelineProgress.tsx` | Accept prop, fetch from DB, display in Stage 1 |

## Expected Result

When users are on Stage 1 (discovery in progress), they will now see:
1. Progress bar with count
2. Status message ("Searching Google Maps...")
3. **NEW: List of exact search terms being used** (e.g., "window cleaning luton")
4. Helpful tip about timing

This gives users immediate visibility into what the system is searching for, building trust and allowing them to verify the terms match their expectations.
