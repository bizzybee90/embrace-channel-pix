

# Parallel Classification + Aurinko Cost Fix

## Part 1: Stop the Aurinko Webhook Drain (Immediate)

The `aurinko-webhook` function is being called by Aurinko every time an email arrives for michael@maccleaning.uk. Each call costs cloud credits even though it fails HMAC verification and does nothing useful.

**Fix**: Add an early-exit "kill switch" at the very top of `aurinko-webhook/index.ts` -- before ANY processing (before rate limiting, before reading the body, before creating a Supabase client). This makes each unwanted invocation cost almost nothing.

The kill switch checks an environment variable `AURINKO_WEBHOOK_ENABLED`. If not set to `"true"`, the function returns 200 immediately. When you're ready to enable live email sync later, you just set that secret to `"true"`.

**File**: `supabase/functions/aurinko-webhook/index.ts` -- add 5 lines at the top of the serve handler, before line 82.

---

## Part 2: Fix Database RPCs (Migration)

The RPCs created earlier target the wrong table (`raw_emails` with `status = 'pending'`). They need to target `email_import_queue` with `status = 'scanned'` and `category IS NULL`.

**Migration will**:
1. Drop the existing `get_partitioned_unclassified_batch` function
2. Recreate it to query `email_import_queue` where `status = 'scanned' AND category IS NULL`
3. Drop the existing `count_unclassified_emails` function
4. Recreate it against `email_import_queue`
5. Drop the old index on `raw_emails`, create a new one on `email_import_queue`

---

## Part 3: Create `classify-emails-dispatcher` Edge Function

A thin orchestrator that:
1. Accepts `workspace_id` and optional `callback_url` (for n8n)
2. Counts unclassified emails via the `count_unclassified_emails` RPC
3. Calculates worker count: `min(ceil(count / 2500), 10)`
4. Fires N parallel `fetch()` calls to `email-classify-bulk` -- fire-and-forget
5. Each call receives `partition_id`, `total_partitions`, and `callback_url`
6. Returns immediately with `{ status: "dispatched", workers: N, total_emails: count }`

**New file**: `supabase/functions/classify-emails-dispatcher/index.ts`

---

## Part 4: Update `email-classify-bulk` for Partition Support

Modify the existing function to:
- Accept optional `partition_id`, `total_partitions`, and `callback_url` parameters
- When partitioned: use the `get_partitioned_unclassified_batch` RPC to fetch only this worker's slice
- When not partitioned: use existing direct query (backward compatible)
- Tag all log messages with worker ID (e.g., `[Worker 3/10]`)
- When self-chaining: pass the same partition params forward
- When partition is empty: check global remaining via `count_unclassified_emails`
  - If global > 0: exit silently (other workers still running)
  - If global = 0: trigger voice-learning AND send callback to `callback_url` if provided

**Modified file**: `supabase/functions/email-classify-bulk/index.ts`

---

## Part 5: Register Dispatcher in config.toml

Add `[functions.classify-emails-dispatcher]` with `verify_jwt = false`.

Also add `[functions.email-classify-bulk]` if not already present.

---

## What You Do (n8n Side)

Your n8n workflow becomes very simple:

```text
Webhook (receives workspace_id)
  --> HTTP Request: POST classify-emails-dispatcher
      Body: { workspace_id, callback_url: "your-n8n-webhook-url" }
  --> (dispatcher handles everything from here)

Separate webhook: receives completion callback
  --> Update status / trigger next steps
```

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/aurinko-webhook/index.ts` | Modify | Add kill switch to stop cost drain |
| Database migration | Create | Fix RPCs to target `email_import_queue` |
| `supabase/functions/classify-emails-dispatcher/index.ts` | Create | Parallel orchestrator |
| `supabase/functions/email-classify-bulk/index.ts` | Modify | Add partition support |
| `supabase/config.toml` | Modify | Register new functions |

---

## How Aurinko Works (Reference)

**Onboarding**: When you connect email via OAuth, the callback creates an Aurinko "subscription" -- telling Aurinko to POST to your webhook URL every time a new email arrives.

**Ongoing sync**: Aurinko sends a webhook for each new email. Your `aurinko-webhook` function fetches the full email, creates a conversation, and can trigger AI drafting. This is how new emails appear in BizzyBee after the initial import.

**The subscription renews** via `refresh-aurinko-subscriptions` (every 7 days). The kill switch stops processing without deleting the subscription, so you can re-enable it instantly when ready.

**Current drain**: Even failed HMAC checks cost credits because the function still boots and executes code. The kill switch returns before any of that happens.

