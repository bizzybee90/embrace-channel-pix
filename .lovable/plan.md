
# Complete Data Wipe + FAQ Voice Fix

## Problem Summary
1. **Stale data accumulated** across multiple test runs - 1,058 "own" FAQs, 2,354 competitor FAQs, 17,100 email queue entries, 273 competitor sites, 10 scraping jobs
2. **PDF voice is wrong** - FAQs say "MAC Cleaning uses..." (third person) instead of "We use..." (first person). BizzyBee should represent the business, so all knowledge should read as if the business itself is speaking.

## Part 1: Complete Data Wipe

Wipe all accumulated test data for workspace `681ad707-3105-4238-a552-f5346577810f`:

| Table | Records | Action |
|-------|---------|--------|
| faq_database | 3,774 | DELETE all |
| email_import_queue | 17,100 | DELETE all |
| competitor_sites | 273 | DELETE all |
| scraping_jobs | 10 | DELETE all |
| conversations | 3 | DELETE all |
| messages (via conversations) | 3 | DELETE all |
| customers | 3 | DELETE all |
| example_responses | 29 | DELETE all |
| voice_profiles | 1 | DELETE all |
| n8n_workflow_progress | 3 | RESET to pending |
| email_import_progress | 1 | DELETE all |
| users (onboarding flags) | 1 | Reset onboarding_completed=false, onboarding_step='welcome' |

This gives a completely fresh slate for re-testing onboarding end-to-end.

## Part 2: Fix FAQ Voice (Third Person to First Person)

The root cause is the AI extraction prompt in the edge functions. When Apify scrapes the website, the content naturally says "MAC Cleaning does X". The AI extraction step should be rewriting these into first-person voice ("We do X") since BizzyBee represents the business.

### Changes needed:

**File: `supabase/functions/process-own-website-scrape/index.ts`** (or whichever function contains the FAQ extraction prompt)
- Update the AI system prompt to instruct it to write all FAQs in first-person voice
- Example instruction: "Write all answers in first person ('we', 'our', 'us') as if you ARE the business. Never refer to the business by name in the third person."

This ensures that when the website is re-scraped from fresh, every FAQ naturally reads: "We use the reach and wash system..." instead of "MAC Cleaning uses the reach and wash system..."

## Technical Details

### Data wipe SQL (executed in order to respect foreign keys):
```text
1. DELETE messages (via conversation join)
2. DELETE conversations
3. DELETE customers
4. DELETE faq_database
5. DELETE email_import_queue
6. DELETE competitor_sites
7. DELETE scraping_jobs
8. DELETE example_responses
9. DELETE voice_profiles
10. DELETE email_import_progress
11. UPDATE n8n_workflow_progress (reset statuses)
12. UPDATE users (reset onboarding)
```

### FAQ extraction prompt update:
- Locate the system prompt that instructs the AI to extract FAQs from scraped website content
- Add explicit first-person voice instructions
- This affects future scrapes only (which is fine since we're wiping all data)
