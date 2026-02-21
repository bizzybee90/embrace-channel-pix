
# Fix Pipeline Workers: Queue Read Error + Missing Environment Variables

## Problem
All 4 pipeline workers (import, ingest, classify, draft) are crashing every 10 seconds with the same error. There are also 2 missing environment variables that will block the import and classify workers once the queue error is fixed.

### Issue 1: `bb_queue_read` SQL function incompatible with PGMQ
The `pgmq.read()` function returns a named composite type (`pgmq.message_record`). Our wrapper tries to alias the output with a column definition list (`AS r(msg_id, ...)`), which Postgres rejects. This is blocking ALL workers.

### Issue 2: Missing `AURINKO_API_BASE_URL`
Used by `getRequiredEnv()` in the Aurinko shared module. Without it, the import worker and aurinko-webhook function will crash.

### Issue 3: Missing `LOVABLE_AI_GATEWAY_URL`  
Used by `getRequiredEnv()` in the AI shared module. Without it, the classify worker will crash.

---

## Step 1: Fix `bb_queue_read` function (SQL migration)

Replace the function body to remove the column definition list from the `pgmq.read()` call:

```text
CREATE OR REPLACE FUNCTION public.bb_queue_read(queue_name text, vt_seconds integer, n integer)
 RETURNS TABLE(msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pgmq', 'pg_catalog'
AS $function$
begin
  return query
  select r.msg_id, r.read_ct, r.enqueued_at, r.vt, r.message
  from pgmq.read(queue_name, greatest(vt_seconds, 1), greatest(n, 1)) r;
end;
$function$;
```

The key change: `AS r(msg_id bigint, ...)` becomes just `r` -- letting Postgres use the named composite type columns directly.

## Step 2: Add `AURINKO_API_BASE_URL` secret

Value: `https://api.aurinko.io` (no trailing `/v1` -- the code appends that).

## Step 3: Add `LOVABLE_AI_GATEWAY_URL` secret

This is the Lovable AI gateway endpoint. Will check if it's auto-injected; if not, add it as a secret.

## Step 4: Verify

- Check worker logs to confirm queue reads succeed (no more "column definition list" error)
- Confirm workers return `{"ok": true}` responses
