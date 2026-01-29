

# AI Learning Report: Build Trust Through Transparency

## The Problem

Right now, after the pipeline completes, users are told "we learned from your emails" but shown zero proof. They must trust blindly that:
- 22,633 emails were classified correctly
- Their voice was captured accurately
- The AI will respond appropriately

This creates anxiety, not confidence. And you've discovered that the voice learning phase isn't actually completing properly, which means even less reason to trust it.

## The Solution: Two-Part Fix

### Part 1: Fix Voice Learning Pipeline

Before we can show proof, we need to ensure the voice learning actually runs and stores data.

Current state:
- `voice_profile_complete: true` (claims complete)
- `pairs_analyzed: 1` (only analysed 1 conversation pair)
- `example_responses` table: **empty**
- `voice_profiles` table: **no record exists**

The voice-learning edge function needs investigation - it's either not being triggered or failing silently.

### Part 2: Create AI Learning Report Step

Add a new onboarding step after the pipeline completes that shows users exactly what was learned, with the ability to correct mistakes.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                    What BizzyBee Learned About You                       │
│                                                                          │
│  Review and adjust before we start responding to emails                  │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ╔════════════════════════════════════════════════════════════════════╗  │
│  ║  EMAIL CLASSIFICATION BREAKDOWN                                    ║  │
│  ╠════════════════════════════════════════════════════════════════════╣  │
│  ║                                                                    ║  │
│  ║  Your inbox contains:                                              ║  │
│  ║                                                                    ║  │
│  ║  ████████████████████░░░░░░  Quote Requests     1,438 (6.4%)      ║  │
│  ║  ██████████████████░░░░░░░░  Booking Requests   1,291 (5.7%)      ║  │
│  ║  ████████████░░░░░░░░░░░░░░  General Inquiries  1,020 (4.5%)      ║  │
│  ║  ████████░░░░░░░░░░░░░░░░░░  Complaints           759 (3.4%)      ║  │
│  ║  ███████████████████████████ Notifications      9,338 (41.3%)     ║  │
│  ║  ██████████████████████░░░░  Follow-ups         5,487 (24.2%)     ║  │
│  ║  ██████████░░░░░░░░░░░░░░░░  Spam               2,713 (12.0%)     ║  │
│  ║                                                                    ║  │
│  ║  [Show sample emails from each category]                           ║  │
│  ╚════════════════════════════════════════════════════════════════════╝  │
│                                                                          │
│  ╔════════════════════════════════════════════════════════════════════╗  │
│  ║  YOUR VOICE DNA                                           [Edit]   ║  │
│  ╠════════════════════════════════════════════════════════════════════╣  │
│  ║                                                                    ║  │
│  ║  Tone:         Friendly, Professional, Helpful                     ║  │
│  ║  Formality:    ████████░░ 8/10 (Business formal)                  ║  │
│  ║  Greeting:     "Hi [Name]," or "Hey there,"                       ║  │
│  ║  Sign-off:     "Thanks, Michael"                                   ║  │
│  ║                                                                    ║  │
│  ║  Your style:                                                       ║  │
│  ║  • Short, direct responses (avg 47 words)                         ║  │
│  ║  • Uses "Thanks" frequently                                        ║  │
│  ║  • Rarely uses emojis                                              ║  │
│  ║  • Prefers bullet points for lists                                 ║  │
│  ║                                                                    ║  │
│  ╚════════════════════════════════════════════════════════════════════╝  │
│                                                                          │
│  ╔════════════════════════════════════════════════════════════════════╗  │
│  ║  RESPONSE PLAYBOOK (3 examples)                           [Edit]   ║  │
│  ╠════════════════════════════════════════════════════════════════════╣  │
│  ║                                                                    ║  │
│  ║  QUOTE REQUEST                                                     ║  │
│  ║  ──────────────────────────────────────────────────────────────    ║  │
│  ║  Customer: "What's your cost to clean windows on a 3 bed semi?"   ║  │
│  ║                                                                    ║  │
│  ║  You typically reply:                                              ║  │
│  ║  "Hi [Name], thanks for getting in touch! For a 3 bed semi,       ║  │
│  ║   windows are usually around £XX. Could you let me know your      ║  │
│  ║   postcode so I can give you an exact quote? Thanks, Michael"     ║  │
│  ║                                                                    ║  │
│  ║  ────────────────────────────────────────────────────────────────  ║  │
│  ║                                                                    ║  │
│  ║  COMPLAINT                                                         ║  │
│  ║  ──────────────────────────────────────────────────────────────    ║  │
│  ║  Customer: "You missed some windows on the back of the house"     ║  │
│  ║                                                                    ║  │
│  ║  You typically reply:                                              ║  │
│  ║  "Hi [Name], I'm really sorry to hear that. Could you let me      ║  │
│  ║   know exactly which windows were missed? I'll get someone out    ║  │
│  ║   to sort it ASAP. Thanks, Michael"                               ║  │
│  ║                                                                    ║  │
│  ╚════════════════════════════════════════════════════════════════════╝  │
│                                                                          │
│  ╔════════════════════════════════════════════════════════════════════╗  │
│  ║  CONFIDENCE ASSESSMENT                                             ║  │
│  ╠════════════════════════════════════════════════════════════════════╣  │
│  ║                                                                    ║  │
│  ║  ✅ Strong confidence:                                             ║  │
│  ║     • Quote requests - 127 examples found                          ║  │
│  ║     • Booking confirmations - 89 examples found                    ║  │
│  ║                                                                    ║  │
│  ║  ⚠️ Lower confidence (will ask for review):                        ║  │
│  ║     • Complaints - only 12 examples found                          ║  │
│  ║     • Refund requests - 3 examples found                           ║  │
│  ║                                                                    ║  │
│  ╚════════════════════════════════════════════════════════════════════╝  │
│                                                                          │
│  [Download Report as PDF]                [Looks Good - Continue →]      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/components/onboarding/AILearningReport.tsx` | **Create** | New comprehensive report component |
| `src/components/onboarding/ClassificationBreakdown.tsx` | **Create** | Shows category distribution with samples |
| `src/components/onboarding/VoiceDNASummary.tsx` | **Create** | Shows extracted voice characteristics |
| `src/components/onboarding/ResponsePlaybook.tsx` | **Create** | Shows example conversation pairs |
| `src/components/onboarding/ConfidenceAssessment.tsx` | **Create** | Shows what AI is confident about |
| `src/components/onboarding/OnboardingWizard.tsx` | **Modify** | Add new step after email import completes |
| `supabase/functions/voice-learning/index.ts` | **Debug** | Fix why it's not completing properly |

### Data Sources

| Section | Table | Query |
|---------|-------|-------|
| Classification Breakdown | `email_import_queue` | `GROUP BY category` with sample emails |
| Voice DNA | `voice_profiles` | Voice characteristics and style |
| Response Playbook | `example_responses` | RAG examples with embeddings |
| Confidence Assessment | `example_responses` | `GROUP BY category` count |

### PDF Generation (Optional Enhancement)

For the downloadable PDF, we could:
1. Use a client-side library like `react-pdf` to generate
2. Or create an edge function that uses a service like Puppeteer/Chromium to render the report

The in-app version should come first - the PDF is a "nice to have" for users who want to share with their team or keep records.

---

## Immediate Priority: Fix Voice Learning

Before building the report UI, we need to fix the voice learning pipeline. The current state shows:

```
pairs_analyzed: 1
voice_profile_complete: true (lie!)
example_responses: 0 records
voice_profiles: no record
```

This needs debugging - the function is either:
1. Not being triggered after classification completes
2. Failing silently without proper error logging
3. Completing too early due to a logic bug

I would recommend investigating the `voice-learning` edge function to understand why it's not processing the 7,631 sent emails to extract response patterns.

---

## Expected Outcome

After implementation:

1. **Users see proof** - Every classification, every voice trait, every response pattern is visible
2. **Users can correct** - If something looks wrong, they can fix it before going live
3. **Users build trust** - "I can see exactly what the AI learned from MY emails"
4. **Reduced churn** - Confidence leads to continued usage
5. **Premium positioning** - This level of transparency is rare in AI products

The goal is that when a user finishes this step, they think:

> "Wow, it actually understood how I communicate. This isn't some generic AI - it learned from MY emails."

That's the moment they become a paying customer for life.

