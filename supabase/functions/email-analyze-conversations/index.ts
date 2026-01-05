import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspaceId } = await req.json();
    console.log('[analyze-conversations] Starting Phase 2 for:', workspaceId);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Update progress
    await supabase.from('email_import_progress').update({
      current_phase: 'analyzing',
      phase2_status: 'running',
      updated_at: new Date().toISOString()
    }).eq('workspace_id', workspaceId);

    // =========================================================
    // STEP 1: Find all conversations with both inbound & outbound
    // =========================================================
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        external_conversation_id,
        title,
        messages (
          id,
          direction,
          actor_type,
          actor_name,
          body,
          created_at,
          raw_payload
        )
      `)
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });

    if (convError) {
      console.error('[analyze-conversations] Error fetching conversations:', convError);
      throw convError;
    }

    // Get message direction counts for debugging
    const { data: directionCounts } = await supabase
      .from('messages')
      .select('direction')
      .in('conversation_id', (conversations || []).map(c => c.id));

    const inboundMsgs = (directionCounts || []).filter((m: any) => m.direction === 'inbound').length;
    const outboundMsgs = (directionCounts || []).filter((m: any) => m.direction === 'outbound').length;
    
    console.log(`[analyze-conversations] Message direction stats: ${inboundMsgs} inbound, ${outboundMsgs} outbound`);

    let conversationsWithReplies = 0;
    const conversationPairs: any[] = [];

    console.log(`[analyze-conversations] Found ${conversations?.length || 0} conversations`);

    for (const conv of conversations || []) {
      const inbound = (conv.messages || [])
        .filter((m: any) => m.direction === 'inbound')
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      
      const outbound = (conv.messages || [])
        .filter((m: any) => m.direction === 'outbound')
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      if (inbound.length > 0 && outbound.length > 0) {
        conversationsWithReplies++;
        console.log(`[analyze-conversations] Conv ${conv.id}: ${inbound.length} inbound, ${outbound.length} outbound - HAS PAIRS`);

        // Match each inbound with its reply
        for (const inMsg of inbound) {
          const reply = outbound.find((o: any) => 
            new Date(o.created_at) > new Date(inMsg.created_at)
          );

          if (reply) {
            const replyTimeHours = (new Date(reply.created_at).getTime() - 
              new Date(inMsg.created_at).getTime()) / (1000 * 60 * 60);

            conversationPairs.push({
              workspace_id: workspaceId,
              conversation_id: conv.id,
              inbound_message_id: inMsg.id,
              outbound_message_id: reply.id,
              inbound_body: inMsg.body,
              outbound_body: reply.body,
              inbound_type: inMsg.raw_payload?.classification?.email_type || 'unknown',
              reply_time_hours: replyTimeHours,
              reply_length: (reply.body || '').length,
              received_at: inMsg.created_at
            });
          }
        }
      } else if (inbound.length > 0 || outbound.length > 0) {
        // Log conversations that only have one direction
        console.log(`[analyze-conversations] Conv ${conv.id}: ${inbound.length} inbound, ${outbound.length} outbound - NO PAIRS`);
      }
    }

    console.log(`[analyze-conversations] Found ${conversationPairs.length} matched pairs from ${conversationsWithReplies} conversations with replies`);

    // =========================================================
    // STEP 2: Store conversation pairs for Phase 3
    // =========================================================
    if (conversationPairs.length > 0) {
      const { error } = await supabase.from('conversation_pairs').upsert(
        conversationPairs,
        { onConflict: 'workspace_id,inbound_message_id' }
      );
      if (error) console.error('[analyze-conversations] Upsert error:', error);
      else console.log(`[analyze-conversations] Stored ${conversationPairs.length} pairs`);
    }

    // =========================================================
    // STEP 3: Calculate aggregate analytics
    // =========================================================
    const analytics = calculateAnalytics(conversationPairs);

    await supabase.from('conversation_analytics').upsert({
      workspace_id: workspaceId,
      total_conversations: conversations?.length || 0,
      conversations_with_replies: conversationsWithReplies,
      total_pairs: conversationPairs.length,
      avg_reply_time_hours: analytics.avgReplyTime,
      reply_rate: analytics.replyRate,
      avg_reply_length: analytics.avgReplyLength,
      by_type: analytics.byType,
      updated_at: new Date().toISOString()
    }, { onConflict: 'workspace_id' });

    // =========================================================
    // STEP 4: Update progress and trigger Phase 3
    // =========================================================
    await supabase.from('email_import_progress').update({
      phase2_status: 'complete',
      phase2_completed_at: new Date().toISOString(),
      conversations_found: conversations?.length || 0,
      conversations_with_replies: conversationsWithReplies,
      current_phase: 'learning',
      updated_at: new Date().toISOString()
    }).eq('workspace_id', workspaceId);

    // Trigger Phase 3
    console.log('[analyze-conversations] Triggering Phase 3 (deep-learning)');
    await supabase.functions.invoke('email-deep-learning', {
      body: { workspaceId }
    });

    return new Response(JSON.stringify({
      success: true,
      conversations: conversations?.length || 0,
      withReplies: conversationsWithReplies,
      pairs: conversationPairs.length,
      messageStats: { inbound: inboundMsgs, outbound: outboundMsgs }
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[analyze-conversations] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function calculateAnalytics(pairs: any[]) {
  if (pairs.length === 0) {
    return { avgReplyTime: 0, replyRate: 0, avgReplyLength: 0, byType: {} };
  }

  const avgReplyTime = pairs.reduce((sum, p) => sum + (p.reply_time_hours || 0), 0) / pairs.length;
  const avgReplyLength = pairs.reduce((sum, p) => sum + (p.reply_length || 0), 0) / pairs.length;

  // Group by type
  const byType: Record<string, any> = {};
  for (const pair of pairs) {
    const type = pair.inbound_type || 'unknown';
    if (!byType[type]) {
      byType[type] = { count: 0, totalReplyTime: 0, totalReplyLength: 0 };
    }
    byType[type].count++;
    byType[type].totalReplyTime += pair.reply_time_hours || 0;
    byType[type].totalReplyLength += pair.reply_length || 0;
  }

  // Calculate averages per type
  for (const type of Object.keys(byType)) {
    byType[type].avgReplyTime = byType[type].totalReplyTime / byType[type].count;
    byType[type].avgReplyLength = byType[type].totalReplyLength / byType[type].count;
  }

  return { avgReplyTime, replyRate: 100, avgReplyLength, byType };
}
