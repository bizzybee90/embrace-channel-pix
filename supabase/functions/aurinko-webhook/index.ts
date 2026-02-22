import {
  aurinkoToUnifiedMessage,
  fetchAurinkoMessageById,
  inferDirectionFromOwner,
  type AurinkoMessage,
} from "../_shared/aurinko.ts";
import {
  createServiceClient,
  HttpError,
  jsonResponse,
  RateLimitError,
} from "../_shared/pipeline.ts";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyAurinkoSignature(rawBody: string, req: Request): Promise<void> {
  const secret = Deno.env.get("AURINKO_WEBHOOK_SECRET")?.trim();
  if (!secret) {
    return; // No secret configured, skip verification
  }

  const provided = req.headers.get("x-aurinko-signature")?.trim();
  if (!provided) {
    console.warn("⚠️ Missing Aurinko signature header — proceeding (non-blocking)");
    return;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const normalizedProvided = provided.toLowerCase().replace(/^sha256=/, "");
  if (!timingSafeEqual(normalizedProvided, hex)) {
    console.warn("⚠️ Aurinko signature mismatch — proceeding (non-blocking)");
    return;
  }
}

function extractMessageId(payload: Record<string, unknown>): string | null {
  const candidates: unknown[] = [
    payload.message_id,
    payload.messageId,
    payload.id,
    (payload.data as Record<string, unknown> | undefined)?.id,
    (payload.message as Record<string, unknown> | undefined)?.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function extractInlineMessage(payload: Record<string, unknown>): AurinkoMessage | null {
  const message = payload.message;
  if (!message || typeof message !== "object") {
    return null;
  }

  const typed = message as Record<string, unknown>;
  if (!typed.id) {
    return null;
  }

  return typed as unknown as AurinkoMessage;
}

Deno.serve(async (req) => {
  try {
    // Aurinko sends GET to verify the webhook URL when creating/refreshing subscriptions
    if (req.method === "GET") {
      const url = new URL(req.url);
      const validationToken = url.searchParams.get("validationToken");
      if (validationToken) {
        return new Response(validationToken, { status: 200, headers: { "Content-Type": "text/plain" } });
      }
      return new Response("OK", { status: 200 });
    }

    if (req.method !== "POST") {
      throw new HttpError(405, "Method not allowed");
    }

    // Check for validation token in URL (Aurinko subscription verification via POST)
    const url = new URL(req.url);
    const validationToken = url.searchParams.get("validationToken");
    if (validationToken) {
      console.log("Aurinko subscription validation POST, echoing token");
      return new Response(validationToken, { status: 200, headers: { "Content-Type": "text/plain" } });
    }

    const rawBody = await req.text();
    await verifyAurinkoSignature(rawBody, req);

    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    console.log("📨 Aurinko webhook payload keys:", Object.keys(payload), "subscriptionId:", payload.subscriptionId || payload.subscription_id, "accountId:", payload.accountId || payload.account_id);

    const supabase = createServiceClient();

    // Aurinko sends subscriptionId and/or accountId — match on those
    const subscriptionId = String(payload.subscription_id || payload.subscriptionId || "").trim();
    const accountId = String(payload.account_id || payload.accountId || "").trim();

    let config: Record<string, unknown> | null = null;
    let configError: { message: string } | null = null;

    // Try subscription_id first, then account_id, then fallback to single config
    if (subscriptionId) {
      const res = await supabase.from("email_provider_configs")
        .select("id, workspace_id, email_address, aliases, access_token, subscription_id, account_id")
        .eq("subscription_id", subscriptionId).maybeSingle();
      config = res.data; configError = res.error;
    }
    if (!config && accountId) {
      const res = await supabase.from("email_provider_configs")
        .select("id, workspace_id, email_address, aliases, access_token, subscription_id, account_id")
        .eq("account_id", accountId).maybeSingle();
      config = res.data; configError = res.error;
    }
    if (!config) {
      // Fallback: if there's only one config, use it
      const res = await supabase.from("email_provider_configs")
        .select("id, workspace_id, email_address, aliases, access_token, subscription_id, account_id")
        .limit(1).maybeSingle();
      config = res.data; configError = res.error;
    }

    if (configError || !config) {
      throw new Error(`email_provider_configs lookup failed: ${configError?.message || "not found"}`);
    }

    const accessToken = String(config.access_token || "").trim();
    if (!accessToken) {
      throw new Error("Missing Aurinko access token for webhook config");
    }

    const ownerEmail = String(config.email_address || "").trim().toLowerCase();
    const aliases = Array.isArray(config.aliases)
      ? config.aliases.map((entry: unknown) => String(entry).trim().toLowerCase()).filter(Boolean)
      : [];

    // Aurinko v2 webhook format: { subscription, resource, accountId, payloads: [{...}, ...] }
    const payloads = Array.isArray(payload.payloads) ? payload.payloads as Record<string, unknown>[] : [payload];
    const resource = String(payload.resource || "").toLowerCase();
    const subscriptionResource = String(payload.subscription?.resource || "").toLowerCase();
    console.log(`📬 Processing ${payloads.length} payload(s) from Aurinko webhook, resource: ${resource || subscriptionResource}`);

    const results: unknown[] = [];

    for (const item of payloads) {
      const messageId = extractMessageId(item);
      let aurinkoMessage = extractInlineMessage(item);

      if (!aurinkoMessage && !messageId) {
        console.warn("⚠️ Skipping payload without message id or inline message:", Object.keys(item));
        continue;
      }

      if (!aurinkoMessage) {
        aurinkoMessage = await fetchAurinkoMessageById({
          accessToken,
          messageId: messageId!,
        });
      }

      // Handle message.updated events: sync read status from Gmail → BizzyBee
      const eventType = String(item.type || item.event || payload.type || "").toLowerCase();
      if (eventType === "message.updated" || eventType === "updated") {
        const sysLabels = Array.isArray(aurinkoMessage.sysLabels) ? aurinkoMessage.sysLabels : [];
        const isUnread = sysLabels.includes("unread") || sysLabels.includes("UNREAD");
        const externalId = String(aurinkoMessage.id || messageId || "");

        if (externalId) {
          // Update message read status
          const { data: msgRow } = await supabase
            .from("messages")
            .select("id, conversation_id")
            .eq("external_id", externalId)
            .maybeSingle();

          if (msgRow) {
            // If email was read in Gmail, update conversation status accordingly
            if (!isUnread) {
              await supabase
                .from("conversations")
                .update({ status: "open", updated_at: new Date().toISOString() })
                .eq("id", msgRow.conversation_id)
                .eq("status", "new"); // Only transition from 'new' to 'open'
              console.log(`📖 Gmail read sync: conversation ${msgRow.conversation_id} marked as read`);
            }
            results.push({ external_id: externalId, type: "read_sync", is_unread: isUnread });
            continue;
          }
        }
      }

      const direction = inferDirectionFromOwner(aurinkoMessage, ownerEmail, aliases);

      const unified = aurinkoToUnifiedMessage({
        message: aurinkoMessage,
        channel: "email",
        direction,
        defaultToIdentifier: ownerEmail,
      });

      const { data: ingestData, error: ingestError } = await supabase.rpc("bb_ingest_unified_messages", {
        p_workspace_id: config.workspace_id,
        p_config_id: config.id,
        p_run_id: null,
        p_channel: "email",
        p_messages: [unified],
      });

      if (ingestError) {
        console.error(`❌ Ingest failed for message ${messageId}:`, ingestError.message);
        continue;
      }

      console.log(`✅ Ingested message ${unified.external_id} (${direction})`);
      results.push({ external_id: unified.external_id, direction, ingest: ingestData });
    }

    return jsonResponse({
      ok: true,
      config_id: config.id,
      workspace_id: config.workspace_id,
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error("aurinko-webhook error", error);

    if (error instanceof HttpError) {
      return jsonResponse({ ok: false, error: error.message }, error.status);
    }

    if (error instanceof RateLimitError) {
      return jsonResponse({ ok: false, error: error.message }, 429);
    }

    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    }, 500);
  }
});
