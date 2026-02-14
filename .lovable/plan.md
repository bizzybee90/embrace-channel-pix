

# Replace Competitor Count Selector with Smart Default of 15

## Summary

Remove the 50/100/250 competitor radio selectors from both onboarding screens and hardcode a fixed default of **15 competitors**. Replace the selector UI with a brief explainer paragraph that communicates value instead of asking users to guess a number.

## What Changes

### 1. CompetitorResearchStep.tsx

**Remove:**
- `targetCountOptions` array (lines 138-142)
- `targetCount` state -- currently defaults to `draft.targetCount ?? 100` (line 184). Replaced with a constant `const targetCount = 15`
- `targetCount` from localStorage draft save/restore (lines 168, 388, 391)
- The RadioGroup UI block "How many competitors to analyze?" (lines 752-784)
- `RadioGroup` and `RadioGroupItem` imports (line 6) -- no longer used in this file

**Update:**
- `maxCompetitors: targetCount` in the `startResearch` function (line 499) will now send `15`
- `targetCount` prop on `CompetitorPipelineProgress` (line 572) will now pass `15`
- The "What happens" explainer box (lines 787-793) updated to:
  > "We discover real [business type] businesses near you, scrape their websites, and extract FAQ gaps -- questions customers ask them that your site doesn't answer yet."

**Add (where the RadioGroup was):**
- A short explainer paragraph styled as `text-sm text-muted-foreground`:
  > "We'll find and deeply analyse your top 15 local competitors -- extracting every FAQ, pricing detail, and service they offer that your site doesn't cover yet."

### 2. SearchTermsStep.tsx

**Remove:**
- `TargetCount` type (line 24) and `TARGET_OPTIONS` array (lines 26-30)
- `targetCount` state (line 84)
- The RadioGroup block "How many competitors to research?" (lines 302-330)
- The `targetCount` badge from the footer summary (line 336)
- `RadioGroup` and `RadioGroupItem` imports (line 11)

**Update:**
- Hardcode `target_count: 15` in the save payload (line 183 area)

**Add (where the RadioGroup was):**
- Same explainer paragraph as above, styled as `text-sm text-muted-foreground`

### 3. No Backend Changes

The `maxCompetitors` / `target_count` parameters already flow through as plain integers. The value `15` works identically to `100` in:
- `competitor-hybrid-discovery` edge function
- `trigger-n8n-workflows` edge function
- n8n discovery workflow
- `competitor_research_jobs` table (`target_count` column)

## Technical Details

| File | Key Lines | Change |
|---|---|---|
| `CompetitorResearchStep.tsx` | 6, 138-142, 168, 184, 388, 391, 499, 520, 572, 752-784, 787-793 | Remove imports, options array, state, draft persistence, RadioGroup; hardcode 15; update copy |
| `SearchTermsStep.tsx` | 11, 24-30, 84, 183, 302-330, 336 | Remove imports, type, options, state, RadioGroup, badge; hardcode 15 in payload |

### What Stays the Same

- Search terms customisation (toggle, add, remove queries) -- untouched
- n8n discovery workflow, Apify actors, edge functions -- all accept any integer
- Competitor review screen, scraping pipeline, FAQ extraction -- unchanged
- `competitor_research_jobs.target_count` column still stores 15 for audit
- `CompetitorPipelineProgress` component -- receives 15 instead of 100

