

# Consolidate n8n Competitor Workflow and Clean Up Deprecated Edge Functions

## Overview

Now that n8n handles the full competitor pipeline (discovery, scraping, FAQ extraction, and Supabase upsert), several edge functions are redundant. This plan removes them and updates any code that references them.

## Part 1: n8n Workflow Changes (Manual — User Actions in n8n)

These are instructions for you to apply in the n8n workflow editor. No code changes from Lovable.

### 1A. Replace "Generate FAQs" + "Parse FAQs" with a Single AI Agent

- Delete the "Generate FAQs" and "Parse FAQs" nodes
- Add a new **AI Agent** node called **"Extract and Validate FAQs"**
- LLM: Anthropic Chat Model (`claude-sonnet-4-20250514`)
- No tools needed
- System Prompt:

```text
You are a strict FAQ extraction and validation agent for a {{ $('Passthrough Data').first().json.business_type }} business.

SCRAPED COMPETITOR CONTENT:
{{ $('Parse Scraped Content').first().json.website_content }}

COMPETITOR: {{ $('Parse Scraped Content').first().json.business_name }}
DOMAIN: {{ $('Parse Scraped Content').first().json.domain }}

YOUR TASKS:
1. Extract genuine FAQ-worthy questions from the scraped content
2. ONLY include facts directly supported by the source material - zero hallucination
3. Flag questions where the client could differentiate (competitor weakness = opportunity)
4. Categorize each FAQ

Return ONLY valid JSON array:
[
  {
    "question": "...",
    "answer": "...",
    "category": "Services|Pricing|Policies|Process|Coverage|Contact|General",
    "confidence": "high|medium|low",
    "opportunity": true or false,
    "opportunity_note": "Client could highlight X here" or null
  }
]

RULES:
- Extract ALL relevant FAQs the content supports - no arbitrary limit
- Skip generic/obvious questions
- Answers must reflect what the competitor ACTUALLY says, not assumptions
- Mark confidence "low" if the answer is inferred rather than explicit
- Be exhaustive with services, areas covered, pricing details
```

- Connect: `Parse Scraped Content` -> `Extract and Validate FAQs` -> `Upsert Competitor`

### 1B. Add "Status: Processing" Callback Inside the Loop

- Add an **HTTP Request** node inside the loop called **"Status: Processing"**
- Place it after the loop start, before "Apify Website Scraper"
- Method: `POST`
- URL: `{{ $('Passthrough Data').first().json.callback_url }}`
- Body:
```json
{
  "type": "competitor_discovery_status",
  "workspace_id": "{{ $('Passthrough Data').first().json.workspace_id }}",
  "status": "processing",
  "message": "Processing competitor {{ $runIndex + 1 }} of {{ $('Parse Agent Results').first().json.total_found }}: {{ $json.business_name }}",
  "current": "{{ $runIndex + 1 }}",
  "total": "{{ $('Parse Agent Results').first().json.total_found }}",
  "current_competitor": "{{ $json.domain }}",
  "timestamp": "{{ new Date().toISOString() }}"
}
```
- Enable **"Continue on Fail"** so callback errors do not stop the workflow

## Part 2: Edge Function Cleanup (Lovable Code Changes)

### 2A. Delete Deprecated Edge Functions

These functions are fully replaced by the n8n workflow:

| Function | Reason for Removal |
|---|---|
| `handle-scrape-complete` | n8n does scraping + page storage directly |
| `extract-competitor-faqs` | n8n AI Agent extracts FAQs |
| `competitor-extract-faqs` | Duplicate of above (Anthropic version) |
| `competitor-scrape-worker` | n8n handles Apify scraping |
| `kb-mine-site` | n8n AI Agent validates + extracts |

Files to delete:
- `supabase/functions/handle-scrape-complete/index.ts`
- `supabase/functions/extract-competitor-faqs/index.ts`
- `supabase/functions/competitor-extract-faqs/index.ts`
- `supabase/functions/competitor-scrape-worker/index.ts`
- `supabase/functions/kb-mine-site/index.ts`

### 2B. Update References to Deleted Functions

**`supabase/functions/competitor-research-watchdog/index.ts`** — Remove cases that invoke `competitor-scrape-worker` and `extract-competitor-faqs`. These statuses (`scraping`, `extracting`) are now managed by n8n and reported via callbacks.

**`supabase/functions/competitor-scrape-start/index.ts`** — Remove the reference to `handle-scrape-complete` webhook URL. This function may itself be unnecessary if n8n handles scraping, but it is also used from the `CompetitorPipelineProgress` review flow. Needs review to determine if it should be kept or removed.

**`supabase/functions/recover-competitor-job/index.ts`** — Remove the invoke of `competitor-extract-faqs`. The recovery flow should instead re-trigger the n8n workflow.

**`supabase/functions/competitor-discover-smart/index.ts`** — Remove the invoke of `competitor-scrape-worker`. This function may also be fully replaced by the n8n AI Agent discovery step.

**`src/components/onboarding/CompetitorMiningLoop.tsx`** — Remove or deprecate the `kb-mine-site` invocation. This component calls `kb-mine-site` in a client-side loop. Since n8n now handles this, the component may no longer be needed, or it should be updated to show progress from `n8n_workflow_progress` instead.

### 2C. Update `n8n-competitor-callback` to Handle "processing" Status

The callback edge function already accepts arbitrary fields and stores them in `details`. The new `current`, `total`, and `current_competitor` fields will be stored automatically. No code change is needed for the callback itself.

However, the **ProgressScreen UI** (`src/components/onboarding/ProgressScreen.tsx`) should be updated to display the new real-time progress info:
- Show `"Processing competitor X of Y: domain.com"` from the `message` field
- Display `current`/`total` as a progress bar or fraction

### 2D. Functions to KEEP

| Function | Reason |
|---|---|
| `trigger-n8n-workflows` | Kicks off n8n workflows |
| `n8n-competitor-callback` | Receives status updates from n8n |
| `competitor-dedupe-faqs` | May still be useful if n8n does not deduplicate |
| `competitor-refine-faqs` | May still be useful depending on n8n pipeline |

## Part 3: UI Enhancement for Real-Time Progress

Update `ProgressScreen.tsx` to show the `current`/`total` competitor progress and the `current_competitor` domain when the status is `"processing"`. This gives users live feedback like:

```
Processing competitor 5 of 47: cleanwindows.co.uk
[===========                              ] 11%
```

## Technical Notes

- The `faq_database` table mapping stays the same — n8n upserts with `priority: 5` and `is_own_content: false`
- The `competitor_research_jobs` table status lifecycle remains valid; n8n callbacks update `n8n_workflow_progress` (not the jobs table directly), so the watchdog may need adjustment
- Edge function deletion will also require calling the `delete_edge_functions` tool to remove deployed versions

