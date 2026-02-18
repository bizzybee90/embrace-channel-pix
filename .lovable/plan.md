
# UI Forensic Fixes — Premium Shadow System + Layout Refinements

## What This Changes and Why

The user has performed a forensic audit identifying five specific areas where the CSS and component implementations fall short of the "Gold Standard" target. All changes are purely visual — no backend, no database, no edge functions.

---

## Fix 1 — CSS Shadows + Spring Physics (`src/index.css`)

**Problem:** The `.apple-shadow`, `.apple-shadow-lg`, and `.apple-shadow-sm` utility classes are currently defined *inside* the `@media (max-width: 900px)` block. This means they only apply on small screens — cards on desktop have no shadow at all. The shadow values themselves are also single-layer and muddy.

**Fix:**
- Move the three `.apple-shadow-*` classes and `.spring-bounce`/`.spring-press` *outside* the media query so they apply everywhere
- Replace the single-layer shadow with multi-layer Apple-style shadows:
  - `apple-shadow-sm`: subtle 1px ring + 2px diffuse
  - `apple-shadow`: 4px + 1px + 1px ring
  - `apple-shadow-lg`: dramatic 24px lift + 1px ring
- Fix spring bezier: current is `cubic-bezier(0.5, 0.9, 0.25, 1.3)` → corrected to `cubic-bezier(0.175, 0.885, 0.32, 1.275)` (proper overshoot curve)
- Keep all mobile-specific utilities (`mobile-native-card`, `mobile-frosted`, etc.) inside the media query

---

## Fix 2 — Conversation Card ("Ring Trick" + Typography) (`src/components/conversations/ConversationCard.tsx`)

**Problem:** Cards use `border border-border/30` which adds visible outlines between adjacent cards, creating a heavy grid feeling. The `formatShortTime` custom formatter is correct but can be simplified. Typography uses `text-foreground` at full opacity for both sender name and title, causing no visual hierarchy.

**Fix:**
- Remove `border border-border/30 hover:border-primary/30` — instead let the `apple-shadow` provide the card edge definition (the "ring trick": shadow's `0 0 0 1px rgba(0,0,0,0.02)` acts as a hairline border)
- Selected state: remove `border-primary/50`, keep the gradient background + stronger shadow
- Typography hierarchy: sender name stays `font-semibold text-foreground`, title becomes `text-foreground/80`, snippet stays `text-muted-foreground`
- Keep all swipe gestures, mutation handlers, memo comparison, `TriageQuickActions` — untouched
- Keep `formatShortTime` as-is (it's already correct short-form: "2m", "1h", "3d")

---

## Fix 3 — Reply Area (Floating Input Style) (`src/components/conversations/ReplyArea.tsx`)

**Problem:** The textarea sits inside a `Card` component inside another `div`, creating "box-in-a-box" depth layering. The textarea has a full border that fights with the card's border.

**Fix:**
- Remove the outer `Card` wrapper; use `div` with subtle background and border-radius directly
- Textarea: replace `border-border/60` with `border-0 bg-muted/30 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]` — floating input with inner shadow, no visible border
- Focus state: `focus-visible:ring-1 focus-visible:ring-primary/30` (subtle, not jarring)
- Send button: `bg-foreground text-background hover:bg-foreground/90 rounded-[12px]` — dark pill button like Superhuman/Linear
- Note textarea: same treatment but with `bg-warning/5` tint and `focus-visible:ring-warning/30`
- Keep all existing logic: auto-resize, draft loading, keyboard shortcuts, file upload, `onSend`/`onDraftChange` callbacks
- Remove the `Select` and `Card` imports since they're no longer used

---

## Fix 4 — Tablet Layout (True Master-Detail Split) (`src/components/layout/TabletLayout.tsx`)

**Problem:** The current tablet layout is a two-state toggle — either you see the list OR the conversation, never both. This wastes the larger screen real estate of tablets (760–1199px). A true master-detail split uses a fixed-width list column alongside a fluid detail column.

**Fix — Three-column split:**
```
[Sidebar: icons-only, ~80px] [List: fixed ~320px] [Detail: flex-1]
```

- Column 1: `<Sidebar forceCollapsed>` — icon-only, no labels, for space efficiency
- Column 2: `<JaceStyleInbox>` in a `w-[320px] flex-shrink-0` container with overflow-y-auto — always visible
- Column 3: `<ConversationThread>` or an empty state (`Sparkles` icon + "Select a conversation") — fills remaining space
- Remove `handleBackToList` (no longer needed as list stays persistent)
- Remove `refreshKey` state (was only used for the old two-state toggle)
- Keep `handleSelectConversation` (loads messages, triggers haptic)
- Keep `handleUpdate` (refreshes messages after reply)
- The `getFilterTitle` helper can be removed as it was only used for the now-removed header

**Result:** Users can scan the list and click into conversations without losing their place. The list stays persistent on the left. This is the standard pattern for iPad email apps (Mail, Superhuman).

---

## Fix 5 — Sidebar Active State Polish (`src/components/sidebar/Sidebar.tsx`)

**Problem:** The active state uses `bg-accent text-accent-foreground font-medium` (from `NavLink`'s `activeClassName`). This is a generic grey highlight. The brief calls for `bg-primary/8 rounded-xl` with `text-primary` icon and `text-primary font-semibold` mini-label for active items.

**Fix:**
- Change `activeClassName` on all primary NavLinks from `"bg-accent text-accent-foreground font-medium"` to `"bg-primary/10 text-primary font-semibold"`
- When in collapsed mode, the active item's mini-label should inherit `text-primary` from the parent (already works via CSS cascade with the `activeClassName` approach)
- The icon color in collapsed active state: icons currently have hard-coded color classes (`text-destructive`, `text-blue-500`, etc.). When active, these override the parent's `text-primary`. Instead, remove the hard-coded icon color classes so they inherit `currentColor` from the active state — OR keep them but accept the fixed icon colors (the mini-label going `text-primary` is already a good enough active signal)

For simplicity and to avoid breaking the existing color coding (red inbox = urgent, blue eye = unread, amber draft = draft), keep the icon colors fixed but update `activeClassName` to `"bg-primary/10 text-primary"` without `font-semibold` on the wrapper — instead apply `font-semibold` only to the label span when active. This requires using `useLocation` to detect the active route rather than relying on `NavLink`'s `activeClassName`.

Given the complexity, the cleaner approach: just update `activeClassName` to `"bg-primary/10 rounded-xl"` (adds the correct background, border-radius, and lets the mini-label color be controlled by Tailwind's cascade). This is a one-line change per NavLink.

---

## Files to be Modified

| File | Change |
|---|---|
| `src/index.css` | Move shadow/spring utilities outside media query; replace shadow values with multi-layer |
| `src/components/conversations/ConversationCard.tsx` | Remove border; ring-trick via shadow; typography hierarchy |
| `src/components/conversations/ReplyArea.tsx` | Remove Card wrapper; floating textarea with inner shadow; dark send button |
| `src/components/layout/TabletLayout.tsx` | Three-column master-detail split |
| `src/components/sidebar/Sidebar.tsx` | Update `activeClassName` to `bg-primary/10 rounded-xl` on all NavLinks |

---

## Implementation Notes

- The `TabletLayout` change is the most structural. The existing `JaceStyleInbox` and `ConversationThread` components don't need any changes — only how they're composed in `TabletLayout.tsx`.
- The `ReplyArea` change removes the `Card` and `Select` imports — need to verify no TypeScript errors from unused imports.
- The CSS shadow fix is the highest leverage change — it affects every card across the entire app.
- All swipe gestures, haptics, keyboard shortcuts, and Supabase mutation logic are preserved untouched.
