

# Improve Own-Website FAQ Quality with AI Consolidation

## What Changes

Two targeted improvements to the `process-own-website-scrape` edge function:

### Part 1: Smarter Extraction Prompt

Update the `extractFaqsWithClaude` system prompt (line 563-582) to add strict topic-scoping rules that prevent cross-page duplication at the source. Key additions:

- Do NOT generate coverage/area FAQs unless the page is specifically a locations or coverage page
- Do NOT generate payment, cancellation, or scheduling FAQs unless it is the FAQ page, Terms page, or a dedicated policy page
- Do NOT generate contact FAQs unless on the Contact page
- Do NOT generate pricing FAQs unless on a Pricing or FAQ page
- Focus only on what is unique to THIS page
- Quality gate: "Would a real customer actually ask this?"
- Reject marketing fluff reworded as questions

This alone should cut the raw extraction from ~35 down to ~25 per run, with far fewer semantic duplicates reaching the consolidation step.

### Part 2: AI-Powered Consolidation Pass

Replace the current lightweight `consolidateFaqs` function (lines 130-216) with a new version that calls the Lovable AI Gateway to semantically deduplicate the full FAQ set.

**How it works:**
1. Fetch all active own-content FAQs for the workspace
2. If 25 or fewer, skip (already lean)
3. Send all FAQs to `google/gemini-2.5-flash` via the Lovable AI Gateway with a detailed consolidation prompt
4. The AI merges semantic duplicates, resolves contradictions (FAQ page wins over location pages), removes marketing fluff, and returns the canonical set
5. Deactivate all FAQs not in the keep list; update rewritten ones
6. Safety checks: abort if AI returns fewer than 10 or more than input count

**Consolidation priority order:**
- HIGHEST: FAQ page content (the business owner's deliberate answers)
- HIGH: Terms/policy pages
- MEDIUM: Dedicated service pages, homepage
- LOW: Location/SEO pages

**Safety measures:**
- Minimum floor of 10 FAQs (aborts if AI over-reduces)
- No-op if AI returns same or more than input
- Skips entirely if already at 25 or fewer
- Low temperature (0.1) for deterministic output
- Audit logging of every merge

### No Database Changes Required

The existing `faq_database` schema with `is_active` flag handles everything.

## Technical Details

### File Changed

`supabase/functions/process-own-website-scrape/index.ts`

**Extraction prompt update** (lines 563-582):
- Add topic-scoping rules at the end of the system prompt
- Prevent redundant coverage, payment, contact, and pricing FAQs from non-authoritative pages

**Replace consolidateFaqs** (lines 130-216):
- New function fetches all active own-content FAQs
- Calls `https://ai.gateway.lovable.dev/v1/chat/completions` with `LOVABLE_API_KEY` (already configured as a secret)
- Uses `google/gemini-2.5-flash` model
- Parses JSON response, deactivates removed FAQs, updates rewritten ones
- Column mapping: uses `workspace_id` (not business_id), `is_own_content` (not content_type)

**The `hasContradiction` helper** (lines 199-216) is removed since the AI handles contradiction resolution natively.

### Expected Outcome

- Before: 34 FAQs with 5+ coverage duplicates, contradictory answers, repeated method explanations
- After: 20-25 unique, high-quality FAQs with no duplicates or contradictions
- The actual FAQ page questions (cancellation, payment, scheduling) get priority
- Coverage consolidated to a single canonical answer
- Works for any business type (plumber, mechanic, electrician, etc.)

