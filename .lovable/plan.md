

# Smarter Competitor Search: Wait for Meaningful Input

## The Problem
Currently the search triggers after just **3 characters** with a short 400ms delay. This means:
- Typing "lov" immediately triggers a web search → random irrelevant results
- Every keystroke pause fires an expensive API call
- Results don't match what you're actually looking for

## The Solution: Two-Mode Input Detection

### Mode 1: Direct Domain Entry (Instant)
If you're typing something that looks like a domain (contains `.` with no spaces):
- **No API call at all** — validate locally
- Show an instant "Add this website" button
- Example: typing `lovable.dev` → immediate option to add it

### Mode 2: Keyword Discovery (Patient)
If you're searching by keyword (like "window cleaning oxford"):
- **Wait for 5+ characters** (not 3)
- **Longer debounce: 800ms** (not 400ms)
- **Require a pause** before searching — shows "Keep typing..." while you type
- Only fire the search when input looks complete

---

## How It Will Work

```text
User types: "lovable.dev"
 └─> Detected as domain (has "." and no spaces)
 └─> Instant "Add lovable.dev" option appears
 └─> NO Firecrawl API call

User types: "window cleaning oxford"
 └─> Detected as keyword search
 └─> After 5 chars + 800ms pause → search triggers
 └─> Results appear
```

---

## Technical Changes

### 1. Add Domain Detection (Frontend)

New helper to detect if input looks like a domain:
```typescript
const isDomainLike = (input: string): boolean => {
  const trimmed = input.trim().toLowerCase();
  // Contains a dot, no spaces, looks like URL/domain
  return trimmed.includes('.') && !trimmed.includes(' ');
};
```

### 2. Update Search Thresholds

| Setting | Current | New |
|---------|---------|-----|
| Minimum characters for keyword search | 3 | 5 |
| Debounce delay | 400ms | 800ms |
| Domain detection | None | Instant (no API) |

### 3. Updated Search Logic

```typescript
useEffect(() => {
  // Clear any pending timer
  const timer = setTimeout(() => {
    const trimmed = searchInput.trim();
    
    // Mode 1: Domain detected — show instant add option
    if (isDomainLike(trimmed)) {
      setDirectDomainOption(extractDomain(trimmed));
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    
    // Mode 2: Keyword search — need 5+ chars
    setDirectDomainOption(null);
    if (trimmed.length >= 5) {
      searchForSuggestions(trimmed);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, 800); // Longer debounce
  
  return () => clearTimeout(timer);
}, [searchInput]);
```

### 4. New UI State: Direct Domain Option

When a domain is detected, show a prominent single-action card:

```text
┌──────────────────────────────────────────────────┐
│  🌐 lovable.dev                    [Add Website] │
└──────────────────────────────────────────────────┘
```

### 5. Updated Placeholder Text

**Current:** `"Search or add URL (e.g., window cleaning bicester)"`

**New:** `"Paste a URL or search by business name..."`

---

## Files to Change

| File | Changes |
|------|---------|
| `src/components/onboarding/CompetitorListDialog.tsx` | Add `isDomainLike()`, new state for direct domain, update debounce to 800ms, increase min chars to 5, add direct-add UI |
| `supabase/functions/competitor-search-suggest/index.ts` | No changes needed (backend stays the same) |

---

## Benefits

1. **No more random suggestions** — domain entry bypasses search entirely
2. **Fewer API calls** — 5 char minimum + longer debounce = fewer Firecrawl calls
3. **Faster for known domains** — instant add with no waiting
4. **Clearer UX** — users understand whether they're searching or adding
5. **Cost savings** — significantly reduced Firecrawl API usage

