import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Bucket = 'auto_handled' | 'quick_win' | 'act_now';

type Classification =
  | 'receipt_confirmation'
  | 'marketing_newsletter'
  | 'automated_notification'
  | 'customer_inquiry'
  | 'spam_phishing'
  | 'recruitment_hr';

interface RetriagedResult {
  id: string;
  originalBucket: string;
  newBucket: string;
  ruleApplied: string | null;
}

function safeExtractJson(text: string): any | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  // Try direct JSON
  try {
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return JSON.parse(trimmed);
  } catch {
    // ignore
  }

  // Try first {...}
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function normalizeBucket(v: any): Bucket | null {
  const s = String(v || '').toLowerCase();
  if (s === 'auto_handled' || s === 'quick_win' || s === 'act_now') return s as Bucket;
  return null;
}

function normalizeClassification(v: any): Classification | null {
  const s = String(v || '').toLowerCase();
  const allowed: Classification[] = [
    'receipt_confirmation',
    'marketing_newsletter',
    'automated_notification',
    'customer_inquiry',
    'spam_phishing',
    'recruitment_hr',
  ];
  return (allowed as string[]).includes(s) ? (s as Classification) : null;
}

function fallbackFromText(text: string): { bucket: Bucket; classification: Classification; requires_reply: boolean; reason: string } | null {
  const t = (text || '').toLowerCase();
  if (!t) return null;

  // If Claude outputs something like: bucket=auto_handled
  if (t.includes('auto_handled')) {
    return { bucket: 'auto_handled', classification: 'automated_notification', requires_reply: false, reason: 'AI indicated auto_handled' };
  }
  if (t.includes('quick_win')) {
    return { bucket: 'quick_win', classification: 'customer_inquiry', requires_reply: true, reason: 'AI indicated quick_win' };
  }
  if (t.includes('act_now')) {
    return { bucket: 'act_now', classification: 'customer_inquiry', requires_reply: true, reason: 'AI indicated act_now' };
  }

  // Content-based hinting
  if (t.includes('receipt') || t.includes('invoice') || t.includes('payment')) {
    return { bucket: 'auto_handled', classification: 'receipt_confirmation', requires_reply: false, reason: 'Looks like receipt/payment' };
  }
  if (t.includes('unsubscribe') || t.includes('newsletter') || t.includes('marketing')) {
    return { bucket: 'auto_handled', classification: 'marketing_newsletter', requires_reply: false, reason: 'Looks like newsletter/marketing' };
  }
  if (t.includes('phishing') || t.includes('spam') || t.includes('malware') || t.includes('suspicious')) {
    return { bucket: 'auto_handled', classification: 'spam_phishing', requires_reply: false, reason: 'Looks like spam/phishing' };
  }
  if (t.includes('application') || t.includes('candidate') || t.includes('cv') || t.includes('resume')) {
    return { bucket: 'auto_handled', classification: 'recruitment_hr', requires_reply: false, reason: 'Looks like recruitment/HR' };
  }

  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { workspaceId, limit = 50, offset = 0, dryRun = false, skipLLM = true } = await req.json();

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[bulk-retriage] Starting workspace=${workspaceId} limit=${limit} offset=${offset} dryRun=${dryRun} skipLLM=${skipLLM}`);

    const { data: senderRules } = await supabase
      .from('sender_rules')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        title,
        decision_bucket,
        email_classification,
        requires_reply,
        customer:customers(email, name),
        messages(body, direction)
      `)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (convError) {
      console.error('[bulk-retriage] Error fetching conversations:', convError);
      throw convError;
    }

    console.log(`[bulk-retriage] Conversations=${conversations?.length || 0} senderRules=${senderRules?.length || 0}`);

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

    let aiAttempted = 0;
    let aiOk = 0;
    let aiParsed = 0;
    let aiEmptyBody = 0;

    const results: RetriagedResult[] = [];
    const updates: Array<{
      id: string;
      decision_bucket: string | null;
      email_classification: string | null;
      requires_reply: boolean | null;
      why_this_needs_you: string | null;
      updated_at: string;
    }> = [];

    for (const conv of conversations || []) {
      const customerEmail = conv.customer?.[0]?.email as string | undefined;
      const senderDomain = customerEmail?.split('@')[1];

      // Direction should be 'inbound' in our system, but be defensive.
      const inboundMessage = conv.messages?.find((m: any) => String(m.direction || '').toLowerCase() === 'inbound')
        ?? conv.messages?.[0];
      const messageBody = (inboundMessage?.body || '').toString();
      const subject = (conv.title || '').toString();

      if (!messageBody.trim()) aiEmptyBody++;

      let matchedRule: any = null;

      if (senderRules && senderDomain) {
        for (const rule of senderRules) {
          const pattern = String(rule.sender_pattern || '').toLowerCase();
          const email = (customerEmail || '').toLowerCase();
          const domain = senderDomain.toLowerCase();

          if (pattern.startsWith('@') && domain === pattern.slice(1)) {
            matchedRule = rule;
            break;
          }
          if (pattern && (email.includes(pattern) || domain.includes(pattern))) {
            matchedRule = rule;
            break;
          }
        }
      }

      let newBucket = conv.decision_bucket as string | null;
      let newClassification = conv.email_classification as string | null;
      let newRequiresReply = conv.requires_reply as boolean | null;
      let whyText: string | null = null;

      if (matchedRule) {
        newClassification = matchedRule.default_classification;
        newRequiresReply = matchedRule.default_requires_reply;

        if (!newRequiresReply || ['automated_notification', 'receipt_confirmation', 'recruitment_hr'].includes(newClassification || '')) {
          newBucket = 'auto_handled';
          whyText = `Auto-handled: Matches sender rule ${matchedRule.sender_pattern}`;
        } else if (newClassification === 'customer_inquiry') {
          newBucket = 'quick_win';
          whyText = 'Customer inquiry needs a reply';
        }
      } else if (!skipLLM && ANTHROPIC_API_KEY && messageBody.trim()) {
        aiAttempted++;

        try {
          const triagePrompt = `You are triaging inbound customer emails.
Return ONLY valid JSON. No markdown. No explanation.

SENDER: ${customerEmail || 'unknown'}
SUBJECT: ${subject}
BODY: ${messageBody.slice(0, 2500)}

Choose ONE bucket:
- auto_handled (receipts/newsletters/notifications/spam; no reply)
- quick_win (simple reply needed)
- act_now (urgent/time-sensitive/complaint)

Choose ONE classification:
receipt_confirmation | marketing_newsletter | automated_notification | customer_inquiry | spam_phishing | recruitment_hr

JSON schema:
{"bucket":"auto_handled|quick_win|act_now","classification":"...","requires_reply":true|false,"reason":"..."}`;

          const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-3-5-haiku-20241022',
              max_tokens: 220,
              messages: [{ role: 'user', content: triagePrompt }],
            }),
          });

          const rawText = await aiResponse.text();
          if (!aiResponse.ok) {
            console.error(`[bulk-retriage] Anthropic HTTP ${aiResponse.status} for conv=${conv.id} bodyLen=${messageBody.length} resp=${rawText.slice(0, 200)}`);
          } else {
            aiOk++;
            const aiData = JSON.parse(rawText);
            const content = (aiData?.content?.[0]?.text || '').toString();

            const parsedJson = safeExtractJson(content);
            const parsedBucket = normalizeBucket(parsedJson?.bucket);
            const parsedClass = normalizeClassification(parsedJson?.classification);

            if (parsedBucket && parsedClass) {
              aiParsed++;
              newBucket = parsedBucket;
              newClassification = parsedClass;
              newRequiresReply = typeof parsedJson?.requires_reply === 'boolean' ? parsedJson.requires_reply : (parsedBucket !== 'auto_handled');
              whyText = (parsedJson?.reason || '').toString().slice(0, 220) || null;
            } else {
              // fallback if model didn't comply
              const fb = fallbackFromText(content);
              if (fb) {
                newBucket = fb.bucket;
                newClassification = fb.classification;
                newRequiresReply = fb.requires_reply;
                whyText = fb.reason;
              } else {
                console.warn(`[bulk-retriage] Unparseable AI output for conv=${conv.id}: ${content.slice(0, 120)}`);
              }
            }
          }
        } catch (e) {
          console.error(`[bulk-retriage] AI exception for conv=${conv.id}:`, e);
        }
      }

      const changed =
        (newBucket ?? null) !== (conv.decision_bucket ?? null) ||
        (newClassification ?? null) !== (conv.email_classification ?? null) ||
        (newRequiresReply ?? null) !== (conv.requires_reply ?? null);

      if (changed) {
        results.push({
          id: conv.id,
          originalBucket: (conv.decision_bucket || 'unknown') as string,
          newBucket: (newBucket || 'unknown') as string,
          ruleApplied: matchedRule?.sender_pattern || null,
        });

        if (!dryRun) {
          updates.push({
            id: conv.id,
            decision_bucket: newBucket,
            email_classification: newClassification,
            requires_reply: newRequiresReply,
            why_this_needs_you: whyText,
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    if (!dryRun && updates.length > 0) {
      console.log(`[bulk-retriage] Applying updates=${updates.length}`);
      for (const update of updates) {
        const { error } = await supabase
          .from('conversations')
          .update({
            decision_bucket: update.decision_bucket,
            email_classification: update.email_classification,
            requires_reply: update.requires_reply,
            why_this_needs_you: update.why_this_needs_you,
            updated_at: update.updated_at,
          })
          .eq('id', update.id);

        if (error) console.error(`[bulk-retriage] Update failed conv=${update.id}:`, error);
      }
    }

    const summary = {
      processed: conversations?.length || 0,
      changed: results.length,
      dryRun,
      skipLLM,
      ai: {
        provider: !skipLLM && ANTHROPIC_API_KEY ? 'anthropic' : 'none',
        attempted: aiAttempted,
        ok: aiOk,
        parsed: aiParsed,
        emptyBody: aiEmptyBody,
      },
      // Return all results so UI can display what changed
      results: results,
    };

    console.log(`[bulk-retriage] Complete processed=${summary.processed} changed=${summary.changed} ai_attempted=${aiAttempted} ai_ok=${aiOk} ai_parsed=${aiParsed} emptyBody=${aiEmptyBody}`);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[bulk-retriage] Error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
