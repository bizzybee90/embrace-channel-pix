# Tablet Layout Quality Assurance Checklist

Use this checklist before deploying any changes to ensure the tablet layout remains intact.

---

## 🎯 State Transitions

- [ ] List → Conversation: Smooth slide-in animation (< 300ms)
- [ ] Conversation → List: Smooth slide-out animation (< 300ms)
- [ ] No layout jumps or flickers during transitions
- [ ] State changes are visually clear
- [ ] Haptic feedback triggers correctly on touch devices
- [ ] Back button works in header
- [ ] FAB navigation works correctly

---

## 📱 Sidebar Behavior

- [ ] Collapsed by default (72px width)
- [ ] Icons clearly visible when collapsed
- [ ] Tooltips appear on hover
- [ ] Expands smoothly to 240px when toggled
- [ ] Main content adjusts width dynamically during expand/collapse
- [ ] No overlap between sidebar and main content
- [ ] Navigation items clickable in both states
- [ ] Active route highlighted correctly

---

## 📋 Ticket List (State 1)

- [ ] Cards fill available width properly
- [ ] No text truncation or overflow
- [ ] All badges fully visible
- [ ] Timestamps displayed correctly
- [ ] Priority bars visible on left edge
- [ ] Pull-to-refresh works on touch devices
- [ ] Pull-to-refresh indicator matches app theme
- [ ] Skeleton states show correctly while loading
- [ ] Empty state displays when no tickets
- [ ] Filter button accessible
- [ ] Filter popover opens correctly
- [ ] Selected filters display badges
- [ ] Cards clickable across entire width

---

## 💬 Conversation View (State 2)

### Header
- [ ] Header sticky on scroll
- [ ] Back button visible and functional
- [ ] Ticket title displayed
- [ ] Channel + status badges visible
- [ ] Customer Info tab opens drawer
- [ ] Quick Actions tab opens drawer
- [ ] Header doesn't overlap content

### Content
- [ ] AI Context (Why Escalated) card displays
- [ ] Summary card displays
- [ ] Message timeline renders correctly
- [ ] Messages aligned properly (incoming left, outgoing right)
- [ ] Timestamps visible on all messages
- [ ] Reply area fixed at bottom
- [ ] Reply area accessible
- [ ] Send button functional

### FAB (Floating Action Button)
- [ ] Hidden initially (scroll position = 0)
- [ ] Appears after scrolling down 200px
- [ ] Fades in smoothly (opacity + transform)
- [ ] Positioned correctly (bottom-left, 8 units from edges)
- [ ] Translucent background with backdrop blur
- [ ] ChevronLeft icon visible
- [ ] Hover effect works (scale up)
- [ ] Click scrolls to top smoothly
- [ ] Then navigates back to list
- [ ] Haptic feedback on click (touch devices)

### Drawers
- [ ] Customer Info drawer slides from right
- [ ] Quick Actions drawer slides from right
- [ ] Drawer width is 58% of viewport
- [ ] Drawer doesn't exceed viewport
- [ ] Backdrop overlay darkens main content
- [ ] Drawer content visible and scrollable
- [ ] Close button works
- [ ] Click backdrop closes drawer
- [ ] Opening one drawer closes the other
- [ ] Smooth slide-in/out animations

---

## 🔄 Pull-to-Refresh

- [ ] Only active in List View (State 1)
- [ ] Only works on touch devices (not desktop mouse)
- [ ] Pull down shows "Pull to refresh" indicator
- [ ] Indicator styled to match app theme
- [ ] Release triggers refresh
- [ ] Shows spinner + "Refreshing..." during refresh
- [ ] Indicator fades after refresh completes
- [ ] Ticket list updates with new data
- [ ] No errors in console during refresh

---

## 💀 Skeleton Loading States

### Ticket List Skeletons
- [ ] 5-6 skeleton cards appear immediately on load
- [ ] Skeleton cards match real card dimensions
- [ ] Priority bar skeleton visible
- [ ] Title line skeletons (2 lines)
- [ ] Badge row skeleton visible
- [ ] Timestamp skeleton positioned correctly
- [ ] Shimmer animation plays smoothly
- [ ] Smooth transition from skeleton to real cards
- [ ] No layout shift when data loads

### Conversation Thread Skeleton
- [ ] Skeleton appears while loading conversation
- [ ] AI Context card skeleton (full width, ~150px)
- [ ] Summary card skeleton (full width, ~100px)
- [ ] Message bubble skeletons (3-4 bubbles)
- [ ] Bubbles alternate left/right alignment
- [ ] Pulsing animation plays (1.5s cycle)
- [ ] Smooth transition to real content
- [ ] No layout shift when data loads

---

## 🎮 Haptic Feedback (Touch Devices Only)

- [ ] Light haptic on ticket card tap
- [ ] Medium haptic when opening drawers
- [ ] Success haptic on resolve action
- [ ] Success haptic on assign action
- [ ] Success haptic on priority change
- [ ] Warning haptic on error/failure
- [ ] No haptics on desktop (non-touch devices)
- [ ] Haptics don't interfere with navigation

---

## ⚡ Optimistic UI Updates

### Assign to Me
- [ ] UI updates immediately before server response
- [ ] Success toast appears instantly
- [ ] Assigned badge updates in ticket card
- [ ] Reverts if server request fails
- [ ] Error toast shown on failure

### Resolve & Close
- [ ] Ticket moves to resolved state immediately
- [ ] Success toast appears
- [ ] Ticket badge updates
- [ ] Reverts on failure
- [ ] Error toast shown on failure

### Priority Change
- [ ] Priority badge updates immediately
- [ ] Color changes reflect new priority
- [ ] Success toast appears
- [ ] Reverts on failure

### Snooze
- [ ] Snooze dialog opens correctly
- [ ] Snoozed status updates immediately
- [ ] Ticket removed from list (if filtered)
- [ ] Reverts on failure

---

## 📏 Breakpoint Boundaries

Test at these specific widths:

- [ ] **759px**: Uses mobile layout (not tablet)
- [ ] **760px**: Switches to tablet layout
- [ ] **768px**: Common tablet size - all features work
- [ ] **1024px**: Standard tablet landscape - all features work
- [ ] **1199px**: Maximum tablet width - still uses tablet layout
- [ ] **1200px**: Switches to desktop layout (three columns)

---

## 🚀 Performance

- [ ] All animations run at 60fps (no jank)
- [ ] No stuttering when scrolling
- [ ] Drawer opens smoothly without frame drops
- [ ] State transitions feel instant (< 100ms perceived)
- [ ] No layout thrashing
- [ ] No unnecessary re-renders
- [ ] Pull-to-refresh responds immediately
- [ ] FAB appears/disappears smoothly on scroll
- [ ] Skeleton animations smooth (no CPU spikes)

---

## 🐛 Edge Cases

- [ ] No data (empty list) - shows proper empty state
- [ ] Single ticket - list layout doesn't break
- [ ] Very long ticket title - truncates gracefully
- [ ] Long message content - wraps properly
- [ ] Very short conversation - FAB still works
- [ ] Network error - error states display
- [ ] Slow connection - skeletons shown appropriately
- [ ] Rapid state switching - no race conditions
- [ ] Rapid drawer toggling - no animation conflicts
- [ ] Sidebar expand while drawer open - no overlap

---

## 🔍 Visual Regression Testing

Compare against reference screenshots in `docs/visual-references/`:

- [ ] List view (sidebar collapsed) matches reference
- [ ] List view (sidebar expanded) matches reference
- [ ] Conversation view matches reference
- [ ] Customer Info drawer matches reference
- [ ] Quick Actions drawer matches reference
- [ ] FAB appearance matches reference
- [ ] Skeleton states match reference

---

## 🛠️ Developer Tools Checks

- [ ] No errors in browser console
- [ ] No warnings in browser console
- [ ] No layout overflow warnings from `useTabletLayoutValidator`
- [ ] Network requests complete successfully
- [ ] No 404s for assets
- [ ] React DevTools shows correct component tree
- [ ] No memory leaks (check with DevTools Memory profiler)

---

## ✅ Final Verification

Before marking as complete:

1. **Test on real tablet devices** (if available)
   - iPad (various models)
   - Android tablets
   
2. **Test on browser DevTools** at all breakpoints
   - Chrome
   - Safari
   - Firefox
   
3. **Test all user flows**
   - View tickets → Select ticket → View conversation → Back to list
   - Apply filters → Select ticket → Resolve → Back to list
   - Open drawers → Perform actions → Close drawers
   
4. **Performance test**
   - Check Chrome Performance tab
   - Ensure 60fps animations
   - Check for layout thrashing
   
5. **Accessibility test**
   - Keyboard navigation works
   - Screen reader announcements correct
   - Focus management proper

---

## 📝 Notes

- Use this checklist for **every** deployment
- File bugs for any failed items
- Update checklist if new features added
- Keep reference screenshots up to date

**Estimated testing time:** 30-45 minutes for complete checklist
