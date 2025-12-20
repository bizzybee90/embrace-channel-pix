import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// COMPUTE SENDER BEHAVIOUR STATS FROM HISTORY
// Analyzes reply rates and patterns by sender
// ============================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspace_id } = await req.json();
    
    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'Missing workspace_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    console.log('[ComputeSenderStats] Computing stats for workspace:', workspace_id);

    // Get all inbound messages with their conversation outcomes
    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select(`
        id,
        raw_payload,
        created_at,
        conversation:conversations!inner(
          id,
          workspace_id,
          status,
          decision_bucket,
          first_response_at,
          created_at
        )
      `)
      .eq('direction', 'inbound')
      .eq('conversations.workspace_id', workspace_id)
      .not('raw_payload', 'is', null)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (msgError) {
      throw new Error(`Error fetching messages: ${msgError.message}`);
    }

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        stats_updated: 0,
        message: 'No messages to analyze'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[ComputeSenderStats] Analyzing ${messages.length} messages`);

    // Group by sender domain
    const domainStats: Record<string, {
      total: number;
      replied: number;
      ignored: number;
      responseTimes: number[];
      lastInteraction: Date;
      emails: Set<string>;
    }> = {};

    for (const msg of messages) {
      const rawPayload = msg.raw_payload as any;
      const fromEmail = rawPayload?.from?.address || rawPayload?.from?.email || '';
      if (!fromEmail) continue;

      const domain = fromEmail.split('@')[1]?.toLowerCase();
      if (!domain) continue;

      const conv = msg.conversation as any;
      
      if (!domainStats[domain]) {
        domainStats[domain] = {
          total: 0,
          replied: 0,
          ignored: 0,
          responseTimes: [],
          lastInteraction: new Date(0),
          emails: new Set(),
        };
      }

      const stats = domainStats[domain];
      stats.total++;
      stats.emails.add(fromEmail.toLowerCase());
      
      const msgDate = new Date(msg.created_at);
      if (msgDate > stats.lastInteraction) {
        stats.lastInteraction = msgDate;
      }

      // Check if conversation got a reply
      if (conv?.first_response_at) {
        stats.replied++;
        // Calculate response time in minutes
        const responseTime = (new Date(conv.first_response_at).getTime() - new Date(conv.created_at).getTime()) / 60000;
        if (responseTime > 0 && responseTime < 10080) { // < 1 week
          stats.responseTimes.push(responseTime);
        }
      } else if (conv?.status === 'resolved' || conv?.decision_bucket === 'auto_handled') {
        stats.ignored++;
      }
    }

    // Upsert stats for each domain
    let upsertedCount = 0;
    for (const [domain, stats] of Object.entries(domainStats)) {
      if (stats.total < 2) continue; // Skip domains with too few messages

      const avgResponseTime = stats.responseTimes.length > 0
        ? stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length
        : null;

      // Calculate VIP score (higher = more important)
      // Based on reply rate + response speed + volume
      const replyRate = stats.replied / stats.total;
      const speedFactor = avgResponseTime ? Math.max(0, 1 - (avgResponseTime / 1440)) : 0; // Faster = higher
      const volumeFactor = Math.min(stats.total / 20, 1); // More volume = higher, capped at 20
      const vipScore = (replyRate * 0.5 + speedFactor * 0.3 + volumeFactor * 0.2);

      // Suggest bucket based on behaviour
      let suggestedBucket: string | null = null;
      if (replyRate < 0.2) {
        suggestedBucket = 'auto_handled';
      } else if (replyRate > 0.8 || vipScore > 0.7) {
        suggestedBucket = 'act_now';
      } else if (replyRate > 0.5) {
        suggestedBucket = 'quick_win';
      }

      const { error } = await supabase
        .from('sender_behaviour_stats')
        .upsert({
          workspace_id,
          sender_domain: domain,
          total_messages: stats.total,
          replied_count: stats.replied,
          ignored_count: stats.ignored,
          avg_response_time_minutes: avgResponseTime,
          last_interaction_at: stats.lastInteraction.toISOString(),
          vip_score: vipScore,
          suggested_bucket: suggestedBucket,
        }, {
          onConflict: 'workspace_id,sender_domain'
        });

      if (!error) {
        upsertedCount++;
      } else {
        console.error(`[ComputeSenderStats] Error upserting ${domain}:`, error);
      }
    }

    console.log(`[ComputeSenderStats] Updated ${upsertedCount} domain stats`);

    return new Response(JSON.stringify({
      success: true,
      domains_analyzed: Object.keys(domainStats).length,
      stats_updated: upsertedCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ComputeSenderStats] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
