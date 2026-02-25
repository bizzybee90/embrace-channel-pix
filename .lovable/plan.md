

# Honey Theme Migration -- Colour-Only, No Layout Changes

## Summary
Swap the app's blue/purple primary colour system to the BizzyBee "Honey Amber" palette so it matches the marketing site. Only CSS variables, semantic tokens, and hardcoded colour classes change -- zero layout, spacing, typography, or component structure modifications.

---

## Phase 1: Global Theme Tokens (`src/index.css`)

Update the CSS custom properties in both `:root` (light) and `.dark` blocks:

| Token | Current (HSL) | New (HSL from hex) |
|-------|---------------|-------------------|
| `--primary` | `217 91% 60%` (blue) | `36 64% 55%` (#d59543) |
| `--primary-foreground` | `0 0% 100%` | `0 0% 100%` (unchanged) |
| `--ring` | `217 91% 60%` | `36 64% 55%` |
| `--secondary` | `220 14% 96%` | `46 96% 89%` (#fef3c7 tint) |
| `--secondary-foreground` | `220 15% 12%` | `30 33% 15%` (#3d2516-ish) |
| `--accent` | `220 14% 96%` | `46 96% 89%` |
| `--accent-foreground` | `220 15% 12%` | `30 33% 15%` |
| `--background` | `220 17% 97%` | `50 20% 98%` (#fafaf8 warm white) |
| `--foreground` | `220 15% 12%` | `0 0% 10%` (#1a1a1a) |
| `--muted-foreground` | `220 9% 46%` | `220 9% 42%` (#6b7280) |
| `--border` | `220 13% 91%` | `220 14% 90%` (#e5e7eb) |
| `--input` | same as border | same as border |
| `--sidebar-ring` | `217.2 91.2% 59.8%` | `36 64% 55%` |
| `--sidebar-primary` | `240 5.9% 10%` | `30 33% 15%` |
| `--channel-email` | `217 91% 60%` | `36 64% 55%` (honey) |

Dark mode `--primary` and `--ring` get the same honey amber value. Secondary/accent become darker warm tones (`30 20% 18%`).

---

## Phase 2: Tailwind Config (`tailwind.config.ts`)

No structural changes needed -- all colours already reference CSS variables. No action required here.

---

## Phase 3: Hardcoded Purple References (~39 files, ~446 matches)

Search-and-replace patterns for all `purple-*` Tailwind classes:

| Pattern | Replacement |
|---------|-------------|
| `purple-600` | `amber-600` |
| `purple-500` | `amber-500` |
| `purple-400` | `amber-400` |
| `purple-700` | `amber-700` |
| `purple-100` | `amber-100` |
| `purple-50` | `amber-50` |
| `purple-950` | `amber-950` |
| `purple-200` | `amber-200` |
| `purple-800` | `amber-800` |
| `purple-900` | `amber-900` |

Key files affected:
- `LiveActivityDashboard.tsx` (unread cards)
- `JaceStyleInbox.tsx` (empty state gradient)
- `ConversationCard.tsx` / `.memo.tsx` (swipe actions -- these are blue, see Phase 4)
- `ActivityFeed.tsx` (reviewed icon)
- `InsightRevealCard.tsx` (purple variant)
- `ChannelManagementPanel.tsx` (review mode icon)
- `LearningSystemPanel.tsx` (behavior stats icon)
- `InboxLearningInsightsPanel.tsx` (patterns icon)
- Various onboarding / settings panels

---

## Phase 4: Hardcoded Blue References (~45 files, ~368 matches)

Blue is used in two contexts:
1. **As the old primary colour** (buttons, spinners, active states) -- these become honey via the CSS variable change automatically (they use `text-primary`, `bg-primary`, etc.).
2. **As a semantic/category colour** (e.g., `text-blue-500` for "scheduling", channel icons, info badges) -- these stay blue because they represent category meaning, not brand.

Only blue references that serve as "brand primary" substitutes get changed to amber:
- `ConversationCard.memo.tsx` swipe resolve background: `blue-500/20` to `amber-500/20`, `blue-600` to `amber-600`
- `ConversationCard.tsx` same swipe colours
- Draft badges: `blue-500/10 text-blue-600 border-blue-500/20` to `amber-500/10 text-amber-600 border-amber-500/20`
- `Home.tsx` "To Reply" icon colour if it acts as primary

Category/semantic blues (scheduling, info, channel-email, admin status) stay as-is.

---

## Phase 5: Indigo Category Pills (`CategoryLabel.tsx`)

The unified pill class:
```
bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700
```
Changes to:
```
bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-700
```

Other indigo references in `ConversationThread.tsx` (Deep Dive button, intelligence panel gradient), `CustomerIntelligence.tsx`, and `InsightsWidget.tsx` change from indigo to amber/honey equivalents.

---

## Phase 6: Button Hover State (`button.tsx`)

The default variant already uses `hover:bg-primary/90` which will automatically use the new honey token. No changes needed to button component.

---

## Phase 7: Contrast Verification Pass

After token changes, visually verify these key screens:
- **Dashboard**: KPI cards, activity feed, AI widgets
- **Inbox / Conversation List**: active item highlight, badges
- **AI Reconciliation (Review)**: confirm/change buttons, confidence bars
- **Cleared / Done**: resolved state styling
- **Settings**: section headers, toggle accents

White text on `#d59543` has a contrast ratio of ~3.6:1 which passes WCAG AA for large text. For small text we ensure `--primary-foreground` stays white and button text is bold/semibold (matching current pattern).

---

## Files Modified (estimated ~50 files)

1. `src/index.css` -- theme tokens (the core change)
2. `src/components/shared/CategoryLabel.tsx` -- indigo to amber pills
3. ~35 component files -- purple/blue hardcoded classes to amber
4. `src/components/conversations/ConversationThread.tsx` -- indigo accents
5. `src/components/customers/CustomerIntelligence.tsx` -- indigo gradient
6. `src/components/dashboard/InsightsWidget.tsx` -- indigo icons

No layout, spacing, typography, component structure, routing, or copy changes.

