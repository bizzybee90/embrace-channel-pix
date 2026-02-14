

# Build `consolidate-faqs` Edge Function

## Summary

Create a new backend function that takes the 219 raw competitor FAQs already in the database, deduplicates them, identifies topics not covered by MAC Cleaning's own 151 FAQs, and produces adapted versions written in MAC Cleaning's voice with their actual business details substituted in.

## Current State

| Source | Count | Priority | is_own_content |
|--------|-------|----------|----------------|
| Own website (`own_website`) | 151 | 10 | true |
| Competitor research (`competitor_research`) | 219 | 5 | false |
| Adapted (missing -- to be built) | 0 | 8 | false |

## Two-Pass Architecture

**Pass 1 -- Deduplication** (keeps token count manageable)
- Fetch all 219 competitor FAQs for the workspace
- Send to Gemini Flash with instruction: "Group these by topic, merge duplicates, return one representative Q&A per unique topic with the source_business preserved"
- Chunks of ~80 FAQs per call if needed (219 / 3 batches)
- Expected output: ~60-80 unique topics

**Pass 2 -- Gap-Only Adaptation**
- Fetch owner FAQs filtered by `generation_source NOT IN ('competitor_adapted')` -- only treats actual own-website content as authoritative
- Send deduplicated topics + owner FAQ list to Gemini Flash with this prompt:

> "You are adapting competitor knowledge for MAC Cleaning, based in Luton covering a 10-mile radius. Phone: [from business_context]. Services: Window Cleaning, Gutter Cleaning.
>
> Here are the owner's existing FAQs (AUTHORITATIVE -- these topics are already covered, do NOT duplicate them).
>
> Here are deduplicated competitor FAQ topics from other cleaning businesses.
>
> For each topic NOT already covered by the owner's FAQs, produce an adapted version using the owner's business context. Do NOT produce adapted versions for topics the owner already covers.
>
> Write in first person ('we', 'our'). Replace competitor names, addresses, phone numbers, and specific prices with the owner's details or 'contact us for a quote' where appropriate."

The prompt dynamically substitutes actual values from `business_context` (company_name, business_type, service_area) and `business_profile` (phone, services, address) if available.

## Data Model for Adapted FAQs

Each adapted FAQ is inserted with:
- `is_own_content: false` (clearly not owner-authored)
- `priority: 8` (below owner's 10, above raw competitor's 5)
- `generation_source: 'competitor_adapted'`
- `original_faq_id` pointing to the source competitor FAQ
- `source_business` preserved for traceability
- `is_active: true`

## Idempotency

Before inserting, delete any existing rows where `generation_source = 'competitor_adapted'` for this workspace. This handles:
- Callback retries
- Manual backfill after auto-run
- Re-running after pipeline updates

## Trigger Point

Update `n8n-competitor-callback` so when `status === 'scrape_complete'`, after updating progress, it invokes `consolidate-faqs` in the background.

## Files to Create/Edit

1. **New:** `supabase/functions/consolidate-faqs/index.ts`
   - Accepts `{ workspace_id }`
   - Fetches business context from `business_context` table
   - Fetches business profile from `business_profile` table (phone, services, address)
   - Pass 1: Dedup competitor FAQs via Gemini Flash (chunked if > 80)
   - Pass 2: Gap-only adaptation via Gemini Flash
   - Deletes previous `competitor_adapted` rows, inserts new ones
   - Updates `n8n_workflow_progress` with `workflow_type: 'consolidation'`
   - Uses `GOOGLE_API_KEY` (already configured) for Gemini Flash calls

2. **Edit:** `supabase/functions/n8n-competitor-callback/index.ts`
   - Add background invocation of `consolidate-faqs` when `status === 'scrape_complete'`
   - Uses `fetch()` to the function URL with service role key

3. **Edit:** `supabase/config.toml`
   - Add `[functions.consolidate-faqs]` with `verify_jwt = false`

## PDF Impact

The existing `generateCompetitorResearchPDF.ts` already queries for rows where `original_faq_id` is populated. Once adapted rows exist with `original_faq_id` linking to competitor sources, the "Adapted" column populates automatically. No PDF code changes needed.

## Backfill

The function is callable directly to process the 219 existing competitor FAQs without re-running the pipeline. After deployment, a single curl call or UI trigger runs the consolidation on existing data.

