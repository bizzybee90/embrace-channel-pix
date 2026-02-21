

## Upgrade Classification Prompt and Decision Engine

This plan implements the three changes from your Gemini-reviewed prompt: a structured classification system prompt with chain-of-thought reasoning and identity extraction, an updated decision engine handling all 9 categories, and passive identity harvesting into `customer_identities`.

### Changes

**1. Replace classification system prompt (`supabase/functions/_shared/ai.ts`)**

Replace `classificationSystemPrompt()` with the new structured prompt that:
- Extracts business name/industry/rules from the `business_context` record
- Injects FAQ knowledge base and historical corrections
- Defines 9 precise categories: `quote`, `booking`, `complaint`, `follow_up`, `inquiry`, `notification`, `newsletter`, `spam`, `personal`
- Adds chain-of-thought `reasoning` field (generated before the classification decision)
- Requests identity extraction: `extracted_phones`, `extracted_emails`, `location_or_postcode`, `summary`
- Preserves the existing batch input/output contract (`{items: [...]}` in, `{results: [...]}` out)

Also update `DEFAULT_CLASSIFICATION` to use `category: "inquiry"` instead of `"general"` to match the new category set.

**2. Update decision engine (`supabase/functions/pipeline-worker-classify/index.ts`)**

Replace `decisionForClassification()` to handle all 9 categories:
- `notification`, `newsletter`, `spam`, `personal` -> `auto_handled` / `resolved`
- `follow_up` where `requires_reply === false` -> `auto_handled` / `resolved`
- Low confidence (< 0.7) -> `needs_human` / `escalated`
- `complaint` -> `act_now` / `ai_handling`
- Everything else needing reply -> `quick_win` / `open`

**3. Add identity harvesting (`supabase/functions/pipeline-worker-classify/index.ts`)**

After `applyClassification` successfully updates a conversation, extract `extracted_phones` and `extracted_emails` from the AI response entities and upsert them into `customer_identities`. This passively enriches the cross-channel identity graph with every classified email -- phones formatted to E.164, emails lowercased, all linked to the conversation's `customer_id`.

**4. Update UI category labels (`src/components/shared/CategoryLabel.tsx`)**

Add direct mappings for the new category keys so they render proper pills in the inbox:
- `quote` -> amber Quote pill
- `booking` -> blue Booking pill
- `complaint` -> red Complaint pill
- `follow_up` -> orange Follow-up pill
- `inquiry` -> blue Enquiry pill
- `notification` -> slate Auto pill
- `newsletter` -> pink Marketing pill
- `spam` -> red Spam pill
- `personal` -> purple Personal pill

### Technical Details

**Files modified:**
- `supabase/functions/_shared/ai.ts` -- new system prompt, updated default category
- `supabase/functions/pipeline-worker-classify/index.ts` -- updated `decisionForClassification`, identity harvesting after `applyClassification`
- `src/components/shared/CategoryLabel.tsx` -- new category config entries

**Edge functions redeployed:**
- `pipeline-worker-classify`

**No database migration needed** -- `customer_identities` table and its unique constraint already exist.

