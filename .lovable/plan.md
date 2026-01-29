
# Full-Visibility Pipeline UI + Bug Fixes

## Two Parts to This Work

### Part 1: Fix the Flickering Bug in Email Pipeline

The flickering between "importing" and "done" states is caused by two issues:

1. **Database Inconsistency**: The `email_import_progress.current_phase` is stuck on `importing` even though classification is actively running (batch 24 of 24). The edge function updates it to `classifying`, but something else is overwriting it.

2. **Row Limit Bug**: The `EmailPipelineProgress.tsx` fetches all emails from `email_import_queue` to calculate counts, but with 22,632 emails, it hits Supabase's 1000-row default limit. This causes:
   - `inboxCount` to show ~1,000 instead of 15,000
   - `sentCount` to show ~0 (because the 1000 limit is hit before reaching sent emails)
   - The UI flickers between the limited counts and the proper `email_import_progress.emails_received` value

**Fix:**
```typescript
// Instead of fetching all rows:
const { data: queueItems } = await supabase
  .from('email_import_queue')
  .select('direction, category')
  .eq('workspace_id', workspaceId);

// Use COUNT queries with filters:
const [inboxResult, sentResult, classifiedResult] = await Promise.all([
  supabase.from('email_import_queue').select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId).eq('direction', 'inbound'),
  supabase.from('email_import_queue').select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId).eq('direction', 'outbound'),
  supabase.from('email_import_queue').select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId).not('category', 'is', null),
]);
```

---

### Part 2: Create Unified Pipeline Progress Components

Replicate the stunning email pipeline UI pattern for both the website scraping and competitor research steps.

#### New Component: `WebsitePipelineProgress.tsx`

Shows the 3-stage website scraping pipeline:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                    Your Website Knowledge                                │
│                                                                          │
│  We're extracting FAQs, pricing, and services from your website         │
│  to give BizzyBee accurate answers about your business.                 │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  STAGE 1: Discover Pages                                   ✅ DONE │  │
│  │  Found pages on your website                                       │  │
│  │  └─ 12 pages discovered                                           │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  STAGE 2: Scrape Content                         ⏳ IN PROGRESS    │  │
│  │  Reading and downloading page content                              │  │
│  │  [████████████░░░░░░░░░] 8 / 12 pages   67%                       │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  STAGE 3: Extract Knowledge                            ○ PENDING   │  │
│  │  AI extracts FAQs, pricing, and business facts                     │  │
│  │  Coming next... (~30 seconds)                                      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ○────────────●────────────○                                            │
│  Discover   Scrape      Extract    Done!                                │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Data source:** `website_scrape_jobs` table with realtime subscription

**Stages:**
| Stage | Status Field Values | Description |
|-------|---------------------|-------------|
| Discover | `pending`, `mapping` | Finding pages on website |
| Scrape | `scraping` | Downloading page content |
| Extract | `extracting` | AI extraction of FAQs |
| Complete | `completed` | All done |

#### New Component: `CompetitorPipelineProgress.tsx`

Shows the 5-stage competitor research pipeline:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                    Competitor Research                                   │
│                                                                          │
│  Learning from your competitors to build a comprehensive                 │
│  knowledge base for your industry.                                       │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  STAGE 1: Discover Competitors                              ✅ DONE │  │
│  │  Finding businesses in your area                                   │  │
│  │  └─ 87 competitors found                                          │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  STAGE 2: Validate Websites                                 ✅ DONE │  │
│  │  Checking which businesses have useful websites                    │  │
│  │  └─ 52 valid websites confirmed                                   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  STAGE 3: Scrape Websites                        ⏳ IN PROGRESS    │  │
│  │  Reading FAQ and service pages                                     │  │
│  │  [████████░░░░░░░░░░░░] 18 / 52 sites   35%                       │  │
│  │  Currently: cleaningservicesluton.co.uk                           │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  STAGE 4: Extract & Dedupe FAQs                        ○ PENDING   │  │
│  │  AI extracts and removes duplicate FAQs                            │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  STAGE 5: Refine for Your Business                     ○ PENDING   │  │
│  │  Adapts competitor FAQs to match your services                     │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Data source:** `competitor_research_jobs` table with polling (already set up)

**Stages:**
| Stage | Status Field Values | Description |
|-------|---------------------|-------------|
| Discover | `queued`, `discovering` | Finding local competitors |
| Validate | `validating` | Checking website validity |
| Scrape | `scraping` | Downloading competitor pages |
| Extract | `extracting`, `deduplicating` | AI extraction + dedup |
| Refine | `refining`, `embedding` | Personalise for your business |
| Complete | `completed` | All done |

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/components/onboarding/EmailPipelineProgress.tsx` | **Modify** | Fix 1000-row limit bug by using COUNT queries |
| `src/components/onboarding/WebsitePipelineProgress.tsx` | **Create** | New full-visibility component for website scraping |
| `src/components/onboarding/CompetitorPipelineProgress.tsx` | **Create** | New full-visibility component for competitor research |
| `src/components/onboarding/KnowledgeBaseStep.tsx` | **Modify** | Use new WebsitePipelineProgress when job is running |
| `src/components/onboarding/CompetitorResearchStep.tsx` | **Modify** | Use new CompetitorPipelineProgress when job is running |

---

## Shared StageCard Component

Both new components will reuse the existing `StageCard` pattern from `EmailPipelineProgress.tsx`. This keeps the UI consistent across all pipeline views:

- Same visual styling (border colours, icons, badges)
- Same status indicators (Pending, In Progress, Done, Error)
- Same progress bar styling
- Same action buttons layout

---

## User Experience After Implementation

1. **Email Step**: User sees all 3 stages (Import → Classify → Learn) with real counts that don't flicker
2. **Website Step**: After entering URL, shows all 3 stages (Discover → Scrape → Extract) with live progress
3. **Competitor Step**: After starting research, shows all 5 stages with current site being scraped

All three pipelines share the same visual language, making the onboarding feel cohesive and professional. Users always know exactly what's happening, what's coming next, and can continue at any time.
