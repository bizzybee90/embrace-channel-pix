import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// POPULATE SENDER RULES FROM HISTORICAL DATA
// Seeds sender_rules table with known patterns
// ============================================

interface SenderPattern {
  pattern: string;
  classification: string;
  requires_reply: boolean;
  reason: string;
}

// Known patterns to seed from common email providers
const KNOWN_AUTO_HANDLED_PATTERNS: SenderPattern[] = [
  // Payment & Financial
  { pattern: '@stripe.com', classification: 'receipt_confirmation', requires_reply: false, reason: 'Payment notifications' },
  { pattern: '@mail.stripe.com', classification: 'receipt_confirmation', requires_reply: false, reason: 'Stripe receipts' },
  { pattern: '@gocardless.com', classification: 'receipt_confirmation', requires_reply: false, reason: 'Direct debit notifications' },
  { pattern: '@xero.com', classification: 'receipt_confirmation', requires_reply: false, reason: 'Accounting notifications' },
  { pattern: '@freeagent.com', classification: 'receipt_confirmation', requires_reply: false, reason: 'Accounting notifications' },
  { pattern: '@quickbooks.intuit.com', classification: 'receipt_confirmation', requires_reply: false, reason: 'Accounting notifications' },
  { pattern: '@tide.co', classification: 'receipt_confirmation', requires_reply: false, reason: 'Banking notifications' },
  
  // Shipping
  { pattern: '@ups.com', classification: 'automated_notification', requires_reply: false, reason: 'Shipping updates' },
  { pattern: '@fedex.com', classification: 'automated_notification', requires_reply: false, reason: 'Shipping updates' },
  { pattern: '@royalmail.com', classification: 'automated_notification', requires_reply: false, reason: 'Shipping updates' },
  { pattern: '@dpd.co.uk', classification: 'automated_notification', requires_reply: false, reason: 'Delivery notifications' },
  
  // Social/Marketing
  { pattern: '@linkedin.com', classification: 'marketing_newsletter', requires_reply: false, reason: 'LinkedIn notifications' },
  { pattern: '@facebook.com', classification: 'marketing_newsletter', requires_reply: false, reason: 'Facebook notifications' },
  { pattern: '@twitter.com', classification: 'marketing_newsletter', requires_reply: false, reason: 'Twitter/X notifications' },
  { pattern: '@instagram.com', classification: 'marketing_newsletter', requires_reply: false, reason: 'Instagram notifications' },
  
  // Job boards
  { pattern: '@indeed.com', classification: 'recruitment_hr', requires_reply: false, reason: 'Job board notifications' },
  { pattern: '@totaljobs.com', classification: 'recruitment_hr', requires_reply: false, reason: 'Job board notifications' },
  { pattern: '@reed.co.uk', classification: 'recruitment_hr', requires_reply: false, reason: 'Job board notifications' },
  
  // Business tools
  { pattern: '@calendly.com', classification: 'automated_notification', requires_reply: false, reason: 'Calendar notifications' },
  { pattern: '@slack.com', classification: 'automated_notification', requires_reply: false, reason: 'Slack notifications' },
  { pattern: '@zoom.us', classification: 'automated_notification', requires_reply: false, reason: 'Zoom notifications' },
  
  // Communication tools
  { pattern: '@circleloop.com', classification: 'automated_notification', requires_reply: false, reason: 'Phone system notifications' },
  
  // Cloud/Dev
  { pattern: '@github.com', classification: 'internal_system', requires_reply: false, reason: 'GitHub notifications' },
  { pattern: '@cloudflare.com', classification: 'internal_system', requires_reply: false, reason: 'Cloudflare alerts' },
  
  // Google
  { pattern: 'noreply@google.com', classification: 'automated_notification', requires_reply: false, reason: 'Google notifications' },
  { pattern: '@googleworkspace.com', classification: 'automated_notification', requires_reply: false, reason: 'Google Workspace notifications' },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspace_id, mode = 'seed' } = await req.json();
    
    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'Missing workspace_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    let insertedCount = 0;
    let skippedCount = 0;

    if (mode === 'seed' || mode === 'both') {
      // Seed known patterns
      for (const pattern of KNOWN_AUTO_HANDLED_PATTERNS) {
        // Check if rule already exists
        const { data: existing } = await supabase
          .from('sender_rules')
          .select('id')
          .eq('workspace_id', workspace_id)
          .eq('sender_pattern', pattern.pattern)
          .maybeSingle();

        if (existing) {
          skippedCount++;
          continue;
        }

        const { error } = await supabase
          .from('sender_rules')
          .insert({
            workspace_id,
            sender_pattern: pattern.pattern,
            default_classification: pattern.classification,
            default_requires_reply: pattern.requires_reply,
            is_active: true,
          });

        if (!error) {
          insertedCount++;
        } else {
          console.error('[PopulateSenderRules] Error inserting:', pattern.pattern, error);
        }
      }
      console.log(`[PopulateSenderRules] Seeded ${insertedCount} known patterns, skipped ${skippedCount} existing`);
    }

    let learnedCount = 0;
    if (mode === 'learn' || mode === 'both') {
      // Learn from historical conversations
      // Find senders that are consistently auto_handled or quick_win
      
      const { data: bucketStats, error: statsError } = await supabase
        .from('messages')
        .select(`
          raw_payload,
          conversation:conversations!inner(
            workspace_id,
            decision_bucket,
            requires_reply
          )
        `)
        .eq('direction', 'inbound')
        .eq('conversations.workspace_id', workspace_id)
        .not('raw_payload', 'is', null)
        .limit(1000);

      if (statsError) {
        console.error('[PopulateSenderRules] Error fetching stats:', statsError);
      } else if (bucketStats) {
        // Group by sender domain
        const domainStats: Record<string, { auto: number; total: number; email: string }> = {};
        
        for (const msg of bucketStats) {
          const rawPayload = msg.raw_payload as any;
          const fromEmail = rawPayload?.from?.address || rawPayload?.from?.email || '';
          if (!fromEmail) continue;
          
          const domain = fromEmail.split('@')[1]?.toLowerCase();
          if (!domain) continue;
          
          const conv = msg.conversation as any;
          
          if (!domainStats[domain]) {
            domainStats[domain] = { auto: 0, total: 0, email: fromEmail };
          }
          
          domainStats[domain].total++;
          if (conv?.decision_bucket === 'auto_handled') {
            domainStats[domain].auto++;
          }
        }
        
        // Create rules for domains that are >80% auto-handled with >3 messages
        for (const [domain, stats] of Object.entries(domainStats)) {
          if (stats.total >= 3 && stats.auto / stats.total >= 0.8) {
            // Check if rule already exists
            const { data: existing } = await supabase
              .from('sender_rules')
              .select('id')
              .eq('workspace_id', workspace_id)
              .ilike('sender_pattern', `%${domain}%`)
              .maybeSingle();

            if (!existing) {
              const { error } = await supabase
                .from('sender_rules')
                .insert({
                  workspace_id,
                  sender_pattern: `@${domain}`,
                  default_classification: 'automated_notification',
                  default_requires_reply: false,
                  is_active: true,
                });

              if (!error) {
                learnedCount++;
                console.log(`[PopulateSenderRules] Learned rule for @${domain} (${stats.auto}/${stats.total} auto-handled)`);
              }
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      seeded_count: insertedCount,
      skipped_count: skippedCount,
      learned_count: learnedCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PopulateSenderRules] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
