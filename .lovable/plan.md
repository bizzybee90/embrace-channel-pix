

# Simplified Email Import & Voice Learning Pipeline

## Overview

This plan simplifies the entire email import pipeline into three clear, reliable stages that leverage the power of Gemini's massive context window - completing classification in seconds rather than hours.

---

## Current Status

Your 22,630 emails are already imported with:
- **15,000 inbound** (customer emails)
- **7,630 outbound** (your replies)  
- **20+ real conversation threads** with both customer messages AND your replies
- All have `thread_id` for proper conversation linking

The voice learning system is ready to pair these conversations to learn exactly how you respond.

---

## The Three-Stage Pipeline

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           SIMPLIFIED PIPELINE                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   STAGE 1            STAGE 2                    STAGE 3                         │
│   IMPORT             CLASSIFY                   LEARN                           │
│   ────────           ────────                   ─────                           │
│                                                                                  │
│   Aurinko fetches    ONE Gemini call            Pair inbound + outbound         │
│   emails from        classifies ALL             emails by thread_id             │
│   your inbox         emails at once             to learn your voice             │
│                                                                                  │
│   ~500/min           ~30 seconds                ~2-3 minutes                    │
│   (API limited)      (single prompt)            (builds voice DNA)              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## What Happens in Each Stage

### Stage 1: Import (Already Complete)
- Fetches email metadata from Aurinko
- Stores in `email_import_queue` with `thread_id` and `direction`
- Downloads email bodies

### Stage 2: Classify (To Be Simplified)
**One Gemini call** processes all 22,630 emails:
- Categories: inquiry, booking, quote, complaint, follow_up, spam, notification, personal
- Flags `requires_reply` for prioritisation
- Updates `email_import_queue` with category

### Stage 3: Voice Learning (Already Built)
Uses `thread_id` to pair conversations:
1. Find outbound emails (your replies)
2. For each, find the preceding inbound email in the same thread
3. Extract your communication patterns:
   - **Voice DNA**: Openers, closers, tics, tone, formatting
   - **Playbook**: Category-specific response templates with real examples
4. Store examples with embeddings for RAG-based reply generation

---

## How Voice Learning Works

The existing `voice-learning` function:

```text
Thread: 19787cc615af34dc
├── Customer: "How much for a 3 bed semi?"        ← inbound
└── You:      "Hiya! 3-bed semi is £18..."        ← outbound (paired with above)

Thread: 19840e7aa32839fa  
├── Customer: "Can you come Tuesday?"             ← inbound
├── You:      "Hi! Got availability Thursday..."  ← outbound
├── Customer: "Thursday works!"                   ← inbound
└── You:      "Great, booked you in..."           ← outbound
```

For each outbound email, it finds the closest preceding inbound in the same thread. This creates training pairs that teach BizzyBee:
- **How you greet customers** (Hiya! / Hi! / Hello)
- **How you sign off** (Cheers / Thanks / Best)
- **Your response structure** for quotes, bookings, complaints
- **Your exact phrases** and linguistic quirks

---

## Technical Implementation

### Files to Modify

| File | Purpose |
|------|---------|
| `email-classify-bulk/index.ts` | Use Lovable AI gateway, store categories properly |
| `email-import-v2/index.ts` | Trigger bulk classification on completion |
| `BackgroundImportBanner.tsx` | Show stable 3-stage progress |

### Database Changes

Add classification columns to `email_import_queue`:
```sql
ALTER TABLE email_import_queue
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS requires_reply BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ;
```

### Bulk Classifier Updates

1. Switch to Lovable AI gateway (no API key needed)
2. Store category and requires_reply in database
3. Trigger voice-learn on completion

### UI Progress Updates

Single source of truth from `email_import_progress`:
- `importing` → "Importing emails... X received"
- `classifying` → "Classifying emails..." (one-time, ~30s)
- `learning` → "Learning your voice..."
- `complete` → "Ready!"

---

## Timeline Expectations

| Stage | Duration | Details |
|-------|----------|---------|
| Import | 60-90 min | Already complete (22,630 emails) |
| Classify | ~30 seconds | ONE Gemini API call |
| Voice Learn | 2-3 minutes | Pairs ~100 conversations, builds profile |
| **Total** | **~3 minutes** | From clicking "classify" to ready |

---

## Summary

**Yes, the classification will properly preserve conversation threading.** The `thread_id` from Aurinko is already stored with each email. The voice learning system uses this to pair your replies with customer messages, teaching BizzyBee exactly how you respond - your greetings, sign-offs, phrases, and response patterns for different inquiry types.

The simplified pipeline will:
1. Classify all emails in one 30-second Gemini call
2. Trigger voice learning automatically
3. Build a complete voice profile with real examples from your actual replies

