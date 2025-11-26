import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Customer {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  created_at: string;
  workspace_id: string;
}

interface MergeResult {
  identifier: string;
  type: 'phone' | 'email';
  keptCustomerId: string;
  mergedCustomerIds: string[];
  conversationsMoved: number;
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
    console.log('Starting duplicate customer merge for workspace:', workspaceId);

    // Fetch all customers in workspace
    const { data: customers, error: fetchError } = await supabase
      .from('customers')
      .select('id, email, phone, name, created_at, workspace_id')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });

    if (fetchError) {
      throw fetchError;
    }

    console.log(`Found ${customers?.length || 0} total customers`);

    // Group customers by phone and email
    const phoneGroups = new Map<string, Customer[]>();
    const emailGroups = new Map<string, Customer[]>();

    for (const customer of customers || []) {
      if (customer.phone) {
        const existing = phoneGroups.get(customer.phone) || [];
        existing.push(customer);
        phoneGroups.set(customer.phone, existing);
      }
      if (customer.email) {
        const existing = emailGroups.get(customer.email) || [];
        existing.push(customer);
        emailGroups.set(customer.email, existing);
      }
    }

    const results: MergeResult[] = [];

    // Merge phone duplicates
    for (const [phone, group] of phoneGroups.entries()) {
      if (group.length > 1) {
        console.log(`Found ${group.length} duplicates for phone: ${phone}`);
        const result = await mergeDuplicateGroup(supabase, group, 'phone', phone);
        results.push(result);
      }
    }

    // Merge email duplicates (that weren't already merged by phone)
    for (const [email, group] of emailGroups.entries()) {
      if (group.length > 1) {
        // Check if these customers were already merged
        const stillExist = [];
        for (const customer of group) {
          const { data: exists } = await supabase
            .from('customers')
            .select('id')
            .eq('id', customer.id)
            .maybeSingle();
          if (exists) stillExist.push(customer);
        }

        if (stillExist.length > 1) {
          console.log(`Found ${stillExist.length} duplicates for email: ${email}`);
          const result = await mergeDuplicateGroup(supabase, stillExist, 'email', email);
          results.push(result);
        }
      }
    }

    const totalMerged = results.reduce((sum, r) => sum + r.mergedCustomerIds.length, 0);
    const totalConversationsMoved = results.reduce((sum, r) => sum + r.conversationsMoved, 0);

    console.log(`Merge complete. Merged ${totalMerged} duplicate customers, moved ${totalConversationsMoved} conversations`);

    return new Response(
      JSON.stringify({
        success: true,
        totalDuplicatesMerged: totalMerged,
        totalConversationsMoved,
        details: results,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error merging customers:', error);
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

async function mergeDuplicateGroup(
  supabase: any,
  group: Customer[],
  type: 'phone' | 'email',
  identifier: string
): Promise<MergeResult> {
  // Keep the oldest customer (first in array since we sorted by created_at ascending)
  const canonical = group[0];
  const duplicates = group.slice(1);

  console.log(`Merging ${duplicates.length} duplicates into customer ${canonical.id}`);

  let totalConversationsMoved = 0;

  // Move all conversations from duplicates to canonical customer
  for (const duplicate of duplicates) {
    const { error: updateError, count } = await supabase
      .from('conversations')
      .update({ customer_id: canonical.id })
      .eq('customer_id', duplicate.id);

    if (updateError) {
      console.error(`Error moving conversations from ${duplicate.id}:`, updateError);
    } else {
      console.log(`Moved ${count || 0} conversations from ${duplicate.id} to ${canonical.id}`);
      totalConversationsMoved += count || 0;
    }
  }

  // Delete duplicate customer records
  const duplicateIds = duplicates.map(d => d.id);
  const { error: deleteError } = await supabase
    .from('customers')
    .delete()
    .in('id', duplicateIds);

  if (deleteError) {
    console.error('Error deleting duplicate customers:', deleteError);
  } else {
    console.log(`Deleted ${duplicateIds.length} duplicate customer records`);
  }

  return {
    identifier,
    type,
    keptCustomerId: canonical.id,
    mergedCustomerIds: duplicateIds,
    conversationsMoved: totalConversationsMoved,
  };
}
