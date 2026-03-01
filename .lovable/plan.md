

# Unify Visual Styles: Review Page + Inbox Pages

## Summary

Five changes to bring visual consistency across the Review page and all Inbox routes, based on your screenshots and feedback.

## Changes

### 1. White Background Panes (Inbox pages match Review page)
The Review page already has white `bg-white` left and right panes with `rounded-2xl shadow-sm border border-slate-200`. The inbox pages (PowerModeLayout) already have this -- confirmed in the code. No change needed here; the white panels are already in place.

### 2. Upgrade Review Page AI Summary Strip (grey/thin to colourful)
The Review page's AI bento strip at line 852 uses a plain `bg-slate-50/50` with muted text. This will be upgraded to match the inbox pages' stunning frosted glass gradient:
- **From**: `bg-slate-50/50` with plain `text-xs text-muted-foreground`
- **To**: `bg-gradient-to-r from-amber-50/60 via-purple-50/40 to-blue-50/40 rounded-2xl border border-white/60 shadow-sm ring-1 ring-slate-900/5` with a Sparkles icon and `text-sm font-medium text-slate-700`
- Will also add the CategoryLabel pill in the premium style (matching the inbox pages' indigo pill)

### 3. Universal CategoryLabel Pill Style
The inbox middle pane (ConversationThread) uses a beautiful inline pill: `border-indigo-200 bg-indigo-50 text-indigo-700` with a Tag icon. The left pane (JaceStyleInbox) and Review page use the generic `CategoryLabel` component which has different per-category colours.

**Solution**: Standardise the `CategoryLabel` component to always use the same premium indigo pill style (matching screenshot 3's middle pane "enquiry" pill), and enforce British spelling ("Enquiry" not "Inquiry") via the existing `toBritishLabel` function.

### 4. Highlight Selected Email in Left Pane
Currently the active row uses `bg-white shadow ring-1 ring-slate-900/5` which is subtle. Will update to a soft purple highlight that complements the app's purple accent:
- **Active state**: `bg-purple-50/60 border border-purple-200 ring-1 ring-purple-100 shadow-sm`
- This matches the Review page's `ReviewQueueItem` active style: `bg-white shadow-sm border border-purple-200 ring-1 ring-purple-50`

### 5. Fix "inquiry" Spelling in Review Page Categories
The Review page CATEGORIES array (line 99) has `label: 'Enquiry'` but `key: 'inquiry'` -- this is correct. But the CategoryLabel in the middle pane of ConversationThread at line 315 renders `conversation.category` raw without going through the British spelling normaliser. Will pipe it through `toBritishLabel`.

## Files Modified

1. **`src/pages/Review.tsx`** -- Upgrade AI bento strip from grey/thin to frosted glass gradient with Sparkles icon and premium pill styling
2. **`src/components/conversations/JaceStyleInbox.tsx`** -- Update active row to soft purple highlight
3. **`src/components/shared/CategoryLabel.tsx`** -- Unify all category pills to use the premium indigo style
4. **`src/components/conversations/ConversationThread.tsx`** -- Ensure category in bento strip uses `CategoryLabel` component (with British spelling) instead of raw text

## Technical Details

### Review page AI strip (lines 851-864 of Review.tsx)
```
Before: bg-slate-50/50, border-b border-slate-100, text-xs text-muted-foreground
After:  mx-6 mt-4 mb-2 p-4 bg-gradient-to-r from-amber-50/60 via-purple-50/40 to-blue-50/40 rounded-2xl border border-white/60 shadow-sm ring-1 ring-slate-900/5
```

### Active row highlight (JaceStyleInbox.tsx line 293)
```
Before: bg-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] ring-1 ring-slate-900/5
After:  bg-purple-50/60 border border-purple-200 ring-1 ring-purple-100 shadow-sm
```

### CategoryLabel unified style (CategoryLabel.tsx)
All category pills will use a consistent style: `bg-indigo-50 text-indigo-700 border-indigo-200` with the category icon, replacing the per-category colour map. The `toBritishLabel` function will be applied to all label output.

