import { fetchWithTimeout, getOptionalEnv, getRequiredEnv, parseRetryAfterSeconds, RateLimitError } from "./pipeline.ts";
import type { Direction, UnifiedMessage } from "./types.ts";

export interface AurinkoMessage {
  id: string;
  threadId?: string;
  from?: { email?: string; name?: string } | string;
  to?: Array<{ email?: string; name?: string }> | string[] | string;
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  receivedAt?: string;
  createdAt?: string;
  sysLabels?: string[];
  attachments?: unknown[];
  [key: string]: unknown;
}

export interface AurinkoPageResult {
  messages: AurinkoMessage[];
  nextPageToken?: string | null;
  raw: Record<string, unknown>;
}

function normalizeEmail(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function asEmail(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = normalizeEmail(value);
    return trimmed || null;
  }

  if (typeof value === "object") {
    const maybeEmail = normalizeEmail((value as { email?: string }).email);
    return maybeEmail || null;
  }

  return null;
}

function firstRecipient(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return normalizeEmail(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const email = asEmail(entry);
      if (email) {
        return email;
      }
    }
    return "";
  }

  return asEmail(value) || "";
}

export function isUnread(sysLabels: unknown): boolean {
  if (!Array.isArray(sysLabels)) {
    return false;
  }

  return sysLabels.some((label) => String(label).toLowerCase() === "unread");
}

export function inferDirectionFromOwner(
  msg: AurinkoMessage,
  ownerEmail: string,
  aliases: string[],
): Direction {
  const knownOwners = new Set([ownerEmail, ...aliases].map((x) => normalizeEmail(x)).filter(Boolean));
  const fromEmail = asEmail(msg.from);
  if (fromEmail && knownOwners.has(fromEmail)) {
    return "outbound";
  }
  return "inbound";
}

export function aurinkoToUnifiedMessage(
  params: {
    message: AurinkoMessage;
    channel: "email";
    direction: Direction;
    defaultToIdentifier: string;
  },
): UnifiedMessage {
  const message = params.message;
  const fromEmail = asEmail(message.from) || "unknown@unknown.invalid";
  const toEmail = firstRecipient(message.to) || normalizeEmail(params.defaultToIdentifier) || "unknown@unknown.invalid";
  const timestamp = message.receivedAt || message.createdAt || new Date().toISOString();
  const sysLabels = Array.isArray(message.sysLabels)
    ? message.sysLabels.map((x) => String(x).toLowerCase())
    : [];

  return {
    external_id: String(message.id),
    thread_id: String(message.threadId || message.id),
    channel: "email",
    direction: params.direction,
    from_identifier: fromEmail,
    from_name: typeof message.from === "object" && message.from ? (message.from as { name?: string }).name || null : null,
    to_identifier: toEmail,
    body: String(message.textBody || ""),
    body_html: message.htmlBody ? String(message.htmlBody) : null,
    subject: message.subject ? String(message.subject) : null,
    timestamp,
    is_read: !sysLabels.includes("unread"),
    metadata: {
      attachments: message.attachments || [],
      sysLabels,
    },
    raw_payload: message as Record<string, unknown>,
  };
}

export async function fetchAurinkoMessagesPage(params: {
  accessToken: string;
  folder: "INBOX" | "SENT";
  pageToken?: string | null;
  limit?: number;
}): Promise<AurinkoPageResult> {
  const baseUrl = getRequiredEnv("AURINKO_API_BASE_URL").replace(/\/$/, "");
  const url = new URL(`${baseUrl}/v1/email/messages`);
  url.searchParams.set("folder", params.folder);
  url.searchParams.set("limit", String(params.limit ?? 100));
  if (params.pageToken) {
    url.searchParams.set("pageToken", params.pageToken);
  }

  const response = await fetchWithTimeout(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
    },
  }, 25_000);

  if (response.status === 429) {
    throw new RateLimitError("Aurinko rate limited", parseRetryAfterSeconds(response, 30));
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Aurinko list failed (${response.status}): ${errorText}`);
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const messages = (raw.messages || raw.items || raw.data || []) as AurinkoMessage[];
  const nextPageToken = (raw.nextPageToken || raw.next_page_token || null) as string | null;

  return { messages, nextPageToken, raw };
}

export async function fetchAurinkoMessageById(params: {
  accessToken: string;
  messageId: string;
}): Promise<AurinkoMessage> {
  const baseUrl = getRequiredEnv("AURINKO_API_BASE_URL").replace(/\/$/, "");
  const url = `${baseUrl}/v1/email/messages/${encodeURIComponent(params.messageId)}`;
  const timeoutMs = Number(getOptionalEnv("AURINKO_WEBHOOK_FETCH_TIMEOUT_MS", "20000"));

  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
    },
  }, timeoutMs);

  if (response.status === 429) {
    throw new RateLimitError("Aurinko rate limited", parseRetryAfterSeconds(response, 20));
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Aurinko message fetch failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  if (payload?.message && typeof payload.message === "object") {
    return payload.message as AurinkoMessage;
  }

  return payload as AurinkoMessage;
}
