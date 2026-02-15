/**
 * Context-fetching helpers for enriched classification.
 * Fetches business profile, sender rules, classification corrections, and FAQs.
 */

export interface BusinessContext {
  companyName: string;
  businessType: string;
  serviceArea: string;
}

export interface SenderRule {
  id: string;
  sender_pattern: string;
  default_classification: string;
  default_requires_reply: boolean | null;
  skip_llm: boolean | null;
}

export interface ClassificationCorrection {
  original_text: string | null;
  original_category: string | null;
  corrected_category: string | null;
}

export interface FAQ {
  question: string;
}

export async function fetchBusinessContext(supabase: any, workspace_id: string): Promise<BusinessContext | null> {
  const { data } = await supabase
    .from('business_context')
    .select('company_name, business_type, service_area')
    .eq('workspace_id', workspace_id)
    .maybeSingle();

  if (!data) return null;
  return {
    companyName: data.company_name || 'a business',
    businessType: data.business_type || 'general',
    serviceArea: data.service_area || '',
  };
}

export async function fetchSenderRules(supabase: any, workspace_id: string): Promise<SenderRule[]> {
  const { data } = await supabase
    .from('sender_rules')
    .select('id, sender_pattern, default_classification, default_requires_reply, skip_llm')
    .eq('workspace_id', workspace_id)
    .eq('is_active', true);

  return data || [];
}

export async function fetchCorrections(supabase: any, workspace_id: string): Promise<ClassificationCorrection[]> {
  const { data } = await supabase
    .from('classification_corrections')
    .select('original_text, original_category, corrected_category')
    .eq('workspace_id', workspace_id)
    .order('created_at', { ascending: false })
    .limit(20);

  return data || [];
}

export async function fetchFAQs(supabase: any, workspace_id: string): Promise<FAQ[]> {
  const { data } = await supabase
    .from('faq_database')
    .select('question')
    .eq('workspace_id', workspace_id)
    .eq('is_own_content', true)
    .limit(15);

  return data || [];
}

/**
 * Match an email against sender rules. Returns the matching rule or null.
 * Supports exact match, domain match (@domain.com), and wildcard (*@domain.com).
 */
export function matchSenderRule(fromEmail: string, rules: SenderRule[]): SenderRule | null {
  if (!fromEmail) return null;
  const email = fromEmail.toLowerCase().trim();
  const domain = email.split('@')[1] || '';

  for (const rule of rules) {
    if (!rule.skip_llm) continue;
    const pattern = rule.sender_pattern.toLowerCase().trim();

    // Exact match
    if (pattern === email) return rule;
    // Domain match: @domain.com or *@domain.com
    if (pattern.startsWith('@') && domain === pattern.slice(1)) return rule;
    if (pattern.startsWith('*@') && domain === pattern.slice(2)) return rule;
    // Wildcard contains
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(email)) return rule;
    }
  }

  return null;
}

/**
 * Build the enriched prompt with business context, corrections, and FAQs.
 */
export function buildEnrichedPrompt(
  emails: Array<{ direction: string; from_email: string; subject: string; body: string }>,
  biz: BusinessContext | null,
  corrections: ClassificationCorrection[],
  faqs: FAQ[],
): string {
  const parts: string[] = [];

  // Business context header
  if (biz) {
    parts.push(`You are classifying emails for ${biz.companyName}, a ${biz.businessType} business${biz.serviceArea ? ` in ${biz.serviceArea}` : ''}.`);
  } else {
    parts.push('You are classifying emails for a small business.');
  }

  // FAQ topics
  if (faqs.length > 0) {
    parts.push('\nBusiness topics they handle:');
    for (const f of faqs) {
      parts.push(`- ${f.question.substring(0, 120)}`);
    }
  }

  // Corrections as few-shot examples
  if (corrections.length > 0) {
    parts.push('\nPrevious corrections (learn from these):');
    for (const c of corrections) {
      const text = (c.original_text || 'email').substring(0, 80);
      parts.push(`- "${text}" was wrongly classified as "${c.original_category}" -> correct: "${c.corrected_category}"`);
    }
  }

  // Categories and rules
  parts.push(`
Classify each email into ONE category AND extract any entities found.

Categories:
- inquiry: Questions about services/products/availability
- booking: Appointment/booking/scheduling requests
- quote: Price/quote/estimate requests
- complaint: Issues/problems/negative feedback
- follow_up: Replies to previous conversations
- spam: Marketing, promotions, newsletters, unwanted mass emails
- notification: Automated system notifications (receipts, confirmations, shipping alerts, calendar invites)
- personal: Personal/social messages from friends/family

Return ONLY a JSON array. Format: [{"i":0,"c":"inquiry","r":true,"conf":0.92,"ent":{}}]
Where:
  i = index (integer)
  c = category (string)
  r = requires_reply (boolean)
  conf = confidence (0.0-1.0, lower when unsure)
  ent = extracted entities object (include ONLY fields that are present):
    name: customer's full name
    email: customer's email (if different from sender)
    phone: phone number
    address: street address or postcode
    amount: monetary amount mentioned (e.g. "£250")
    date: any date/time mentioned (e.g. "next Tuesday", "15th March")
    service: specific service requested (e.g. "gutter cleaning", "3-bed semi")

Rules for requires_reply:
- spam, notification: ALWAYS false
- complaint, inquiry, quote, booking: ALWAYS true (customer needs response)
- follow_up: true if asking a question, false if just acknowledging/thanking
- personal: true if asking something, false otherwise
- outbound emails (OUT): ALWAYS false (you sent it, no need to reply to yourself)

Return ONLY valid JSON. No markdown. No explanation. Just the array.`);

  // Email lines
  const emailLines = emails.map((e: any, i: number) => {
    const dir = e.direction === 'outbound' ? 'OUT' : 'IN';
    const subject = (e.subject || '(none)').substring(0, 100).replace(/[\n\r|]/g, ' ');
    const snippet = (e.body || '').substring(0, 150).replace(/[\n\r|]/g, ' ');
    const from = (e.from_email || 'unknown').substring(0, 50);
    return `${i}|${dir}|${from}|${subject}|${snippet}`;
  }).join('\n');

  parts.push(`\nEMAILS (${emails.length} total, format: index|direction|from|subject|snippet):\n${emailLines}`);

  return parts.join('\n');
}
