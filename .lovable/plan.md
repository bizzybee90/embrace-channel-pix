

# Visual Redesign: "Productivity SaaS + Bee Accent" Color System

## Summary

Replace the current all-amber "Premium Honey" palette with a cooler, more neutral base that uses bee gold and tech purple as focused accents. The app will feel like a modern productivity SaaS (think Linear, Notion) with the BizzyBee brand expressed through targeted color pops rather than dominant warmth. **No functionality changes.**

## The New Palette (HSL values for CSS variables)

| Tier | Role | Hex | HSL |
|------|------|-----|-----|
| Background | App shell | `#F5F6FB` | `233 33% 97%` |
| Surface | Cards, panels | `#FFFFFF` | `0 0% 100%` |
| Secondary surface | Muted panels | `#F0F1F7` | `233 33% 95%` |
| Border | Thin dividers | `#D6D7E4` | `236 20% 87%` |
| Primary | Bee gold CTA | `#F6B938` | `40 91% 59%` |
| Primary foreground | Text on gold | `#111827` | `222 47% 11%` |
| Secondary accent | Tech purple | `#6E5DE7` | `249 75% 64%` |
| Secondary accent bg | Purple chip | `#E3DFFC` | `249 88% 93%` |
| Foreground | Body text | `#111827` | `222 47% 11%` |
| Muted foreground | Secondary text | `#6B7280` | `220 9% 46%` |
| Selected row | Active item bg | `#F0F1F7` | `233 33% 95%` |

## Changes by File

### 1. `src/index.css` -- Root CSS variables (major)

Update the `:root` block with the new palette:

- `--background`: `233 33% 97%` (was `210 40% 98%`)
- `--foreground`: `222 47% 11%` (was `220 15% 12%`)
- `--primary`: `40 91% 59%` (was `34 63% 55%` -- brighter, richer gold)
- `--primary-foreground`: `222 47% 11%` (dark text on gold buttons for contrast)
- `--secondary`: `233 33% 95%` (was `220 14% 96%` -- cooler lilac-grey)
- `--muted`: `233 33% 95%` (match secondary)
- `--accent`: `233 33% 95%` (match secondary)
- `--border`: `236 20% 87%` (was `220 13% 91%` -- slightly more visible)
- `--input`: `236 20% 87%` (match border)
- `--ring`: `40 91% 59%` (match primary)

Add new custom property for the secondary purple accent:
- `--accent-purple`: `249 75% 64%`
- `--accent-purple-foreground`: `0 0% 100%`
- `--accent-purple-soft`: `249 88% 93%`

Update the `.honey-glow-shadow` utility to use the new primary value (no code change needed since it references `var(--primary)`).

Dark mode values will be adjusted proportionally to maintain the same relationships.

### 2. `tailwind.config.ts` -- Register purple accent

Add the new purple accent color under `theme.extend.colors` so it can be used as `text-accent-purple`, `bg-accent-purple-soft`, etc.:

```text
"accent-purple": {
  DEFAULT: "hsl(var(--accent-purple))",
  foreground: "hsl(var(--accent-purple-foreground))",
  soft: "hsl(var(--accent-purple-soft))",
}
```

### 3. `src/components/layout/PowerModeLayout.tsx` -- Background color

Change `bg-slate-50/50` to `bg-background` so it pulls from the new CSS variable instead of a hardcoded Tailwind class. This ensures the layout respects the design system.

### 4. `src/components/layout/ThreeColumnLayout.tsx` -- Background color

Same change: `bg-slate-50/50` to `bg-background` for consistency.

### 5. `src/components/sidebar/Sidebar.tsx` -- Sidebar border

Update the sidebar border from the current ring styling to use `border-r border-border` for consistency with the new `--border` variable (`#D6D7E4`).

### 6. `src/components/ui/button.tsx` -- Primary button text

The primary button currently uses `text-primary-foreground` which will now resolve to dark charcoal (`#111827`) on gold (`#F6B938`). This is correct for accessibility. No code change needed -- just confirming the variable cascade works.

### 7. `src/components/conversations/ConversationCard.tsx` -- Selected state

Update the selected conversation card styling to use the new selected-row background (`bg-secondary`) instead of any amber-specific highlighting. The selected state becomes a clean, subtle highlight.

### 8. `src/pages/Review.tsx` -- No changes needed

The Review page already uses design-system tokens (`bg-background`, `text-foreground`, etc.). The new root variables will automatically cascade.

### 9. Pages using hardcoded `bg-slate-50/50` (Home, Settings, Analytics, KnowledgeBase, ChannelsDashboard)

Search for any remaining `bg-slate-50/50` references and replace with `bg-background`.

## What This Achieves

- **Cool, modern base**: The lilac-grey background (`#F5F6FB`) feels professional and easy on the eyes for all-day use
- **Bee brand as accent**: Gold buttons and highlights pop against the cool base without overwhelming
- **Tech purple secondary**: Provides visual variety for filters, pills, selection states, and charts
- **Unified system**: Every page inherits from the same CSS variables, so changing the palette is a single-file edit going forward
- **Dark mode preserved**: Dark mode values adjusted proportionally

## Files Modified (estimated: 5-8 files)

1. `src/index.css` -- Root variables + dark mode
2. `tailwind.config.ts` -- Register purple accent
3. `src/components/layout/PowerModeLayout.tsx` -- `bg-background`
4. `src/components/layout/ThreeColumnLayout.tsx` -- `bg-background`
5. `src/components/sidebar/Sidebar.tsx` -- Border consistency
6. `src/components/conversations/ConversationCard.tsx` -- Selected state
7. Any other files with hardcoded `bg-slate-50/50`

