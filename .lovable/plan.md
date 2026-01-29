

# Full-Visibility Email Pipeline Progress UI

## The Problem

The current "Connect your Email" screen shows a confusing, flickering status that doesn't give users confidence about what's happening. You can see:
- "Importing emails..." then "Classifying..." jumping back and forth
- No visibility into how far along each stage actually is
- No way to know what's coming next or when it will finish
- Forced to trust a process you can't see

This creates anxiety rather than confidence.

## The Solution

Replace the current progress UI with a **full-visibility pipeline tracker** that shows every stage on one screen, with real-time progress for each.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                    🐝 Setting Up Your AI Assistant                       │
│                                                                          │
│  We're teaching BizzyBee how you communicate so it can respond           │
│  just like you would. Here's exactly what's happening:                   │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  STAGE 1: Import Emails                                     ✅ DONE │  │
│  │  ────────────────────────────────────────────────────────────────  │  │
│  │  Downloaded your email history from Gmail                          │  │
│  │                                                                    │  │
│  │  ├─ Inbox: 15,000 emails                           ✅              │  │
│  │  └─ Sent:   7,631 emails                           ✅              │  │
│  │                                                                    │  │
│  │  Total: 22,631 emails imported                                     │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  STAGE 2: Classify Emails                              ⏳ IN PROGRESS │  │
│  │  ────────────────────────────────────────────────────────────────  │  │
│  │  AI is sorting emails into categories                              │  │
│  │  (quotes, bookings, complaints, etc.)                              │  │
│  │                                                                    │  │
│  │  [████████████░░░░░░░░░] 7,000 / 22,631   31%                     │  │
│  │                                                                    │  │
│  │  Processing in batches... ~15 min remaining                        │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  STAGE 3: Learn Your Voice                                ○ PENDING │  │
│  │  ────────────────────────────────────────────────────────────────  │  │
│  │  Analyse your sent emails to learn how you respond                 │  │
│  │                                                                    │  │
│  │  Coming next... (takes ~2-3 minutes)                               │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ○─────────────●─────────────○                                          │
│  Import      Classify      Learn      Ready!                            │
│                                                                          │
│  [Continue to next step →]       You can continue while this runs       │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Key Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Full visibility** | All 3 stages visible at once, not just the current one |
| **Real-time numbers** | Actual counts from database (7,000 / 22,631) |
| **Clear status indicators** | Done (tick), In Progress (spinner), Pending (circle) |
| **Time estimates** | Show "~15 min remaining" when possible |
| **Reassurance** | Explain what each stage does in plain English |
| **Non-blocking** | Always show "Continue" button - import runs in background |

## Technical Approach

### New Component: `EmailPipelineProgress.tsx`

Create a dedicated component that:
1. Reads from `email_import_progress` table (single source of truth)
2. Also reads actual counts from `email_import_queue` for classification progress
3. Subscribes via Supabase Realtime for live updates
4. Shows all 3 stages with appropriate status

### Data Sources

| Stage | Source | What to show |
|-------|--------|--------------|
| Import | `email_import_progress.emails_received` | Total imported |
| Import | `email_import_queue` grouped by direction | Inbox vs Sent breakdown |
| Classify | `email_import_queue` where `category IS NOT NULL` | Classified count |
| Learn | `voice_profiles` table | Profile completion status |

### Phase Mapping

The `email_import_progress.current_phase` field drives the UI:

| Phase Value | Stage 1 | Stage 2 | Stage 3 |
|-------------|---------|---------|---------|
| `connecting` | In progress | Pending | Pending |
| `importing` | In progress | Pending | Pending |
| `classifying` | Done | In progress | Pending |
| `learning` | Done | Done | In progress |
| `complete` | Done | Done | Done |

### Files to Create/Modify

| File | Purpose |
|------|---------|
| `src/components/onboarding/EmailPipelineProgress.tsx` | **New** - Full visibility progress component |
| `src/components/onboarding/EmailConnectionStep.tsx` | Replace inline progress with new component |
| `src/components/onboarding/BackgroundImportBanner.tsx` | Keep for use on other steps (simplified view) |

## Component Structure

```
EmailPipelineProgress
├── Header (title + description)
├── StageCard (Stage 1: Import)
│   ├── Status badge
│   ├── Description
│   └── Breakdown (inbox/sent counts)
├── StageCard (Stage 2: Classify)
│   ├── Status badge
│   ├── Description
│   ├── Progress bar with counts
│   └── Time estimate
├── StageCard (Stage 3: Learn)
│   ├── Status badge
│   ├── Description
│   └── Sub-phases when active
├── Overall progress indicator
└── Action buttons (Continue / Retry)
```

## Stage Details

### Stage 1: Import

When importing:
```
STAGE 1: Import Emails                              ⏳ IN PROGRESS
───────────────────────────────────────────────────────────────────
Downloading your email history from Gmail

├─ Inbox: 12,000 / 15,000                          [████████░░░]
└─ Sent:  0 / ~7,000                               [░░░░░░░░░░░]

~20 min remaining
```

When complete:
```
STAGE 1: Import Emails                                      ✅ DONE
───────────────────────────────────────────────────────────────────
Downloaded your email history from Gmail

├─ Inbox: 15,000 emails                                         ✅
└─ Sent:   7,631 emails                                         ✅

Total: 22,631 emails imported
```

### Stage 2: Classify

When pending:
```
STAGE 2: Classify Emails                                  ○ PENDING
───────────────────────────────────────────────────────────────────
AI will sort emails into categories
(quotes, bookings, complaints, etc.)

Waiting for import to complete...
```

When in progress:
```
STAGE 2: Classify Emails                            ⏳ IN PROGRESS
───────────────────────────────────────────────────────────────────
AI is sorting emails into categories
(quotes, bookings, complaints, etc.)

[████████████░░░░░░░░░] 7,000 / 22,631   31%

Processing in batches... ~15 min remaining
```

### Stage 3: Learn Voice

When pending:
```
STAGE 3: Learn Your Voice                                 ○ PENDING
───────────────────────────────────────────────────────────────────
Analyse your sent emails to learn how you respond

Coming next... (takes ~2-3 minutes)
```

When in progress (use existing `LearningProgressDisplay`):
```
STAGE 3: Learn Your Voice                           ⏳ IN PROGRESS
───────────────────────────────────────────────────────────────────
Analysing your sent emails to learn how you respond

├─ Pairing conversations...   ✅
├─ Extracting voice DNA...    ⏳ 50%
└─ Building response patterns ○

~2 min remaining
```

## User Experience Flow

1. **User connects email** - OAuth completes, returns to this screen
2. **Sees all 3 stages** - Immediately understands the full process
3. **Watches progress** - Real-time updates show each stage completing
4. **Can continue anytime** - Button always available, not blocked
5. **Returns later** - Same screen shows where things are at

## Error Handling

If any stage fails, show clearly which stage failed and why:

```
STAGE 2: Classify Emails                                   ❌ ERROR
───────────────────────────────────────────────────────────────────
Classification encountered an issue

Error: Rate limit exceeded - retrying in 30s

[Retry Now]
```

## Expected Outcome

- Users can see exactly what's happening at every moment
- No more confusion about "Importing" vs "Classifying" flickering
- Clear indication of what's done, what's in progress, what's next
- Confidence to continue to next steps knowing import runs in background
- Professional, trustworthy experience that builds confidence in the AI

