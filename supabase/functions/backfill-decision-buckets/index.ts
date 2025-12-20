import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Conversation {
  id: string;
  title: string | null;
  email_classification: string | null;
  category: string | null;
  urgency: string | null;
  requires_reply: boolean | null;
  is_escalated: boolean | null;
  status: string | null;
  decision_bucket: string | null;
  ai_draft_response: string | null;
  risk_level: string | null;
}

// Classification patterns that should be AUTO_HANDLED
const AUTO_HANDLED_CLASSIFICATIONS = [
  'marketing', 'newsletter', 'promotional', 'spam', 'notification',
  'receipt', 'confirmation', 'automated', 'no-reply', 'system',
  'job_alert', 'subscription', 'digest', 'update', 'alert'
];

// Title patterns that indicate noise (AUTO_HANDLED)
const NOISE_TITLE_PATTERNS = [
  /receipt/i, /payment.*confirm/i, /order.*confirm/i, /subscription/i,
  /newsletter/i, /digest/i, /weekly.*update/i, /monthly.*report/i,
  /job.*alert/i, /indeed/i, /linkedin.*notification/i, /unsubscribe/i,
  /automated/i, /do.*not.*reply/i, /no-reply/i, /noreply/i,
  /marketing/i, /promotional/i, /special.*offer/i, /discount/i,
  /reminder.*payment/i, /invoice.*paid/i, /payment.*received/i
];

// Patterns that indicate urgency (ACT_NOW)
const URGENT_PATTERNS = [
  /urgent/i, /emergency/i, /asap/i, /immediately/i, /critical/i,
  /complaint/i, /refund.*request/i, /cancel.*service/i, /legal/i,
  /insurance.*claim/i, /dispute/i, /angry/i, /frustrated/i
];

// Patterns that indicate quick wins
const QUICK_WIN_PATTERNS = [
  /question.*about/i, /quick.*question/i, /how.*do.*i/i, /can.*you.*help/i,
  /availability/i, /schedule/i, /book.*appointment/i, /quote.*request/i,
  /pricing/i, /what.*are.*your.*rates/i
];

function classifyConversation(conv: Conversation): {
  decision_bucket: string;
  why_this_needs_you: string;
  cognitive_load: string;
  risk_level: string;
} {
  const title = conv.title?.toLowerCase() || '';
  const classification = conv.email_classification?.toLowerCase() || '';
  const category = conv.category?.toLowerCase() || '';
  
  // Check for escalated/urgent items first → ACT_NOW
  if (conv.is_escalated) {
    return {
      decision_bucket: 'act_now',
      why_this_needs_you: 'This was escalated and needs your attention',
      cognitive_load: 'high',
      risk_level: conv.risk_level || 'retention'
    };
  }
  
  // Check urgent patterns → ACT_NOW
  if (URGENT_PATTERNS.some(p => p.test(title))) {
    return {
      decision_bucket: 'act_now',
      why_this_needs_you: 'Urgent language detected - requires immediate attention',
      cognitive_load: 'high',
      risk_level: 'retention'
    };
  }
  
  // Check if it's clearly noise → AUTO_HANDLED
  if (AUTO_HANDLED_CLASSIFICATIONS.some(c => classification.includes(c) || category.includes(c))) {
    return {
      decision_bucket: 'auto_handled',
      why_this_needs_you: 'Automated notification - no action needed',
      cognitive_load: 'low',
      risk_level: 'none'
    };
  }
  
  // Check noise title patterns → AUTO_HANDLED
  if (NOISE_TITLE_PATTERNS.some(p => p.test(title))) {
    return {
      decision_bucket: 'auto_handled',
      why_this_needs_you: 'Routine notification handled automatically',
      cognitive_load: 'low',
      risk_level: 'none'
    };
  }
  
  // Check if requires_reply is explicitly false → AUTO_HANDLED
  if (conv.requires_reply === false && !conv.is_escalated) {
    return {
      decision_bucket: 'auto_handled',
      why_this_needs_you: 'No reply needed - handled automatically',
      cognitive_load: 'low',
      risk_level: 'none'
    };
  }
  
  // Check quick win patterns → QUICK_WIN
  if (QUICK_WIN_PATTERNS.some(p => p.test(title))) {
    return {
      decision_bucket: 'quick_win',
      why_this_needs_you: 'Simple question - quick response will clear this',
      cognitive_load: 'low',
      risk_level: 'none'
    };
  }
  
  // If there's a draft response ready → QUICK_WIN
  if (conv.ai_draft_response && conv.requires_reply !== false) {
    return {
      decision_bucket: 'quick_win',
      why_this_needs_you: 'AI draft ready - review and send',
      cognitive_load: 'low',
      risk_level: 'none'
    };
  }
  
  // If status is resolved/closed → AUTO_HANDLED
  if (conv.status === 'resolved' || conv.status === 'closed') {
    return {
      decision_bucket: 'auto_handled',
      why_this_needs_you: 'Already resolved',
      cognitive_load: 'low',
      risk_level: 'none'
    };
  }
  
  // Default: if requires reply, it's a quick_win, otherwise auto_handled
  if (conv.requires_reply === true) {
    return {
      decision_bucket: 'quick_win',
      why_this_needs_you: 'Needs a response from you',
      cognitive_load: 'low',
      risk_level: 'none'
    };
  }
  
  // Final fallback: AUTO_HANDLED (not WAIT!)
  return {
    decision_bucket: 'auto_handled',
    why_this_needs_you: 'No action required',
    cognitive_load: 'low',
    risk_level: 'none'
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body for options
    let options = { dryRun: false, limit: 1000, onlyWait: true };
    try {
      const body = await req.json();
      options = { ...options, ...body };
    } catch {
      // Use defaults if no body
    }

    console.log(`[backfill] Starting with options:`, options);

    // Fetch conversations to reclassify
    let query = supabase
      .from('conversations')
      .select('id, title, email_classification, category, urgency, requires_reply, is_escalated, status, decision_bucket, ai_draft_response, risk_level')
      .order('created_at', { ascending: false })
      .limit(options.limit);

    // Only target WAIT bucket if specified
    if (options.onlyWait) {
      query = query.eq('decision_bucket', 'wait');
    }

    const { data: conversations, error: fetchError } = await query;

    if (fetchError) {
      console.error('[backfill] Error fetching conversations:', fetchError);
      throw fetchError;
    }

    console.log(`[backfill] Found ${conversations?.length || 0} conversations to process`);

    if (!conversations || conversations.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No conversations to backfill',
        stats: { total: 0, updated: 0 }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Classify each conversation
    const updates: Array<{
      id: string;
      old_bucket: string | null;
      new_bucket: string;
      why_this_needs_you: string;
      cognitive_load: string;
      risk_level: string;
    }> = [];

    for (const conv of conversations) {
      const result = classifyConversation(conv);
      
      // Only update if bucket changed
      if (result.decision_bucket !== conv.decision_bucket) {
        updates.push({
          id: conv.id,
          old_bucket: conv.decision_bucket,
          new_bucket: result.decision_bucket,
          why_this_needs_you: result.why_this_needs_you,
          cognitive_load: result.cognitive_load,
          risk_level: result.risk_level
        });
      }
    }

    console.log(`[backfill] ${updates.length} conversations need bucket updates`);

    // Calculate stats before updating
    const stats = {
      total: conversations.length,
      needsUpdate: updates.length,
      byNewBucket: {
        act_now: updates.filter(u => u.new_bucket === 'act_now').length,
        quick_win: updates.filter(u => u.new_bucket === 'quick_win').length,
        auto_handled: updates.filter(u => u.new_bucket === 'auto_handled').length,
        wait: updates.filter(u => u.new_bucket === 'wait').length
      }
    };

    console.log(`[backfill] Stats:`, stats);

    // If dry run, just return stats
    if (options.dryRun) {
      return new Response(JSON.stringify({
        success: true,
        dryRun: true,
        message: `Would update ${updates.length} conversations`,
        stats,
        sampleUpdates: updates.slice(0, 10)
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Perform updates in batches
    let updated = 0;
    const batchSize = 50;
    
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      for (const update of batch) {
        const { error: updateError } = await supabase
          .from('conversations')
          .update({
            decision_bucket: update.new_bucket,
            why_this_needs_you: update.why_this_needs_you,
            cognitive_load: update.cognitive_load,
            risk_level: update.risk_level
          })
          .eq('id', update.id);

        if (updateError) {
          console.error(`[backfill] Error updating ${update.id}:`, updateError);
        } else {
          updated++;
        }
      }
      
      console.log(`[backfill] Processed batch ${Math.floor(i / batchSize) + 1}, updated ${updated} so far`);
    }

    console.log(`[backfill] Complete! Updated ${updated} conversations`);

    return new Response(JSON.stringify({
      success: true,
      message: `Successfully updated ${updated} conversations`,
      stats: {
        ...stats,
        actuallyUpdated: updated
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('[backfill] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
