
# Niche-Aware Competitor Search

## The Problem
When you search for "crose" (looking for `crose.cleaning`), the search returns irrelevant results like "A.T. Cross UK", "Roche UK", and "Silvertoad" because:

1. The search query becomes: `"crose UK business website"`
2. It has **no idea** you're in the **cleaning** industry
3. So it matches "crose" against any UK business

## The Solution: Pass the Niche to Search

The parent component (`CompetitorPipelineProgress`) already knows your niche (e.g., "Window Cleaning") via the `nicheQuery` prop. We just need to:

1. **Pass the niche** from `CompetitorPipelineProgress` → `CompetitorListDialog`
2. **Include the niche in the search API call** from the dialog
3. **Append the niche to the search query** in the backend

This way, searching "crose" becomes: `"crose window cleaning UK business website"` — which is far more likely to return `crose.cleaning`.

---

## Technical Changes

### 1. Update `CompetitorListDialog` Props

Add a new `nicheQuery` prop to the component.

**File:** `src/components/onboarding/CompetitorListDialog.tsx`

```typescript
// Current props
export function CompetitorListDialog({
  jobId,
  workspaceId,
  serviceArea,
  disabled,
  className,
}: {
  jobId: string;
  workspaceId?: string;
  serviceArea?: string;  // ← location
  disabled?: boolean;
  className?: string;
}) {

// Updated props
export function CompetitorListDialog({
  jobId,
  workspaceId,
  serviceArea,
  nicheQuery,  // ← ADD THIS
  disabled,
  className,
}: {
  jobId: string;
  workspaceId?: string;
  serviceArea?: string;
  nicheQuery?: string;  // ← ADD THIS (e.g., "Window Cleaning")
  disabled?: boolean;
  className?: string;
}) {
```

### 2. Include Niche in API Call

Update the `searchForSuggestions` function to pass `niche` to the backend.

**File:** `src/components/onboarding/CompetitorListDialog.tsx`

```typescript
// Current API call
const { data, error } = await supabase.functions.invoke('competitor-search-suggest', {
  body: { query: searchQuery, location: serviceArea }
});

// Updated API call
const { data, error } = await supabase.functions.invoke('competitor-search-suggest', {
  body: { 
    query: searchQuery, 
    location: serviceArea,
    niche: nicheQuery  // ← ADD THIS
  }
});
```

### 3. Update Backend to Use Niche

Modify the edge function to include the niche in the search query.

**File:** `supabase/functions/competitor-search-suggest/index.ts`

```typescript
// Current query building
const { query, location } = await req.json();
const searchQuery = location 
  ? `${query} ${location} UK business website`
  : `${query} UK business website`;

// Updated query building
const { query, location, niche } = await req.json();

// Build smarter search query with niche context
let searchQuery = query;
if (niche) {
  searchQuery += ` ${niche}`;
}
if (location) {
  searchQuery += ` ${location}`;
}
searchQuery += ' UK';

// Result: "crose Window Cleaning Luton UK"
```

### 4. Pass Niche from Parent Component

Update the call site in `CompetitorPipelineProgress`.

**File:** `src/components/onboarding/CompetitorPipelineProgress.tsx`

```typescript
// Current call (line ~412)
<CompetitorListDialog 
  jobId={jobId} 
  workspaceId={workspaceId} 
  serviceArea={serviceArea} 
/>

// Updated call
<CompetitorListDialog 
  jobId={jobId} 
  workspaceId={workspaceId} 
  serviceArea={serviceArea}
  nicheQuery={nicheQuery}  // ← ADD THIS
/>
```

---

## Expected Result

| Search Input | Current Query | New Query |
|--------------|---------------|-----------|
| `crose` | `crose UK business website` | `crose Window Cleaning Luton UK` |
| `premium` | `premium UK business website` | `premium Window Cleaning Luton UK` |
| `sparkle` | `sparkle UK business website` | `sparkle Window Cleaning Luton UK` |

This should dramatically improve search relevance by anchoring results to your specific industry.

---

## Files to Change

| File | Change |
|------|--------|
| `src/components/onboarding/CompetitorListDialog.tsx` | Add `nicheQuery` prop, pass to API call |
| `src/components/onboarding/CompetitorPipelineProgress.tsx` | Pass `nicheQuery` to dialog |
| `supabase/functions/competitor-search-suggest/index.ts` | Include niche in search query |

---

## Summary

- **Root cause:** Search doesn't know what industry you're in
- **Fix:** Pass the niche (e.g., "Window Cleaning") through the entire chain
- **Benefit:** Searching "crose" will find cleaning businesses named Crose, not pen companies
