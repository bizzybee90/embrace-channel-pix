

# Build a Proper Email Inbox from `email_import_queue`

## The Core Problem

The current inbox reads from the `conversations` table (hydrated data), but the actual email data lives in `email_import_queue` (18,400 emails). The hydration process introduced direction detection bugs and count mismatches. The uploaded prompt from Claude nails the solution: **build the inbox directly from `email_import_queue`**, eliminating the middleman entirely.

Additionally, the `direction` field in `email_import_queue` is unreliable -- emails FROM customers TO `hello@maccleaning.uk` are incorrectly marked as `outbound`. We need to detect direction by checking the `from_email` domain instead.

## Data Reality

- 18,400 total emails in `email_import_queue`
- ~3,190 flagged `requires_reply = true`
- Filtering to non-owner emails (`from_email NOT LIKE '%maccleaning%'`) from Jan 20 onward gives **86 emails** -- matching the user's reported ~89
- RLS policy already exists on `email_import_queue` for SELECT

## What Will Be Built

### 1. New Inbox Page (`/inbox`)

A dedicated three-column email client page reading **directly from `email_import_queue`**:

```text
+------------+--------------------+------------------------------+
|            |                    |                              |
|  Sidebar   |   Email List       |   Reading Pane               |
|  (220px)   |   (350px)          |   (remaining)                |
|            |                    |                              |
|  Inbox     |   Sender name      |   Full email header          |
|  Sent      |   Subject preview  |   From / To / Date           |
|  Needs     |   Time + category  |   Category badge + confidence|
|  Reply     |   badge            |   Email body (HTML/text)     |
|  AI Review |                    |   Thread view                |
|  Noise     |                    |   Quick actions bar          |
|  All Mail  |                    |                              |
+------------+--------------------+------------------------------+
```

### 2. Sidebar Folders (Virtual Filtered Views)

| Folder | Filter |
|--------|--------|
| Inbox | `from_email NOT LIKE '%maccleaning%' AND is_noise = false` |
| Sent | `from_email LIKE '%maccleaning%'` |
| Needs Reply | `requires_reply = true AND from_email NOT LIKE '%maccleaning%'` |
| AI Review | `needs_review = true` |
| Spam and Noise | `is_noise = true OR category = 'spam'` |
| All Mail | No filter |

Direction is determined by `from_email` domain, not the unreliable `direction` column.

### 3. Category Filters

Below folders, clickable category labels with counts:
- New Leads (`lead_new`)
- Customer Inquiries (`customer_inquiry`, `inquiry`)
- Quote Follow-ups (`lead_followup`, `quote`)
- Complaints (`customer_complaint`, `complaint`)
- Bookings (`booking`)
- Notifications (`automated_notification`, `notification`, `receipt_confirmation`)
- Newsletters (`marketing_newsletter`)

Clicking a category combines with the active folder filter.

### 4. Email List (Center Column)

Dense, scannable rows queried from `email_import_queue`:
- Sender name (from `from_name`, fallback to `from_email`)
- Subject line (truncated)
- Body preview (~80 chars, muted)
- Category badge with color coding
- Confidence score (shown if below 0.7)
- Time (relative: "2:34 PM" for today, "Yesterday", "12 Feb" for older)
- Colored dot if `requires_reply = true`
- 50 items per page with "Load more"

Search bar at top filtering across `from_email`, `from_name`, `subject`, `body` with 300ms debounce.

### 5. Reading Pane (Right Column)

When an email is selected:
- Full header: From, To, Date, Subject
- Category badge + AI confidence score + "Requires Reply" indicator
- Email body: render `body_html` via sanitized iframe (using existing DOMPurify setup), fall back to `body` with `whitespace-pre-wrap`
- Thread view: fetch all emails with same `thread_id`, display as collapsible conversation cards (newest expanded, older collapsed)
- Outbound emails get a different background tint

### 6. Quick Actions Bar

At bottom of reading pane:
- **Draft Reply**: Opens textarea placeholder ("AI-assisted replies coming soon")
- **Mark Handled**: Sets `requires_reply = false, status = 'processed'`
- **Change Category**: Dropdown calling `save-classification-correction` edge function (triggers auto-learning)
- **Mark as Spam**: Sets `category = 'spam'`, `is_noise = true`

### 7. Stats Bar

Thin bar above the three columns:
```text
142 in inbox  |  86 need reply  |  4 need AI review  |  18,400 total
```

### 8. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / Down | Next email |
| `k` / Up | Previous email |
| `Enter` | Open selected email |
| `Escape` | Deselect / back to list |
| `e` | Mark as handled |
| `#` | Mark as spam |
| `/` | Focus search |
| `r` | Open draft reply |

Small keyboard shortcut tooltip in bottom-right corner.

## Technical Details

### New Files

1. **`src/pages/Inbox.tsx`** -- Main inbox page with three-column layout, stats bar, and state management for folder/category/selected email
2. **`src/components/inbox/InboxSidebar.tsx`** -- Folder list + category filters with counts, all querying `email_import_queue`
3. **`src/components/inbox/EmailList.tsx`** -- Dense email list with search, sorting, pagination, keyboard navigation
4. **`src/components/inbox/EmailListItem.tsx`** -- Single email row with category badge, confidence, time, hover actions
5. **`src/components/inbox/ReadingPane.tsx`** -- Email detail view with header, HTML body rendering, thread view, quick actions
6. **`src/components/inbox/EmailThreadView.tsx`** -- Thread grouping by `thread_id` with collapsible cards
7. **`src/components/inbox/QuickActionsBar.tsx`** -- Draft Reply, Mark Handled, Change Category, Mark as Spam buttons

### Files to Modify

8. **`src/App.tsx`** -- Add `/inbox` route
9. **`src/components/sidebar/Sidebar.tsx`** -- Add "Inbox" link pointing to `/inbox` (the new email client), update counts to query `email_import_queue` directly
10. **`src/pages/Home.tsx`** -- Update "To Reply" card to use `email_import_queue` count and link to `/inbox?folder=needs-reply`

### Database

No schema changes needed. The `email_import_queue` table already has all required columns and an existing RLS SELECT policy. We will need one UPDATE policy for the quick actions (mark handled, change category, mark as spam):

```sql
CREATE POLICY "Users can update their workspace email queue"
  ON email_import_queue FOR UPDATE
  USING (workspace_id = get_my_workspace_id())
  WITH CHECK (workspace_id = get_my_workspace_id());
```

### Direction Detection

Instead of trusting the `direction` column, we determine direction in the query/component by checking `from_email`:

```typescript
const ownerDomains = ['maccleaning.uk', 'maccleaning.co.uk'];
const isOutbound = (email: string) =>
  ownerDomains.some(d => email?.toLowerCase().endsWith(`@${d}`));
```

This is used for folder filtering and visual styling (sent vs received tint in threads).

### Query Pattern

All queries use React Query with `useQuery` against `email_import_queue`:

```typescript
const { data: emails } = useQuery({
  queryKey: ['inbox-emails', folder, category, search, page],
  queryFn: async () => {
    let query = supabase
      .from('email_import_queue')
      .select('id, from_email, from_name, to_emails, subject, body, received_at, category, confidence, needs_review, is_noise, requires_reply, thread_id, status')
      .eq('workspace_id', workspaceId)
      .order('received_at', { ascending: false })
      .range(page * 50, (page + 1) * 50 - 1);
    // Apply folder + category filters...
    return query;
  },
  staleTime: 30000,
});
```

Full `body_html` is only fetched when an email is selected (on-demand).

### What NOT to Build

- No email sending/composing (future feature)
- No folder management (virtual views only)
- No email deletion (reclassify only)
- No contact management (separate page)
- No new database tables

## Implementation Order

1. Create the RLS UPDATE policy on `email_import_queue`
2. Build `Inbox.tsx` page shell with three-column layout
3. Build `InboxSidebar.tsx` with folder/category filters and counts
4. Build `EmailList.tsx` + `EmailListItem.tsx` with search, pagination, keyboard nav
5. Build `ReadingPane.tsx` with HTML rendering, thread view, quick actions
6. Add `/inbox` route and update sidebar navigation
7. Update Home.tsx counts to use `email_import_queue`
8. Style polish -- clean Slate palette, Inter font, subtle transitions

