

# Fix Email Inbox: Full Email Rendering, Accurate Counts, Navigation, and Categories

## Problems Identified

1. **Reading pane shows plain text only** -- Zero emails have `body_html` populated. The Aurinko list API (`/email/messages`) only returns `textBody` and `bodySnippet`, not `htmlBody`. To get the full HTML email (with images, formatting, etc.), each email must be fetched individually via `/email/messages/{id}`.

2. **"Needs Reply" shows 2,857** -- This is the all-time count. Your actual inbox has ~89 because most of those 2,857 are from months ago and have already been dealt with. We need to scope the count to recent emails (~30 days) to match reality.

3. **Categories are wrong** -- The classifier is marking things like "The AA" welcome emails, "Tide" reminders, and "ClickMechanic" promotions as "spam" when they should be "notification" or "newsletter." The classifier was not given clear enough guidance to distinguish spam from legitimate marketing/notifications.

4. **No navigation back** from `/inbox` -- The inbox page renders standalone without the main app sidebar, so there's no way to get back to the rest of the app.

5. **Stats bar shows "total"** -- Should show "unread" count instead.

---

## What Will Change

### 1. Fetch Full HTML Email on Demand

When a user clicks an email in the reading pane, if `body_html` is null, fetch the full email from Aurinko's individual message endpoint (`/email/messages/{externalId}`) and cache the HTML body back to the database.

**New edge function: `fetch-email-body`**
- Takes an `email_id` from `email_import_queue`
- Looks up the `external_id` and workspace's Aurinko `access_token`
- Calls `GET /v1/email/messages/{externalId}` which returns `htmlBody`
- Updates `body_html` in `email_import_queue`
- Returns the HTML body

**Reading pane change**: When `body_html` is null, call this edge function on first view. Show a brief loading state ("Loading full email...") then render the HTML in the iframe.

### 2. Fix "Needs Reply" Count -- Scope to Recent

Change the inbox and sidebar counts to only count emails from the last 30 days:

```
requires_reply = true 
AND from_email NOT LIKE '%maccleaning%' 
AND received_at >= NOW() - 30 days
```

This should bring the "Needs Reply" count from 2,857 down to ~96, matching the user's real inbox.

### 3. Fix Categories via Reclassification

The bulk classifier needs better prompt guidance. Specifically:
- Emails from known service providers (Stripe, CircleLoop, Lovable, etc.) should be "notification" not "spam"
- Marketing emails from companies you have accounts with should be "newsletter" not "spam"
- Only unsolicited, unwanted commercial email should be "spam"

**Action**: Update the `email-classify-bulk` edge function's system prompt to add clear examples and rules distinguishing notification/newsletter from spam. Then trigger a reclassification of emails currently marked as "spam" that come from legitimate sender domains.

### 4. Add Navigation -- Wrap in App Layout

The `/inbox` page will be wrapped inside the existing `PowerModeLayout`-style shell (with the main sidebar), rather than rendering standalone. This gives navigation back to Home, Training, Settings, etc.

Alternatively, add a simple back button/home link at the top of the inbox sidebar that navigates to `/`.

### 5. Fix Stats Bar

Replace "18,400 total" with an "Unread" count (emails received in last 30 days that haven't been opened/handled).

---

## Technical Details

### New Files

1. **`supabase/functions/fetch-email-body/index.ts`** -- Edge function to fetch individual email HTML from Aurinko API and cache it in `email_import_queue.body_html`

### Files to Modify

2. **`src/components/inbox/ReadingPane.tsx`**
   - When `body_html` is null, call the `fetch-email-body` edge function
   - Show loading state while fetching
   - Render full HTML email in iframe once loaded (images, tables, formatting all preserved)
   - Add Reply/Forward button placeholders in the quick actions bar

3. **`src/hooks/useInboxEmails.tsx`**
   - Add `received_at >= 30 days ago` filter to the "Needs Reply" count query
   - Add `received_at >= 30 days ago` filter to the "Inbox" count query
   - Add an "Unread" count (recent emails not yet handled)
   - Remove "total" count from stats

4. **`src/pages/Inbox.tsx`**
   - Replace "total" in stats bar with "Unread" count
   - Add a Home/back navigation link in the top stats bar
   - Or wrap in a layout that includes the main sidebar

5. **`src/components/inbox/InboxSidebar.tsx`**
   - Add a back-to-home link at the top
   - Update counts to use the 30-day scoped queries

6. **`supabase/functions/email-classify-bulk/index.ts`** (or the context file)
   - Update the classification prompt to:
     - Define "spam" as unsolicited commercial email from unknown senders
     - Define "notification" as transactional/service emails (receipts, alerts, missed calls)
     - Define "newsletter" as marketing from companies the user has a relationship with
     - Add explicit examples: Stripe = notification, CircleLoop = notification, Lovable = notification, marketing emails from known vendors = newsletter

7. **`src/components/inbox/QuickActionsBar.tsx`**
   - Add Reply and Forward buttons (Reply opens compose area, Forward opens with "Fwd:" prefix)
   - These can be placeholder UI for now with toast "Coming soon"

### Database

No schema changes. The `body_html` column already exists on `email_import_queue`.

### Reclassification Strategy

After updating the classifier prompt, trigger a targeted reclassification:
- Select all emails where `category = 'spam'` and `confidence < 0.98`
- Re-run classification on these ~2,390 emails
- This will correctly reclassify "The AA", "Tide", "ClickMechanic" etc. as notification/newsletter

This can be done via the existing `email-classify-bulk` edge function with a filter for spam-classified emails.

### Implementation Order

1. Fix navigation (add back button to inbox, wrap with sidebar)
2. Fix counts (scope to 30 days, replace "total" with "unread")
3. Create `fetch-email-body` edge function for on-demand HTML fetching
4. Update ReadingPane to fetch and render full HTML emails
5. Update classifier prompt and trigger spam reclassification
6. Add Reply/Forward button placeholders

