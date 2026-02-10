

# Fix: Empty Search Queries in n8n Trigger

## Problem
The `trigger-n8n-workflows` edge function sends an **empty `search_queries` array** to n8n because it reads from a non-existent `search_queries` table. The actual search terms are stored in `n8n_workflow_progress` with `workflow_type = 'search_terms_config'`.

This causes the n8n competitor discovery workflow to receive no search terms, likely causing it to fail silently before reaching its callback nodes.

## Evidence
- `search_queries` table: **does not exist** (SQL error confirmed)
- `n8n_workflow_progress` (workflow_type `search_terms_config`): Contains 10 validated search terms like "window cleaning luton", "best window cleaning luton", etc.
- Both n8n webhooks return HTTP 200, confirming `workspace_id` (`681ad707-...`) is received correctly
- The competitor discovery workflow fails internally because it has no search queries to act on

## Fix

### File: `supabase/functions/trigger-n8n-workflows/index.ts`

Replace the query to the non-existent `search_queries` table (line 26) with a query to `n8n_workflow_progress`:

**Before:**
```typescript
const [profileRes, contextRes, searchTermsRes] = await Promise.all([
  supabase.from('business_profile').select('*').eq('workspace_id', workspaceId).maybeSingle(),
  supabase.from('business_context').select('*').eq('workspace_id', workspaceId).maybeSingle(),
  supabase.from('search_queries').select('*').eq('workspace_id', workspaceId),
])

const profile = profileRes.data as Record<string, unknown> | null
const context = contextRes.data as Record<string, unknown> | null
const searchQueries = ((searchTermsRes.data || []) as unknown as Array<{ query: string }>).map(q => q.query)
```

**After:**
```typescript
const [profileRes, contextRes, searchTermsRes] = await Promise.all([
  supabase.from('business_profile').select('*').eq('workspace_id', workspaceId).maybeSingle(),
  supabase.from('business_context').select('*').eq('workspace_id', workspaceId).maybeSingle(),
  supabase.from('n8n_workflow_progress').select('details')
    .eq('workspace_id', workspaceId)
    .eq('workflow_type', 'search_terms_config')
    .maybeSingle(),
])

const profile = profileRes.data as Record<string, unknown> | null
const context = contextRes.data as Record<string, unknown> | null
const searchConfig = (searchTermsRes.data?.details as Record<string, unknown>) || {}
const searchQueries = (searchConfig.search_queries as string[]) || []
```

This matches exactly how `trigger-n8n-workflow` (singular, the older version) already reads search terms -- aligning the two functions.

### Add Logging

Add a `console.log` before the fetch calls to log the actual payload being sent, making future debugging easier:

```typescript
console.log(`[trigger-n8n-workflows] workspace=${workspaceId} queries=${searchQueries.length} business=${context?.company_name || 'unknown'}`)
```

## Impact
- Competitor discovery workflow will receive the 10 validated search terms
- No other files need changes
- After deploying, you will need to re-trigger (Cancel and Retry + Start AI Training)

