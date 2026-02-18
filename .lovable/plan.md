
# BizzyBee — World-Class UI Transformation Plan

## Overview

This is a large but well-scoped frontend-only overhaul across 8 files. No edge functions, no database changes. Every change is contained to React components and pages.

---

## Current State Assessment

After reading all files, here is what already exists vs. what needs changing:

**Already done from previous polish pass:**
- Sidebar: `useState(false)` (expanded by default) ✅
- Sidebar: mini-labels in collapsed state ✅
- Sidebar: badge counts on Inbox/Unread/Drafts in collapsed ✅
- ConversationThread: split scroll (AIContextPanel 45vh + MessageTimeline min-h-200px) ✅
- InsightsWidget: dead "Run Analysis" button already removed, clean empty state ✅
- QuickActionsBar: Reply/Forward buttons already removed ✅
- Auth: demo credentials already NOT visible in the rendered UI (fields start empty, `handleDemoLogin` is in code but not rendered)

**What still needs to be done (net-new changes):**

1. **Sidebar active state** — no `bg-primary/8 rounded-xl` active highlight; collapsed width is still `w-[80px]` (instruction says `w-[76px]` — small diff, keep 80px since mini-labels need room)
2. **ConversationCard full redesign** — still shows the old multi-badge layout (~140px tall). This is the biggest change.
3. **Dashboard stat cards** — remove the bottom description text from each card
4. **Dashboard bottom grid** — change to `md:grid-cols-2 lg:grid-cols-3`
5. **Dashboard loading** — replace spinner with skeleton cards
6. **Dashboard padding** — `p-6` → `p-4 md:p-6`
7. **KnowledgeBase mobile** — wrap in `MobilePageLayout` for mobile users
8. **Settings desktop** — wrap in `ThreeColumnLayout` with Sidebar for consistency
9. **ConversationView** — add `ThreeColumnLayout` wrapper on desktop, `MobilePageLayout` on mobile
10. **CustomerIntelligence** — subtle "Analyze Customer" button, better empty state text
11. **Time format** — short-form timestamps ("2m", "1h", "3d") in ConversationCard
12. **JaceStyleInbox empty state** — add keyboard hint text

---

## Detailed Changes Per File

### File 1: `src/components/conversations/ConversationCard.tsx`

**This is the biggest change.** Current card height ~140px → target ~60-70px.

**Remove entirely:**
- Top color accent bar (`h-1.5` div with bucket color)
- Decision bucket badge row (`bucketBadge` Badge component in both layouts)
- `CategoryLabel` component
- Secondary badge row (channel, draft, assigned, satisfaction, confidence, correction badges)
- Meta row (category text, Reopen button in footer)
- `getBucketBarColor`, `getPriorityBarColor` helper functions (unused after removal)

**Add:**
- `getStatusDotColor(bucket, status)` helper returning a Tailwind color class
- Short timestamp formatter: e.g. "2m", "1h", "3d" using `formatDistanceToNow` output parsed, or using `differenceInMinutes/Hours/Days`
- `senderName` derived from `conversation.customer?.name || conversation.customer?.email || conversation.title`

**New 3-row layout (both Desktop and Tablet):**

```
Row 1: [status dot]  [Sender Name]  [overdue dot if applicable]  [2m]
Row 2: [Subject / Title — single line truncate]
Row 3: [AI snippet — single line truncate]  [draft icon]  [channel icon if non-email]
```

**Desktop padding:** `p-6` → `p-4`
**Desktop margin:** `mb-3` → `mb-2`
**Tablet padding:** `p-5` → `p-3.5`
**Tablet margin:** `mb-3` → `mb-2`

**Keep:**
- `rounded-[22px]` card shape
- `apple-shadow hover:apple-shadow-lg spring-press` classes
- `selected` state gradient
- All swipe gesture code (touchStart/Move/End handlers, swipe backgrounds)
- `showTriageActions` / `TriageQuickActions`
- All Supabase mutation handlers (`handleAssignToMe`, `handleResolve`, `handleReopen`)
- Memo comparison function

**Note on `conversation.customer`:** The `Conversation` type has `customer_id` but `customer` is a joined field. Looking at `JaceStyleInbox`, conversations are fetched with `select('*, customer:customers(*)')` — so `conversation.customer` is available. The card already has `conversation.customer_id` and the existing code doesn't use `conversation.customer` directly. For the sender name, we'll fall back gracefully: `conversation.customer?.name || conversation.customer?.email || conversation.title || 'Unknown'`.

**Reopen button:** Moved from meta row to Row 1 area (ghost icon, visible only when resolved/auto_handled, `stopPropagation` preserved).

### File 2: `src/pages/Home.tsx`

**4 targeted changes:**

1. **Outer padding:** `p-6 space-y-6` → `p-4 md:p-6 space-y-6`

2. **Stat card descriptions removed** — in each of the 4 cards, remove the `<p className="text-xs text-muted-foreground mt-3">` line (the "No SLA issues right now" / "Handle these first" etc. text). Keep the number, label, icon, and conditional badge pill.

3. **Bottom grid:** `grid grid-cols-1 lg:grid-cols-3` → `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3`

4. **Loading skeleton:** Replace the spinner div with skeleton cards:
```tsx
{loading ? (
  <div className="space-y-4">
    <div className="flex items-center gap-4">
      <Skeleton className="h-20 w-20 rounded-2xl" />
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-24 rounded-2xl" />
    </div>
  </div>
) : ( ...existing content... )}
```
Import `Skeleton` from `@/components/ui/skeleton`.

### File 3: `src/pages/KnowledgeBase.tsx`

**Problem:** Mobile users see no navigation — the sidebar is `hidden md:flex` with no mobile fallback.

**Fix:** Add `useIsMobile` hook. When mobile, wrap in `MobilePageLayout`. The existing desktop layout (`flex h-screen bg-background` with sidebar) stays unchanged.

```tsx
import { useIsMobile } from '@/hooks/use-mobile';
// ...
const isMobile = useIsMobile();
// ...
if (isMobile) {
  return (
    <MobilePageLayout>
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-4 space-y-6">
          {/* existing inner content, without the sidebar wrapper */}
        </div>
      </div>
    </MobilePageLayout>
  );
}
// desktop return stays same
```

Also change the header `flex items-center justify-between` → `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3` so the title + Add FAQ button stack on small screens.

### File 4: `src/pages/Settings.tsx`

**Problem:** On desktop, Settings renders without any sidebar — it's just raw content. Every other main page has a sidebar.

**Fix:** Wrap the desktop return in `ThreeColumnLayout`:

```tsx
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
// ...
if (isMobile) {
  return <MobilePageLayout>{content}</MobilePageLayout>;
}
return (
  <ThreeColumnLayout
    sidebar={<Sidebar />}
    main={<ScrollArea className="h-screen">{content}</ScrollArea>}
  />
);
```

`content` is the existing `<div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">` block.

### File 5: `src/pages/ConversationView.tsx`

**Problem:** No navigation wrapper at all — no sidebar, no mobile header.

**Fix:** Add `ThreeColumnLayout` on desktop, `MobilePageLayout` on mobile. The `ConversationThread` itself handles the full height layout internally.

```tsx
import { useIsMobile } from '@/hooks/use-mobile';
import { ThreeColumnLayout } from '@/components/layout/ThreeColumnLayout';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { Sidebar } from '@/components/sidebar/Sidebar';
// ...
if (isMobile) {
  return (
    <MobilePageLayout showBackButton onBackClick={() => navigate(-1)} backToText="Back">
      <div className="flex-1 flex flex-col overflow-hidden">
        <ConversationThread conversation={conversation} onUpdate={() => {}} onBack={() => navigate(-1)} />
      </div>
    </MobilePageLayout>
  );
}
return (
  <ThreeColumnLayout
    sidebar={<Sidebar />}
    main={
      <div className="flex flex-col h-screen overflow-hidden">
        <ConversationThread conversation={conversation} onUpdate={() => {}} onBack={() => navigate(-1)} />
      </div>
    }
  />
);
```

### File 6: `src/components/customers/CustomerIntelligence.tsx`

**Change the "no data" empty state:**
- Keep the `Brain` icon
- Change text from "No intelligence gathered yet" to "Intelligence builds automatically with each conversation"
- Change the "Analyze Customer" `Button` from `size="sm"` (default solid) to `variant="ghost" size="sm"` — subtle, not primary CTA

### File 7: `src/components/conversations/JaceStyleInbox.tsx`

**Add keyboard hint to the existing empty state:**
After the "You're all caught up!" text, add:
```tsx
<p className="text-xs text-muted-foreground/60 mt-3">⌘K to search • J/K to navigate</p>
```

---

## Implementation Order

1. `ConversationCard.tsx` — largest change, independent of others
2. `Home.tsx` — skeleton + padding + grid fixes
3. `KnowledgeBase.tsx` — mobile wrap
4. `Settings.tsx` — desktop sidebar wrap
5. `ConversationView.tsx` — navigation wrapper
6. `CustomerIntelligence.tsx` — empty state tweak
7. `JaceStyleInbox.tsx` — keyboard hint

---

## Risk Assessment

**Low risk:**
- Home.tsx padding/grid/skeleton — additive changes
- InsightsWidget, CustomerIntelligence, JaceStyleInbox — small text changes
- KnowledgeBase mobile wrap — guarded by `if (isMobile)` branch

**Medium risk:**
- Settings desktop sidebar — need to verify `ThreeColumnLayout` handles the content scroll correctly; wrapping in `ScrollArea` prevents double-scrollbar
- ConversationView navigation wrap — need to ensure `ConversationThread`'s `h-full flex flex-col` still works inside `ThreeColumnLayout`'s `main` slot

**Higher risk:**
- ConversationCard full redesign — this touches both tablet and desktop layouts, removes many elements, and must preserve all swipe/haptic/keyboard behavior. The memo comparison function must also be preserved. The `conversation.customer` field access should gracefully handle null (the `?.` operator covers this).

**Mitigation:** All swipe gesture state variables and handlers are in the upper portion of the component and untouched. The new layout only changes what's inside the return JSX.

---

## Files Changed Summary

| File | Nature of Change |
|---|---|
| `src/components/conversations/ConversationCard.tsx` | Major redesign — 3-row compact layout |
| `src/pages/Home.tsx` | Skeleton loading, padding, grid, stat card trim |
| `src/pages/KnowledgeBase.tsx` | Mobile navigation wrapper |
| `src/pages/Settings.tsx` | Desktop sidebar via ThreeColumnLayout |
| `src/pages/ConversationView.tsx` | Full navigation wrapper (mobile + desktop) |
| `src/components/customers/CustomerIntelligence.tsx` | Empty state text + button style |
| `src/components/conversations/JaceStyleInbox.tsx` | Keyboard hint in empty state |
