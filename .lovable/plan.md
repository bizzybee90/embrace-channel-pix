
# Pre-Launch Security Hardening

## What Needs Doing

Three security items before going live:

### Item 1: Set ALLOWED_ORIGIN secret (Can be done now)
All 16 edge functions currently default to `Access-Control-Allow-Origin: *` because no `ALLOWED_ORIGIN` secret is set. This means any website in the world could call your backend functions from a browser. Setting it to your production domain locks this down.

- Published URL: `https://embrace-channel-pix.lovable.app`
- Secret to add: `ALLOWED_ORIGIN` = `https://embrace-channel-pix.lovable.app`

**Important caveat for webhook functions:** Functions called by external services (n8n, Aurinko, Apify) must allow those origins too. However, these webhook functions are server-to-server calls — the CORS header only applies to browser requests, so setting `ALLOWED_ORIGIN` to your app domain is safe for all functions, including webhooks.

### Item 2: N8N_WEBHOOK_SECRET — Already configured ✅
This secret exists and is set. The `n8n-email-callback` and `n8n-competitor-callback` functions both perform HMAC-SHA256 signature verification using it. Nothing to do here.

### Item 3: Rotate the Anon Key (Requires manual action from you)
The anon key is in your git history. To rotate it:
1. Open your Lovable Cloud backend view
2. Navigate to Project Settings → API
3. Click "Regenerate" on the anon key
4. The `.env` file and `src/integrations/supabase/client.ts` will auto-update

This will invalidate any existing browser sessions (users will need to log in again), but it's necessary since the old key is public.

## Implementation Steps

**Step 1 — Add ALLOWED_ORIGIN secret**
Use the `add_secret` tool to set `ALLOWED_ORIGIN` to `https://embrace-channel-pix.lovable.app`. This will immediately apply to all edge function deployments with no code changes needed, since all functions already read `Deno.env.get('ALLOWED_ORIGIN') || '*'`.

**Step 2 — Verify webhook functions still work**
The Aurinko and n8n webhook functions use server-to-server calls (not browser CORS), so they won't be affected. However, we should confirm the Aurinko OAuth callback flow works post-change since that involves a browser redirect.

**Step 3 — Anon key rotation (manual)**
This must be done by you directly in the Lovable Cloud backend. After rotation, test the login flow to confirm the new key propagates correctly.

## Technical Note
No code changes are required for Item 1 — the `ALLOWED_ORIGIN` pattern is already implemented in all functions. This is purely a secrets configuration task. Items 2 and 3 are also non-code changes.

## What I Can Do Right Now
I can trigger the `add_secret` tool to prompt you to set `ALLOWED_ORIGIN` to `https://embrace-channel-pix.lovable.app`. The anon key rotation requires you to action it directly in the backend — I'll provide the exact steps.
