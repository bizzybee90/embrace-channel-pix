
# UI Polish — 4-Area Fix Plan

## What Will Change

Five distinct areas of the UI will be cleaned up. All changes are purely visual/UX — no backend, no database, no edge functions.

---

## Fix 1 — Sidebar: Expanded by default + mini-label collapsed mode

**File:** `src/components/sidebar/Sidebar.tsx`

**Current problems:**
- `useState(true)` starts the sidebar collapsed — users see an icon-only bar on first load
- Collapsed mode shows bare icons with no label — disorienting
- Collapsed width is `w-[72px]` — too narrow for mini-labels
- Collapsed secondary items (Sent, Settings) have no mini-labels

**Changes:**

1. `useState(true)` → `useState(false)` so sidebar opens expanded by default

2. Collapsed width: `w-[72px]` → `w-[80px]`

3. For every primary nav item in collapsed mode, replace `justify-center p-2` with a column layout:
```tsx
<div className="relative flex flex-col items-center gap-0.5 py-2">
  <IconComponent className="h-5 w-5 text-color" />
  <span className="text-[9px] text-muted-foreground leading-none">Label</span>
</div>
```
Short labels: **Home**, **Inbox**, **Unread**, **Drafts**, **Train**, **Snooze**, **Done**

4. Badge overlay for Inbox (toReply), Unread (unread), Drafts (drafts) counts — positioned absolute, top-right of icon:
```tsx
{count > 0 && (
  <span className="absolute -top-1 -right-1 bg-destructive text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
    {count > 99 ? '99+' : count}
  </span>
)}
```

5. Collapsed secondary section (Sent, Settings): same column layout with mini-labels **Sent** (text-blue-500 icon) and **Settings**. Remove the tooltip-only pattern for these.

---

## Fix 2 — Remove dead buttons from InsightsWidget

**File:** `src/components/dashboard/InsightsWidget.tsx`

**Current problems:**
- Header has a `RefreshCw` button that calls `runAnalysis()` — which just shows a toast "Pattern detection has been migrated to n8n workflows" — a dead button
- Empty state has a "Run Analysis" button with the same dead behaviour

**Changes:**
1. Remove the `<Button>` (RefreshCw icon) from the `CardHeader`
2. Remove `analyzing` state and `runAnalysis` function entirely
3. Replace the empty state content with:
   - Keep the `Lightbulb` icon
   - Text: "Insights will appear as BizzyBee processes your emails"
   - No button

---

## Fix 3 — Remove dead Reply/Forward buttons from QuickActionsBar

**File:** `src/components/inbox/QuickActionsBar.tsx`

**Current problems:**
- Reply button → `toast.info('Reply coming soon')`
- Forward button → `toast.info('Forward coming soon')`

**Changes:**
1. Remove the Reply `<Button>` entirely
2. Remove the Forward `<Button>` entirely
3. Remove the `<div className="w-px h-5 bg-border" />` divider between them and the working buttons (since there's nothing left before the divider)
4. Keep: Handled, Category dropdown, Spam

---

## Fix 4 — Fix conversation thread layout (AI panels vs messages)

**File:** `src/components/conversations/ConversationThread.tsx`

**Current problem:**
The `AIContextPanel` and `MessageTimeline` share a single `flex-1 overflow-y-auto` scroll container. On smaller screens, the AI panels (Why, Summary, Draft, Customer Profile — all expanded by default) consume most of the viewport, pushing `MessageTimeline` below the fold. The user has to scroll past all AI cards just to see their messages.

**Change:** Split the single scroll area into two independently scrollable sections:

```tsx
{/* AI Context — capped height, independently scrollable */}
<div className="flex-shrink-0 max-h-[45vh] overflow-y-auto p-5 border-b border-border">
  <AIContextPanel conversation={conversation} onUpdate={onUpdate} onUseDraft={setDraftText} />
</div>

{/* Message Timeline — always gets remaining space */}
<div className="flex-1 min-h-[200px] overflow-y-auto p-5">
  <MessageTimeline messages={messages} workspaceId={conversation.workspace_id} onDraftTextChange={setDraftText} />
</div>
```

This ensures:
- AI panels scroll independently and never exceed 45% of the viewport
- Messages always have at least `200px` and fill all remaining space
- Both sections are independently scrollable — no double-scroll confusion

---

## Fix 5 — Remove demo credentials from Auth page

**File:** `src/pages/Auth.tsx`

**Current problem:**
The `useState("")` for email and password are already empty (lines 16–17), which is correct. However the "Quick Demo Login" button is visible on the login page — this hardcodes `demo@agent.local` / `demo123456` which is unprofessional for real users.

**Change:** Remove the entire "Quick Demo Login" section from the UI (the `<div className="mt-4">` block containing the divider and the demo button, lines 382–408). The `handleDemoLogin` function can remain in code (it won't be called) but the UI button will be gone. The normal sign-in form and the "Don't have an account? Sign up" toggle remain untouched.

---

## Files to be Modified

| File | Change |
|---|---|
| `src/components/sidebar/Sidebar.tsx` | Default expanded, mini-labels, badge overlays, wider collapsed width |
| `src/components/dashboard/InsightsWidget.tsx` | Remove dead Run Analysis button, clean empty state |
| `src/components/inbox/QuickActionsBar.tsx` | Remove Reply and Forward dead buttons |
| `src/components/conversations/ConversationThread.tsx` | Split scroll area so messages always visible |
| `src/pages/Auth.tsx` | Remove Quick Demo Login button from UI |
