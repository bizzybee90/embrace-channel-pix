# Tablet Layout Testing Guide

## Overview
This document describes the expected tablet layout behavior across different breakpoints and states.

**Tablet Range:** 760px - 1199px width

---

## Breakpoint Matrix

| Breakpoint | Sidebar (Collapsed) | Sidebar (Expanded) | Main Content Area | Notes |
|------------|--------------------|--------------------|-------------------|-------|
| 760px      | 72px               | 240px              | ~688px / ~520px   | Minimum tablet width |
| 1024px     | 72px               | 240px              | ~952px / ~784px   | Common tablet size |
| 1199px     | 72px               | 240px              | ~1127px / ~959px  | Maximum tablet width |

**Important:** Main content must always fill remaining width. No third column on tablet.

---

## Layout States

### State 1: List View (`selectedConversation === null`)

**Layout:**
```
┌──────┬────────────────────────────────────┐
│      │                                    │
│ Side │    Ticket List + Filters           │
│ bar  │    - Full width                    │
│      │    - Cards stack vertically        │
│ 72px │    - Pull-to-refresh enabled       │
│      │                                    │
└──────┴────────────────────────────────────┘
```

**Expected Behavior:**
- Sidebar collapsed by default (72px icons only)
- Ticket list fills entire remaining width
- Pull-to-refresh works at top of list
- Skeleton cards shown while loading (5-6 cards)
- Filters accessible via button
- Smooth animation when selecting a ticket

**Test Cases:**
1. Load page → Should show skeleton cards initially
2. Pull down → Should trigger refresh
3. Click ticket → Should slide to conversation view
4. Expand sidebar → Main content adjusts width smoothly

---

### State 2: Conversation View (`selectedConversation !== null`)

**Layout:**
```
┌──────┬────────────────────────────────────┐
│      │  ┌─ Header (Sticky) ─────────────┐ │
│      │  │ Back | Title | Tabs           │ │
│ Side │  └────────────────────────────────┘ │
│ bar  │                                    │
│      │  Conversation Workspace            │
│ 72px │  - AI Context                      │
│      │  - Summary                         │
│      │  - Messages                        │
│      │  - Reply Area                      │
│      │                                    │
│      │  [FAB] ← Back to List (if scrolled)│
└──────┴────────────────────────────────────┘

         Drawer (slides from right)
         ┌─────────────────────┐
         │ Customer Info       │
         │ or                  │
         │ Quick Actions       │
         │                     │
         │ (58% of viewport)   │
         └─────────────────────┘
```

**Expected Behavior:**
- Header sticky at top while scrolling
- "Back to tickets" button in header
- Customer Info / Quick Actions open as slide-over drawers (58% width)
- FAB appears after scrolling down 200px
- Skeleton shown while loading conversation
- Smooth drawer slide-in/out animations

**Test Cases:**
1. Click "Back to tickets" → Should slide to list view
2. Scroll down 200px → FAB should fade in
3. Click FAB → Should scroll to top + navigate to list
4. Open Customer Info → Drawer slides from right (58% width)
5. Open Quick Actions → Previous drawer closes, new one opens
6. Close drawer → Slides out smoothly

---

## Sidebar Behavior

**Collapsed (Default):**
- Width: 72px
- Shows icons only
- Tooltips on hover

**Expanded:**
- Width: 240px
- Shows icons + labels
- Main content adjusts width dynamically
- No overlap with main content

**Test Cases:**
1. Click sidebar expand button → Smoothly expands to 240px
2. Main content → Should reduce width accordingly
3. Click collapse → Returns to 72px
4. Content → Should expand back to full width

---

## Pull-to-Refresh (List View Only)

**Behavior:**
- Only active in State 1 (List View)
- Only works on touch devices
- Shows custom indicator matching app theme
- Triggers data refresh

**Test Cases:**
1. Pull down on ticket list → Shows "Pull to refresh" indicator
2. Release → Shows spinner + "Refreshing..." text
3. Complete → Indicator fades, list updates
4. Desktop (mouse) → Should not activate

---

## Floating Action Button (FAB)

**Behavior:**
- Only visible in State 2 (Conversation View)
- Appears after scrolling down 200px
- Position: bottom-left (8 units from edges)
- Click → Scrolls to top + navigates to list

**Visual:**
- 56px circular button
- Translucent background with backdrop blur
- ChevronLeft icon
- Scale up on hover
- Fade in/out animation

**Test Cases:**
1. Load conversation → FAB hidden
2. Scroll down 200px → FAB fades in
3. Scroll back to top → FAB fades out
4. Click FAB → Scrolls smoothly then navigates
5. Hover → Slight scale increase

---

## Skeleton Loading States

**Ticket List Skeletons:**
- 5-6 skeleton cards matching real card dimensions
- Priority bar, title lines, badges, timestamp
- Shimmer animation

**Conversation Thread Skeleton:**
- AI Context card placeholder (150px height)
- Summary card placeholder (100px height)
- 3-4 message bubble placeholders (alternating sides)
- Pulsing animation (1.5s cycle)

**Test Cases:**
1. Initial load → Skeletons appear immediately
2. Data loads → Smooth transition to real content
3. Switch conversations → Brief skeleton while loading
4. No layout shift between skeleton and real content

---

## Drawer Behavior

**Customer Info Drawer:**
- Slides from right
- Width: 58% of viewport
- Contains customer details, history, tags
- Backdrop darkens main content

**Quick Actions Drawer:**
- Slides from right
- Width: 58% of viewport  
- Contains resolve, assign, priority, snooze actions
- Backdrop darkens main content

**Test Cases:**
1. Open drawer → Slides in from right smoothly
2. Drawer width → Should be 58% of viewport
3. Click backdrop → Closes drawer
4. Open different drawer → First closes, second opens
5. Main content → Darkens with backdrop overlay

---

## Animation Checklist

All animations should run at **60fps** with no jank:

- ✅ List ↔ Conversation state transition (slide)
- ✅ Drawer slide-in/out
- ✅ FAB fade-in/out
- ✅ Sidebar expand/collapse
- ✅ Skeleton shimmer/pulse
- ✅ Card hover effects
- ✅ Pull-to-refresh indicator

---

## Responsive Behavior

**At 759px (Mobile):**
- Should switch to mobile layout
- No tablet layout components visible

**At 760px (Tablet Min):**
- Switches to tablet layout
- Sidebar appears (72px)
- Two-state layout active

**At 1199px (Tablet Max):**
- Still uses tablet layout
- Full features active

**At 1200px (Desktop):**
- Switches to desktop layout (three columns)
- Tablet-specific components hidden

---

## Testing Devices

**Recommended Test Sizes:**
- 768px × 1024px (iPad portrait)
- 834px × 1112px (iPad Air portrait)
- 1024px × 768px (iPad landscape)
- 1024px × 1366px (iPad Pro portrait)
- 1180px × 820px (near max tablet width)

**Browser DevTools:**
1. Open Chrome DevTools
2. Toggle device toolbar (Cmd+Shift+M)
3. Set custom dimensions
4. Test all states and interactions

---

## Performance Targets

- **State transition:** < 300ms
- **Drawer animation:** < 250ms
- **FAB fade:** < 200ms
- **Skeleton to content:** No layout shift
- **Scroll performance:** Smooth 60fps
- **Pull-to-refresh:** Instant response

---

## Common Issues to Watch For

1. **Layout overflow** - Sidebar + content exceeds viewport
2. **Animation jank** - Choppy transitions
3. **Layout shift** - Content jumps when loading
4. **Drawer overlap** - Drawer doesn't properly cover content
5. **FAB positioning** - FAB blocked by other elements
6. **Pull-to-refresh on desktop** - Should only work on touch
7. **State management bugs** - Wrong state after navigation

---

## Debug Tools

Use the `useTabletLayoutValidator` hook (dev mode only) to catch layout overflow issues. Check console for warnings like:

```
⚠️ Tablet layout overflow detected!
{
  viewport: 1024,
  sidebar: 72,
  content: 980,
  total: 1052,
  overflow: 28
}
```
