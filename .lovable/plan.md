

# Superhuman-Style Email Client for BizzyBee

## Problem Summary

1. **"To Reply" shows 67 instead of ~89**: The filter only includes `act_now` (18) + `quick_win` (49) = 67. But there are 59 more conversations in the `wait` bucket that have `requires_reply = true` (follow-ups, inquiries, personal emails). These are real emails needing attention but are hidden.

2. **No proper email client experience**: The current UI is a task-queue, not an inbox. There's no way to browse all emails, see sent mail, or work through messages the way you would in Gmail or Superhuman.

---

## What Will Change

### Fix 1: Correct the "To Reply" Count
Include all conversations where `requires_reply = true` (regardless of decision bucket) in the "To Reply" count and inbox view. This should bring it to ~126, which is closer to reality. The `wait` bucket emails with `requires_reply = true` are genuinely actionable.

### Fix 2: Build a Superhuman-Inspired Inbox

The current "JaceStyleInbox" will be upgraded into a proper email client layout:

**Sidebar Categories** (already partially exists, will be enhanced):
- **Inbox** -- all inbound, unresolved conversations (replaces "To Reply")
- **Unread** -- conversations not yet opened/viewed
- **Drafts** -- conversations with AI-generated draft responses ready to review
- **Sent** -- outbound threads (already exists as a route)
- **Done/Archive** -- resolved/auto-handled (already exists)
- AI Category filters: Quote Requests, Bookings, Complaints, Inquiries, Follow-ups, Personal

**Message List (center panel)**:
- Dense, scannable rows: Sender, Subject, Snippet, Time
- Category badge with color coding per classification
- Confidence score indicator (small percentage or colored dot)
- Hover quick-actions: Archive, Snooze, Mark Read
- Keyboard shortcuts: `j`/`k` navigation, `e` archive, `r` reply

**Detail View (right panel)** -- already exists via `ConversationThread`, will get:
- "Draft with AI" button in the reply area (hook into existing `ai-draft` edge function)
- Confidence score display in the header

**Search** -- already exists, will be enhanced to command-bar style (Cmd+K)

---

## Technical Details

### Files to Modify

1. **`src/pages/Home.tsx`** -- Fix the "To Reply" query to include `wait` bucket where `requires_reply = true`
2. **`src/components/sidebar/Sidebar.tsx`** -- Add "Inbox", "Unread", "Drafts" nav items; add AI category section with counts
3. **`src/components/conversations/JaceStyleInbox.tsx`** -- Major upgrade:
   - Add `all-inbox`, `unread`, `sent` filter modes
   - Add hover quick-actions (archive, snooze, mark read)
   - Add keyboard navigation (`j`/`k`/`e`/`r`)
   - Show confidence score indicator next to category badge
   - Add category filter chips at the top
4. **`src/App.tsx`** -- Add routes for `/inbox`, `/unread`, `/drafts`
5. **`src/pages/EscalationHub.tsx`** -- Add new filter types
6. **`src/components/conversations/ConversationHeader.tsx`** -- Show confidence score badge

### New Files

7. **`src/hooks/useKeyboardNavigation.tsx`** -- Hook for `j`/`k`/`e`/`r` keyboard shortcuts in inbox
8. **`src/components/conversations/InboxQuickActions.tsx`** -- Hover overlay with Archive, Snooze, Mark Read buttons

### Database

No schema changes needed -- all required fields (`email_classification`, `ai_confidence`, `requires_reply`, `decision_bucket`) already exist on the `conversations` table.

### Query Logic Changes

Current "To Reply":
```
decision_bucket IN ('act_now', 'quick_win') AND status IN ('new', 'open', ...)
```

New "Inbox" (all actionable):
```
requires_reply = true AND status IN ('new', 'open', 'waiting_internal', 'ai_handling', 'escalated')
```

New "Unread" (subset):
```
requires_reply = true AND status = 'new'
```

---

## Implementation Order

1. Fix "To Reply" count across Home, Sidebar, and JaceStyleInbox (quick win)
2. Add sidebar navigation items (Inbox, Unread, Drafts, category filters)
3. Upgrade inbox list with hover actions, confidence scores, category badges
4. Add keyboard navigation
5. Style polish -- Superhuman-inspired clean aesthetic with Inter font, Slate palette

