

# Match Inbox List Items to Review Page Layout

## What Changes

The left message list pane across all inbox routes (`/to-reply`, `/drafts`, `/all-open`, `/done`, `/snoozed`, `/sent`, `/unread`) will be restyled to match the compact, clean layout used on the Review (AI Reconciliation) page.

## Current vs Target

**Current (JaceStyleInbox):** Heavy card-style rows with large padding (`mx-3 my-2 p-4`), rounded borders, 4-row vertical stack (sender, subject, summary, category pill), and prominent hover/active card effects.

**Target (Review page style):** Compact rows with a coloured avatar circle, sender name inline with metadata, subject line below indented under the avatar, minimal spacing (`px-3 py-2.5`), and a subtle active state using `shadow + ring-1 ring-slate-900/5` instead of heavy purple borders.

## Specific Changes

### 1. Restyle `ConversationRow` in `JaceStyleInbox.tsx`

- Replace the heavy card container (`mx-3 my-2 p-4 rounded-xl border ...`) with the Review page's compact row style: `px-3 py-2.5 cursor-pointer border-b border-slate-100 transition-all hover:bg-slate-50`
- Add a **coloured avatar circle** (letter initial) matching the Review page: `h-7 w-7 rounded-full bg-primary/10` with the sender's first letter
- **Active state**: `bg-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] ring-1 ring-slate-900/5` (matching Review page exactly)
- **Layout**: Two-line format -- Row 1: avatar + sender name + time; Row 2: subject + status badge (indented under avatar with `pl-9`)
- Remove the separate Row 3 (AI summary) and Row 4 (category pill) to match the Review page's compact two-line format. The category label and status badge move inline with the subject line.

### 2. Update Date Section Headers

- Match the Review page's section header style: `px-3 py-1.5 bg-purple-50/80 border-b border-slate-100` with `text-[10px] font-bold uppercase tracking-wider text-purple-700`

### 3. Files Modified

- `src/components/conversations/JaceStyleInbox.tsx` -- the only file that needs changes (ConversationRow component and DateSection component)

No data fetching, filtering, or business logic will be touched.

## Technical Details

The `ConversationRow` component (around line 278) will be restructured from a 4-row vertical stack to a 2-row layout matching this pattern from the Review page:

```text
[Avatar] Sender Name                    10:30 AM
         Subject line here...    [Category] [Badge]
```

Active row styling changes from:
```
bg-purple-50/50 border border-purple-200 ring-1 ring-purple-100 shadow-sm
```
To:
```
bg-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] ring-1 ring-slate-900/5
```

