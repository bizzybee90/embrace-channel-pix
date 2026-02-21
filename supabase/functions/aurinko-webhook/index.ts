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
    const workspaceId = String(payload.workspace_id || payload.workspaceId || "").trim() || null;
    const explicitConfigId = String(payload.config_id || payload.configId || "").trim() || null;

    const supabase = createServiceClient();

    let configQuery = supabase
      .from("email_provider_configs")
      .select("id, workspace_id, email_address, aliases, access_token, subscription_id, account_id")
      .limit(1);

    if (explicitConfigId) {
      configQuery = configQuery.eq("id", explicitConfigId);
    }

    if (workspaceId) {
      configQuery = configQuery.eq("workspace_id", workspaceId);
    }

    const subscriptionId = String(payload.subscription_id || payload.subscriptionId || "").trim();
    const accountId = String(payload.account_id || payload.accountId || "").trim();

    if (!explicitConfigId && subscriptionId) {
      configQuery = configQuery.eq("subscription_id", subscriptionId);
    }

    if (!explicitConfigId && !subscriptionId && accountId) {
      configQuery = configQuery.eq("account_id", accountId);
    }

    const { data: config, error: configError } = await configQuery.maybeSingle();

    if (configError || !config) {
      throw new Error(`email_provider_configs lookup failed: ${configError?.message || "not found"}`);
    }

    const accessToken = String(config.access_token || "").trim();
    if (!accessToken) {
      throw new Error("Missing Aurinko access token for webhook config");
    }

    const messageId = extractMessageId(payload);
    let aurinkoMessage = extractInlineMessage(payload);

    if (!aurinkoMessage) {
      if (!messageId) {
        throw new HttpError(400, "Webhook payload does not include a message id or inline message object");
      }

      aurinkoMessage = await fetchAurinkoMessageById({
        accessToken,
        messageId,
      });
    }

    const ownerEmail = String(config.email_address || "").trim().toLowerCase();
    const aliases = Array.isArray(config.aliases)
      ? config.aliases.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
      : [];

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
      throw new Error(`bb_ingest_unified_messages failed: ${ingestError.message}`);
    }

    return jsonResponse({
      ok: true,
      config_id: config.id,
      workspace_id: config.workspace_id,
      external_id: unified.external_id,
      direction: unified.direction,
      ingest: ingestData,
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
