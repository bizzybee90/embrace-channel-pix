

# Phase 2: Context-Enriched Classification

## What This Does
Right now, the bulk classifier (`email-classify-bulk`) uses a generic prompt with no knowledge of the business. It doesn't know what services you offer, what corrections you've made, or what sender rules exist. This phase injects all that context to dramatically improve classification accuracy.

## Changes

### 1. Enrich `email-classify-bulk` Prompt with Business Context

Before building the classification prompt, fetch three context sources and inject them:

**a) Business Profile** -- from `business_context` table:
- Company name, business type, service area
- Tells the AI "this is a gutter cleaning company in Manchester" so it can distinguish a "quote request" from a "general inquiry" correctly

**b) Sender Rules** -- from `sender_rules` table (active rules with `skip_llm = true`):
- Apply deterministic rules BEFORE sending to the AI (just like `classify-emails` already does)
- Emails matching sender rules skip the LLM entirely, saving tokens and improving speed
- Remaining emails go to the AI with a note about what rules exist

**c) Classification Corrections** -- from `classification_corrections` table:
- Fetch the 20 most recent corrections as few-shot examples
- Inject them into the prompt: "Previously, an email about X was incorrectly classified as Y -- the correct category is Z"
- This teaches the AI from past mistakes without any model fine-tuning

### 2. Add Pre-Triage Rule Gate to Bulk Classifier

The single-email classifier (`classify-emails`) already has a rule gate that skips the LLM for known senders. The bulk classifier doesn't. Adding this:
- Fetches all active `sender_rules` for the workspace
- Before sending emails to the AI, matches each against sender rules
- Matched emails get classified instantly (confidence: 1.0, no AI cost)
- Only unmatched emails go to the LLM prompt

### 3. Add Confidence Score to Output

Expand the AI output schema from `{"i":0,"c":"inquiry","r":true}` to `{"i":0,"c":"inquiry","r":true,"conf":0.92}` and store the confidence value.

### 4. FAQ Context Injection

Fetch the top 15 FAQs from `faq_database` (where `is_own_content = true`) and include them as business context. This helps the AI understand what topics the business handles.

---

## Technical Details

### Files Modified

**`supabase/functions/email-classify-bulk/index.ts`**
- Add context-fetching block before prompt construction (business_context, sender_rules, classification_corrections, faq_database)
- Add sender rule pre-triage gate to skip LLM for matched emails
- Update prompt template with "Business Context", "Known Corrections", and "Business Topics" sections
- Add `conf` field to output schema and store it in the `confidence` column

### Database Migration
- Add `confidence` (FLOAT, nullable) column to `email_import_queue`
- Add `needs_review` (BOOLEAN, default false) column to `email_import_queue`
- Add `entities` (JSONB, nullable) column to `email_import_queue` (for future entity extraction)

### Updated Prompt Structure
```text
You are classifying emails for [Company Name], a [business_type] business in [service_area].

Business topics they handle:
- [FAQ question 1]
- [FAQ question 2]
...

Previous corrections (learn from these):
- "Subject about X" was wrongly classified as "spam" -> correct: "inquiry"
- ...

Categories: inquiry, booking, quote, complaint, follow_up, spam, notification, personal

Return JSON: [{"i":0,"c":"inquiry","r":true,"conf":0.92}]
Where conf = your confidence (0.0-1.0). Use lower values when unsure.

EMAILS:
...
```

### Processing Flow
```text
Fetch 5000 emails
    |
    v
Apply sender_rules (deterministic) --> instant classify matched emails
    |
    v
Remaining emails --> Build enriched prompt with business context
    |
    v
AI classifies with confidence scores
    |
    v
Store results (category, requires_reply, confidence, needs_review)
    |
    v
Self-chain if more remain
```

### What Stays the Same
- The relay-race dispatcher and parallel worker pattern
- The voice learning pipeline
- The backfill system from Phase 1
- All existing categories and the overall flow

