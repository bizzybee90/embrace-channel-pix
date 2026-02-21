import { extractJsonFromText, fetchWithTimeout, getOptionalEnv, getRequiredEnv } from "./pipeline.ts";
import type { ClassificationResult } from "./types.ts";

export interface ClassifyItemInput {
  item_id: string;
  conversation_id: string;
  target_message_id: string;
  channel: string;
  sender_identifier: string;
  subject: string;
  body: string;
  recent_messages: Array<{ direction: string; body: string }>;
}

export interface WorkspaceAiContext {
  business_context: Record<string, unknown> | null;
  faq_entries: Array<Record<string, unknown>>;
  corrections: Array<Record<string, unknown>>;
}

const DEFAULT_CLASSIFICATION: ClassificationResult = {
  category: "inquiry",
  requires_reply: true,
  confidence: 0.55,
  entities: {},
};

function normalizeClassification(value: unknown): ClassificationResult {
  const candidate = (value || {}) as Partial<ClassificationResult>;
  return {
    category: typeof candidate.category === "string" && candidate.category.trim()
      ? candidate.category.trim().toLowerCase()
      : DEFAULT_CLASSIFICATION.category,
    requires_reply: typeof candidate.requires_reply === "boolean"
      ? candidate.requires_reply
      : DEFAULT_CLASSIFICATION.requires_reply,
    confidence: typeof candidate.confidence === "number"
      ? Math.max(0, Math.min(1, candidate.confidence))
      : DEFAULT_CLASSIFICATION.confidence,
    entities: typeof candidate.entities === "object" && candidate.entities
      ? candidate.entities as Record<string, unknown>
      : {},
  };
}

function classificationSystemPrompt(context: WorkspaceAiContext): string {
  const biz = (context.business_context || {}) as Record<string, unknown>;
  const name = String(biz.name || biz.business_name || biz.company_name || "The Business");
  const industry = String(biz.industry || biz.service_type || biz.business_type || "UK Local Service / Trades");
  const rules = String(biz.rules || biz.core_rules || "Standard UK local service operations.");

  const faqText = context.faq_entries.length > 0
    ? JSON.stringify(context.faq_entries.slice(0, 30))
    : "No FAQs provided.";

  const correctionText = context.corrections.length > 0
    ? JSON.stringify(context.corrections.slice(0, 30))
    : "No historical corrections.";

  return `You are the AI triage engine for a UK local service business inbox.
Read each message, classify it with precision, determine urgency, and extract identity data.

<BUSINESS_CONTEXT>
Business Name: ${name}
Industry/Service: ${industry}
Specific Business Rules: ${rules}
</BUSINESS_CONTEXT>

<FAQ_KNOWLEDGE_BASE>
Use these to determine if a question can be a "quick_win":
${faqText}
</FAQ_KNOWLEDGE_BASE>

<HISTORICAL_CORRECTIONS>
Learn from these past manual corrections by the business owner:
${correctionText}
</HISTORICAL_CORRECTIONS>

<CATEGORIES>
Assign exactly ONE:
1. "quote" - Asking for pricing, estimates, or site visits to price a new job.
2. "booking" - Wants to lock in a date/time, or confirms they want to proceed.
3. "complaint" - Unhappy with service, damage, missed appointments, rework.
4. "follow_up" - Logistical updates on active/upcoming jobs (e.g., "gate is open", "running late", "dogs inside").
5. "inquiry" - General questions about the business, service area, capabilities.
6. "notification" - Automated emails from software, suppliers, platforms (Stripe, Checkatrade, Toolstation).
7. "newsletter" - Promotional emails, mailing lists from other companies.
8. "spam" - Cold outreach, SEO services, phishing, unsolicited sales.
9. "personal" - Emails from friends, family, or non-business contacts.
</CATEGORIES>

<DECISION_BUCKET>
Route to exactly ONE:
- "act_now": ONLY urgent complaints or urgent follow_ups (cancellations within 24hrs, locked access, active damage).
- "quick_win": Quotes, bookings, or inquiries where the answer is standard or in the FAQ.
- "needs_human": Complex jobs, bespoke quotes, nuanced complaints, owner judgment needed.
- "auto_handled": Notifications, newsletters, spam, AND purely informational follow_ups needing no reply ("Thanks mate", "Payment sent", "Gate unlocked").
</DECISION_BUCKET>

<REQUIRES_REPLY>
Does the sender expect a response?
- true: Quotes, bookings, complaints, inquiries, direct questions.
- false: Spam, newsletters, notifications, informational statements ("Thanks!", "Payment sent").
</REQUIRES_REPLY>

<IDENTITY_EXTRACTION>
Extract alternate phone numbers or emails from the message body/signature belonging to the SENDER.
Format phones to UK E.164 (+447...). Do NOT extract the business's own contact info.
</IDENTITY_EXTRACTION>

You will receive a batch of items as JSON. For EACH item, return:
{
  "item_id": "the item_id from input",
  "reasoning": "1-sentence thought process (do this FIRST before deciding)",
  "category": "one of the 9 categories above",
  "requires_reply": boolean,
  "confidence": 0.0-1.0,
  "entities": {
    "urgency": "high" | "medium" | "low",
    "extracted_phones": [],
    "extracted_emails": [],
    "location_or_postcode": null,
    "summary": "5-10 word summary of what they want"
  }
}

Return strictly JSON: {"results": [...]}`;
}

export async function classifyBatchWithLovable(params: {
  items: ClassifyItemInput[];
  context: WorkspaceAiContext;
}): Promise<Map<string, ClassificationResult>> {
  if (params.items.length === 0) {
    return new Map();
  }

  const endpoint = getOptionalEnv("AI_GATEWAY_URL", "https://ai.gateway.lovable.dev/v1/chat/completions");
  const model = getOptionalEnv("LOVABLE_CLASSIFY_MODEL", "google/gemini-2.5-flash");
  const apiKey = Deno.env.get("LOVABLE_API_KEY") || getOptionalEnv("AI_GATEWAY_KEY", "");

  const payload = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: classificationSystemPrompt(params.context) },
      {
        role: "user",
        content: JSON.stringify({ items: params.items }),
      },
    ],
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }, 25_000);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Lovable classify request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || data?.output_text || data?.content || "{}";
  const contentText = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part?.text || "").join("\n")
      : JSON.stringify(content);

  const parsed = extractJsonFromText(contentText) as { results?: unknown[] } | null;
  const results = Array.isArray(parsed?.results) ? parsed.results : [];

  const mapped = new Map<string, ClassificationResult>();
  for (const item of params.items) {
    mapped.set(item.item_id, DEFAULT_CLASSIFICATION);
  }

  for (const row of results) {
    const typed = row as { item_id?: string };
    if (!typed.item_id || !mapped.has(typed.item_id)) {
      continue;
    }

    mapped.set(typed.item_id, normalizeClassification(row));
  }

  return mapped;
}

export async function generateDraftWithAnthropic(params: {
  conversationId: string;
  subject: string;
  latestInboundBody: string;
  recentMessages: Array<{ direction: string; body: string }>;
  businessContext: Record<string, unknown> | null;
  faqEntries: Array<Record<string, unknown>>;
}): Promise<string> {
  const apiKey = getRequiredEnv("ANTHROPIC_API_KEY");
  const model = getOptionalEnv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest");
  const endpoint = getOptionalEnv("ANTHROPIC_API_URL", "https://api.anthropic.com/v1/messages");

  const systemPrompt = [
    "You write concise, professional customer support replies for UK SMBs.",
    "Follow UK English spelling and tone.",
    "Do not invent policy details. If uncertain, ask a clear clarifying question.",
    "Use context and FAQ when relevant.",
  ].join("\n");

  const userPrompt = JSON.stringify({
    conversation_id: params.conversationId,
    subject: params.subject,
    latest_inbound: params.latestInboundBody,
    recent_messages: params.recentMessages,
    business_context: params.businessContext || {},
    faq_entries: params.faqEntries.slice(0, 40),
    output_instructions: {
      format: "plain text",
      max_paragraphs: 3,
      include_signoff: true,
    },
  });

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  }, 25_000);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic draft request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const content = Array.isArray(data?.content) ? data.content : [];
  const text = content
    .map((part: { type?: string; text?: string }) => part?.type === "text" ? part.text || "" : "")
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Anthropic draft response was empty");
  }

  return text;
}
