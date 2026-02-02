
# Dedicated Search Query Step for Competitor Research

## Overview

Transform the search query customization from a collapsible section within the main form into its own **dedicated step** in the competitor research flow. This gives the search terms the prominence they deserve and ensures users explicitly confirm their queries before starting discovery.

## Current vs Proposed Flow

```text
CURRENT FLOW (Single Step):
┌─────────────────────────────────────────────────────────────┐
│ 1. SETUP FORM                                               │
│    ├─ Industry / Niche: [Window Cleaning]                   │
│    ├─ Service Area: [Luton]                                 │
│    ├─ ▼ Preview Search Terms (collapsible, easy to miss)    │
│    └─ Target count: ○ 50 ● 100 ○ 250                       │
│                                                             │
│    [Back] [Skip] [Start Research]                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
              (Discovery starts immediately)


PROPOSED FLOW (Two Steps):
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: SETUP                                               │
│    ├─ Industry / Niche: [Window Cleaning]                   │
│    ├─ Service Area: [Luton]                                 │
│    └─ Target count: ○ 50 ● 100 ○ 250                       │
│                                                             │
│    [Back] [Skip] [Next: Review Search Terms →]              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: SEARCH TERMS (NEW DEDICATED STEP)                   │
│                                                             │
│    🔍 Confirm Your Google Search Terms                      │
│    These exact phrases will be searched on Google:          │
│                                                             │
│    ┌──────────────────────────────────────────────────────┐ │
│    │ ☑ window cleaning luton                           ✕  │ │
│    │ ☑ window cleaning near luton                      ✕  │ │
│    │ ☑ best window cleaning luton                      ✕  │ │
│    │ ☑ window cleaner luton                            ✕  │ │
│    │ ☐ local window cleaning luton                     ✕  │ │
│    │ ☐ luton window cleaning services                  ✕  │ │
│    └──────────────────────────────────────────────────────┘ │
│                                                             │
│    ┌─ Quick Add Suggestions ─────────────────────────────┐  │
│    │ [+ "professional window cleaning luton"]            │  │
│    │ [+ "window cleaners near me luton"]                 │  │
│    │ [+ "affordable window cleaning luton"]              │  │
│    └─────────────────────────────────────────────────────┘  │
│                                                             │
│    [+ Add custom term...                      ]             │
│                                                             │
│    💡 Tip: Use terms you'd actually type into Google        │
│                                                             │
│    [← Back to Setup] [Skip] [Start Research]                │
└─────────────────────────────────────────────────────────────┘
```

## Technical Implementation

### 1. Add Internal Step State

Introduce a `formStep` state to track whether the user is on the "setup" or "search-terms" step:

```typescript
type FormStep = 'setup' | 'search-terms';

const [formStep, setFormStep] = useState<FormStep>('setup');
```

### 2. Modify "Next" Button Behavior

The "Start Research" button on Step 1 becomes "Next: Review Search Terms" and advances to Step 2:

```typescript
// Step 1 button
<Button 
  onClick={() => setFormStep('search-terms')} 
  disabled={!nicheQuery.trim() || !serviceArea.trim()}
>
  Next: Review Search Terms →
</Button>
```

### 3. Create Dedicated Search Terms UI

A clean, focused UI for Step 2 with:
- Clear header explaining what will happen
- Full-height list of search terms (not collapsed)
- **Quick Add Suggestions** - clickable buttons for common query patterns:
  - `professional [industry] [location]`
  - `[industry] near me [location]`
  - `affordable [industry] [location]`
  - `top rated [industry] [location]`
- Custom input field with Add button
- Back button to return to setup

### 4. Quick Add Suggestions Logic

Generate context-aware suggestions based on industry:

```typescript
const quickSuggestions = useMemo(() => {
  if (!nicheQuery || !serviceArea) return [];
  
  const industry = nicheQuery.toLowerCase();
  const location = serviceArea.toLowerCase();
  
  // Common patterns that aren't already in the list
  const patterns = [
    `professional ${industry} ${location}`,
    `${industry} near me ${location}`,
    `affordable ${industry} ${location}`,
    `top rated ${industry} ${location}`,
    `cheap ${industry} ${location}`,
    `${industry} company ${location}`,
  ];
  
  // Filter out suggestions that already exist in the query list
  const existingQueries = searchQueries.map(sq => sq.query.toLowerCase());
  return patterns.filter(p => !existingQueries.includes(p));
}, [nicheQuery, serviceArea, searchQueries]);
```

### 5. Handle Resume Behavior

When a job resumes (page refresh), skip directly to the progress screen as before:

```typescript
// Existing resume logic handles this - no changes needed
if (status === 'running' && jobId) {
  return <CompetitorPipelineProgress ... />;
}
```

### 6. Conditional Rendering Based on formStep

Replace the single form with conditional rendering:

```tsx
// Idle state - show form based on current step
if (formStep === 'setup') {
  return (
    <div className="space-y-6">
      {/* Industry input */}
      {/* Service area input */}
      {/* Target count selection */}
      {/* What happens explanation */}
      
      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button variant="outline" onClick={handleSkip}>Skip</Button>
        <Button 
          onClick={() => setFormStep('search-terms')} 
          disabled={!nicheQuery.trim() || !serviceArea.trim()}
        >
          Next: Review Search Terms →
        </Button>
      </div>
    </div>
  );
}

if (formStep === 'search-terms') {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <CardTitle className="text-xl flex items-center justify-center gap-2">
          <Search className="h-5 w-5 text-primary" />
          Confirm Search Terms
        </CardTitle>
        <CardDescription className="mt-2">
          These exact phrases will be searched on Google to find competitors
        </CardDescription>
      </div>
      
      {/* Search terms list (not collapsed) */}
      {/* Quick add suggestions */}
      {/* Custom input */}
      
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => setFormStep('setup')}>
          ← Back
        </Button>
        <Button variant="outline" onClick={handleSkip}>Skip</Button>
        <Button onClick={handleStart} disabled={enabledQueries.length === 0}>
          Start Research
        </Button>
      </div>
    </div>
  );
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/onboarding/CompetitorResearchStep.tsx` | Add `formStep` state, split UI into two steps, add quick suggestions |

## Visual Highlights for Step 2

- **Full-screen focus** on search terms (no other inputs competing for attention)
- **Prominent checkboxes** for enabling/disabling queries
- **Quick Add Suggestions** as clickable pills/badges for one-click addition
- **Clear call-to-action** explaining that these are the exact Google searches
- **Validation** - "Start Research" disabled if no queries enabled

## Expected User Experience

1. User fills in "Window Cleaning" + "Luton" on Step 1
2. Clicks "Next: Review Search Terms"
3. Sees a dedicated page showing exactly what will be searched
4. Can toggle existing suggestions, add custom terms, or click quick-add buttons
5. Clicks "Start Research" with full confidence in the search strategy
6. During Stage 1, sees the same terms displayed as badges (existing feature)
