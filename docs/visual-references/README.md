# Visual References for Tablet Layout

This folder contains reference screenshots for the tablet layout at key breakpoints and states. Use these to prevent visual regressions.

---

## 📸 Required Screenshots

### List View (State 1)

**Filename:** `tablet-list-760px.png`
- **Breakpoint:** 760px width
- **State:** List view, sidebar collapsed
- **Content:** 5-6 ticket cards visible
- **Notes:** Minimum tablet width

**Filename:** `tablet-list-1024px.png`
- **Breakpoint:** 1024px width
- **State:** List view, sidebar collapsed
- **Content:** Full ticket list
- **Notes:** Common tablet landscape size

**Filename:** `tablet-list-sidebar-expanded.png`
- **Breakpoint:** 1024px width
- **State:** List view, sidebar expanded (240px)
- **Content:** Main content adjusted width
- **Notes:** Verify no overlap

---

### Conversation View (State 2)

**Filename:** `tablet-conversation-760px.png`
- **Breakpoint:** 760px width
- **State:** Conversation view, header visible
- **Content:** AI Context, Summary, Messages
- **Notes:** Minimum tablet width

**Filename:** `tablet-conversation-1024px.png`
- **Breakpoint:** 1024px width
- **State:** Conversation view
- **Content:** Full conversation workspace
- **Notes:** Standard tablet size

**Filename:** `tablet-conversation-scrolled.png`
- **Breakpoint:** 1024px width
- **State:** Conversation view, scrolled down
- **Content:** FAB visible in bottom-left
- **Notes:** Verify FAB appearance after 200px scroll

---

### Drawers

**Filename:** `tablet-customer-info-drawer.png`
- **Breakpoint:** 1024px width
- **State:** Customer Info drawer open
- **Content:** Drawer slides from right (58% width)
- **Notes:** Verify backdrop overlay

**Filename:** `tablet-quick-actions-drawer.png`
- **Breakpoint:** 1024px width
- **State:** Quick Actions drawer open
- **Content:** Action buttons visible
- **Notes:** Verify drawer width and backdrop

---

### Loading States

**Filename:** `tablet-list-skeleton.png`
- **Breakpoint:** 1024px width
- **State:** List view loading
- **Content:** 5-6 skeleton cards
- **Notes:** Shimmer animation active

**Filename:** `tablet-conversation-skeleton.png`
- **Breakpoint:** 1024px width
- **State:** Conversation view loading
- **Content:** AI Context, Summary, Message skeletons
- **Notes:** Pulsing animation active

---

### Pull-to-Refresh

**Filename:** `tablet-pull-to-refresh-pulling.png`
- **Breakpoint:** 1024px width
- **State:** Pulling down on list
- **Content:** "Pull to refresh" indicator visible
- **Notes:** Capture mid-pull state

**Filename:** `tablet-pull-to-refresh-refreshing.png`
- **Breakpoint:** 1024px width
- **State:** Refreshing state
- **Content:** Spinner + "Refreshing..." text
- **Notes:** Capture active refresh

---

### Edge Cases

**Filename:** `tablet-empty-state.png`
- **Breakpoint:** 1024px width
- **State:** List view, no tickets
- **Content:** Empty state message
- **Notes:** Verify centered layout

**Filename:** `tablet-sidebar-expanded-drawer-open.png`
- **Breakpoint:** 1024px width
- **State:** Sidebar expanded + drawer open
- **Content:** Both visible
- **Notes:** Verify no overlap, proper spacing

---

## 🎯 How to Capture Screenshots

### Using Browser DevTools

1. Open Chrome DevTools (F12)
2. Toggle device toolbar (Cmd+Shift+M on Mac, Ctrl+Shift+M on Windows)
3. Set custom dimensions:
   - 760px × 1024px (minimum tablet)
   - 1024px × 768px (common tablet)
   - 1199px × 800px (maximum tablet)
4. Navigate to desired state
5. Take screenshot:
   - Mac: Cmd+Shift+4, drag to select
   - Windows: Snipping Tool
   - DevTools: Cmd+Shift+P → "Capture screenshot"

### Naming Convention

Format: `tablet-[state]-[variant]-[breakpoint].png`

Examples:
- `tablet-list-collapsed-760px.png`
- `tablet-conversation-fab-visible-1024px.png`
- `tablet-drawer-customer-info-1024px.png`

---

## 📝 Screenshot Checklist

Before capturing, ensure:

- [ ] Browser zoom at 100%
- [ ] DevTools set to exact breakpoint
- [ ] No browser extensions interfering with layout
- [ ] Dark/light mode as specified (capture both if needed)
- [ ] Real data (not placeholder text)
- [ ] Animations paused at key frame (if applicable)
- [ ] No personal/sensitive data visible
- [ ] High quality (no compression artifacts)

---

## 🔄 When to Update Screenshots

Update reference screenshots when:

1. **Design changes approved**
   - New colors, spacing, shadows
   - Typography updates
   - Layout adjustments

2. **New features added**
   - New UI elements
   - Additional states
   - New interactions

3. **Bug fixes that affect visuals**
   - Layout corrections
   - Spacing fixes
   - Alignment improvements

4. **Major dependency updates**
   - UI library version bumps
   - CSS framework updates

---

## ⚠️ Important Notes

- **Do not** edit screenshots (no Photoshop/filters)
- Keep originals even after updates (version in filename if needed)
- Add date to filename for historical tracking: `tablet-list-1024px-2024-01-15.png`
- Store both light and dark mode variants if app supports themes
- Compress with lossless algorithm (PNG recommended)

---

## 🔍 Visual Regression Testing

### Manual Process

1. Capture new screenshot of same state/breakpoint
2. Compare side-by-side with reference
3. Look for:
   - Layout shifts
   - Color changes
   - Spacing differences
   - Missing elements
   - Alignment issues

### Automated (Future Enhancement)

Consider tools like:
- Percy (visual regression testing)
- Chromatic (Storybook visual testing)
- BackstopJS (screenshot comparison)

---

## 📦 File Organization

```
docs/visual-references/
├── README.md (this file)
├── list-view/
│   ├── tablet-list-760px.png
│   ├── tablet-list-1024px.png
│   └── tablet-list-sidebar-expanded.png
├── conversation-view/
│   ├── tablet-conversation-760px.png
│   ├── tablet-conversation-1024px.png
│   └── tablet-conversation-scrolled.png
├── drawers/
│   ├── tablet-customer-info-drawer.png
│   └── tablet-quick-actions-drawer.png
├── loading-states/
│   ├── tablet-list-skeleton.png
│   └── tablet-conversation-skeleton.png
└── edge-cases/
    ├── tablet-empty-state.png
    └── tablet-sidebar-expanded-drawer-open.png
```

---

## ✅ Quick Reference Table

| Screenshot | Breakpoint | State | Key Elements |
|------------|-----------|-------|--------------|
| `tablet-list-760px.png` | 760px | List | Min width, collapsed sidebar |
| `tablet-list-1024px.png` | 1024px | List | Standard tablet, collapsed sidebar |
| `tablet-list-sidebar-expanded.png` | 1024px | List | Expanded sidebar (240px) |
| `tablet-conversation-760px.png` | 760px | Conversation | Min width, full workspace |
| `tablet-conversation-1024px.png` | 1024px | Conversation | Standard tablet |
| `tablet-conversation-scrolled.png` | 1024px | Conversation | FAB visible (scrolled > 200px) |
| `tablet-customer-info-drawer.png` | 1024px | Conversation + Drawer | 58% drawer width |
| `tablet-quick-actions-drawer.png` | 1024px | Conversation + Drawer | Action buttons |
| `tablet-list-skeleton.png` | 1024px | Loading | 5-6 skeleton cards |
| `tablet-conversation-skeleton.png` | 1024px | Loading | Thread skeletons |
| `tablet-empty-state.png` | 1024px | Empty | No tickets message |

---

**Last Updated:** [Add date when screenshots are captured]

**Captured By:** [Add your name/team]

**App Version:** [Add version number]
