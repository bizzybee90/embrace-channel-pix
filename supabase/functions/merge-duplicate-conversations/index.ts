import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Conversation {
  id: string;
  customer_id: string;
  channel: string;
  status: string;
  created_at: string;
  title: string | null;
}

interface MergeResult {
  customerId: string;
  channel: string;
  keptConversationId: string;
  mergedConversationIds: string[];
  messagesMoved: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's workspace
    const { data: userData } = await supabase
      .from('users')
      .select('workspace_id')
      .eq('id', user.id)
      .single();

    if (!userData?.workspace_id) {
      return new Response(JSON.stringify({ error: 'No workspace found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const workspaceId = userData.workspace_id;
    console.log('Starting duplicate conversation merge for workspace:', workspaceId);

    // Fetch all open conversations in workspace
    const { data: conversations, error: fetchError } = await supabase
      .from('conversations')
      .select('id, customer_id, channel, status, created_at, title')
      .eq('workspace_id', workspaceId)
      .in('status', ['new', 'open', 'pending'])
      .order('created_at', { ascending: true });

    if (fetchError) {
      throw fetchError;
    }

    console.log(`Found ${conversations?.length || 0} open conversations`);

    // Group conversations by customer_id + channel
    const groupMap = new Map<string, Conversation[]>();

    for (const conversation of conversations || []) {
      const key = `${conversation.customer_id}:${conversation.channel}`;
      const existing = groupMap.get(key) || [];
      existing.push(conversation);
      groupMap.set(key, existing);
    }

    const results: MergeResult[] = [];

    // Merge duplicate conversation groups
    for (const [key, group] of groupMap.entries()) {
      if (group.length > 1) {
        const [customerId, channel] = key.split(':');
        console.log(`Found ${group.length} duplicate conversations for customer ${customerId} on ${channel}`);
        
        const result = await mergeDuplicateConversations(supabase, group, customerId, channel);
        results.push(result);
      }
    }

    const totalMerged = results.reduce((sum, r) => sum + r.mergedConversationIds.length, 0);
    const totalMessagesMoved = results.reduce((sum, r) => sum + r.messagesMoved, 0);

    console.log(`Merge complete. Merged ${totalMerged} duplicate conversations, moved ${totalMessagesMoved} messages`);

    return new Response(
      JSON.stringify({
        success: true,
        totalConversationsMerged: totalMerged,
        totalMessagesMoved,
        details: results,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error merging conversations:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function mergeDuplicateConversations(
  supabase: any,
  group: Conversation[],
  customerId: string,
  channel: string
): Promise<MergeResult> {
  // Keep the oldest conversation (first in array since we sorted by created_at ascending)
  const canonical = group[0];
  const duplicates = group.slice(1);

  console.log(`Merging ${duplicates.length} duplicate conversations into conversation ${canonical.id}`);

  let totalMessagesMoved = 0;

  // Move all messages from duplicate conversations to canonical conversation
  for (const duplicate of duplicates) {
    const { error: updateError, count } = await supabase
      .from('messages')
      .update({ conversation_id: canonical.id })
      .eq('conversation_id', duplicate.id);

    if (updateError) {
      console.error(`Error moving messages from ${duplicate.id}:`, updateError);
    } else {
      console.log(`Moved ${count || 0} messages from ${duplicate.id} to ${canonical.id}`);
      totalMessagesMoved += count || 0;
    }
  }

  // Delete duplicate conversation records
  const duplicateIds = duplicates.map(d => d.id);
  const { error: deleteError } = await supabase
    .from('conversations')
    .delete()
    .in('id', duplicateIds);

  if (deleteError) {
    console.error('Error deleting duplicate conversations:', deleteError);
  } else {
    console.log(`Deleted ${duplicateIds.length} duplicate conversation records`);
  }

  return {
    customerId,
    channel,
    keptConversationId: canonical.id,
    mergedConversationIds: duplicateIds,
    messagesMoved: totalMessagesMoved,
  };
}
