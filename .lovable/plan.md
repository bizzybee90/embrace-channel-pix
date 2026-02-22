
# Inbox Conversation View Polish

## Problem Summary
Based on the screenshots and database investigation, there are several issues with the conversation reading pane:

1. **Empty message bodies**: Imported emails store content only in `raw_payload.body` (HTML) and `raw_payload.bodySnippet`, but the `body` column is empty. The MessageTimeline renders blank messages because it only reads `message.body`.
2. **Unknown sender names**: Actor names are stored as `unknown@unknown.invalid` -- needs fallback to customer name or `raw_payload.from.address`.
3. **Duplicated AI summary**: The AI briefing banner already shows the summary at the top, but the Intelligence mini-card repeats the same text below it.
4. **"View details" too subtle**: The tiny 10px "View details" link is easy to miss.
5. **Card proportions wrong**: Contact card and Intelligence card are equal width (50/50), but the intelligence card needs more space for its tags and text.

---

## Changes

### 1. Fix empty message bodies (MessageTimeline.tsx)
When `message.body` is empty but `raw_payload` exists, extract readable content:
- Use `raw_payload.bodySnippet` as plain text fallback
- If neither exists, strip HTML from `raw_payload.body` to get text
- This ensures all imported emails display their actual content

### 2. Fix sender name fallback (MessageTimeline.tsx)
Update the `actorName` logic to also check:
- `raw_payload.from.name` or `raw_payload.from.address`
- Then `conversationCustomerName`
- Then 'Unknown Sender' as last resort

### 3. Remove duplicated AI summary from inline Intelligence card (ConversationThread.tsx)
Remove the `(customer?.intelligence as any)?.summary` paragraph from the inline Intelligence mini-card since the AI Briefing banner already displays the same information.

### 4. Make "View details" more prominent (ConversationThread.tsx)
Replace the tiny "View details" text with a more visible button-like element:
- Use `text-xs font-medium text-primary` with a hover underline
- Make the entire card more obviously clickable with a subtle "tap to explore" CTA

### 5. Adjust card proportions (ConversationThread.tsx)
Change the grid from equal `grid-cols-2` to asymmetric layout:
- Contact card: narrower (about 40%)
- Intelligence card: wider (about 60%)
- Use `grid-cols-5` with contact taking `col-span-2` and intelligence taking `col-span-3`

---

## Technical Details

**File: `src/components/conversations/MessageTimeline.tsx`**
- Around line 104-108, add logic to derive `displayBody` from `raw_payload` when `message.body` is empty
- Add a simple `stripHtmlTags()` helper to extract text from HTML body
- Update `actorName` derivation (line 100-102) to check `raw_payload.from`

**File: `src/components/conversations/ConversationThread.tsx`**
- Line 306: Change grid from `grid-cols-2` to `grid-cols-5`
- Line 308: Add `col-span-2` to contact card
- Line 332: Add `col-span-3` to intelligence card
- Lines 370-373: Remove the AI summary paragraph (duplicate of briefing)
- Lines 329, 425: Make "View details" more prominent with button-style styling
