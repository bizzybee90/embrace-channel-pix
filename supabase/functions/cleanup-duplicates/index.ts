import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { step, workspaceId } = await req.json();

    if (!workspaceId) {
      return new Response(
        JSON.stringify({ error: 'workspaceId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[cleanup-duplicates] Running step ${step} for workspace ${workspaceId}`);

    let result: { deleted: number; remaining: number; message: string };

    switch (step) {
      case 1: {
        // Step 1: Delete orphaned messages (messages without valid conversation)
        console.log('[cleanup-duplicates] Step 1: Deleting orphaned messages...');
        
        const { data: deleted, error } = await supabase.rpc('cleanup_orphaned_messages', {
          batch_limit: 50000
        });

        if (error) {
          // If RPC doesn't exist, do direct delete
          console.log('[cleanup-duplicates] RPC not found, using direct delete...');
          
          const { count: deletedCount, error: deleteError } = await supabase
            .from('messages')
            .delete()
            .is('conversation_id', null)
            .select('*', { count: 'exact', head: true });

          if (deleteError) throw deleteError;

          const { count: remaining } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true });

          result = {
            deleted: deletedCount || 0,
            remaining: remaining || 0,
            message: `Deleted ${deletedCount || 0} orphaned messages. ${remaining} messages remaining.`
          };
        } else {
          const { count: remaining } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true });

          result = {
            deleted: deleted || 0,
            remaining: remaining || 0,
            message: `Deleted ${deleted || 0} orphaned messages. ${remaining} messages remaining.`
          };
        }
        break;
      }

      case 2: {
        // Step 2: Delete duplicate conversations (keep oldest per thread)
        console.log('[cleanup-duplicates] Step 2: Deleting duplicate conversations...');
        
        // Find conversations that are duplicates (same external_conversation_id)
        const { data: duplicates, error: findError } = await supabase
          .from('conversations')
          .select('id, external_conversation_id, created_at')
          .eq('workspace_id', workspaceId)
          .not('external_conversation_id', 'is', null)
          .order('created_at', { ascending: true })
          .limit(1000);

        if (findError) throw findError;

        // Group by external_conversation_id and find duplicates
        const seenThreads = new Map<string, string>();
        const toDelete: string[] = [];

        for (const conv of duplicates || []) {
          if (conv.external_conversation_id) {
            if (seenThreads.has(conv.external_conversation_id)) {
              toDelete.push(conv.id);
            } else {
              seenThreads.set(conv.external_conversation_id, conv.id);
            }
          }
        }

        let deletedCount = 0;
        if (toDelete.length > 0) {
          // Delete messages first
          const { error: msgError } = await supabase
            .from('messages')
            .delete()
            .in('conversation_id', toDelete.slice(0, 100));

          if (msgError) console.error('[cleanup-duplicates] Error deleting messages:', msgError);

          // Then delete conversations
          const { count, error: deleteError } = await supabase
            .from('conversations')
            .delete()
            .in('id', toDelete.slice(0, 100))
            .select('*', { count: 'exact', head: true });

          if (deleteError) throw deleteError;
          deletedCount = count || 0;
        }

        const { count: remaining } = await supabase
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId);

        result = {
          deleted: deletedCount,
          remaining: remaining || 0,
          message: `Deleted ${deletedCount} duplicate conversations. ${remaining} remaining. Run again if more exist.`
        };
        break;
      }

      case 3: {
        // Step 3: Delete duplicate customers (keep oldest per email)
        console.log('[cleanup-duplicates] Step 3: Deleting duplicate customers...');
        
        const { data: customers, error: findError } = await supabase
          .from('customers')
          .select('id, email, created_at')
          .eq('workspace_id', workspaceId)
          .not('email', 'is', null)
          .order('created_at', { ascending: true })
          .limit(1000);

        if (findError) throw findError;

        const seenEmails = new Map<string, string>();
        const toDelete: string[] = [];

        for (const cust of customers || []) {
          if (cust.email) {
            const emailLower = cust.email.toLowerCase();
            if (seenEmails.has(emailLower)) {
              toDelete.push(cust.id);
            } else {
              seenEmails.set(emailLower, cust.id);
            }
          }
        }

        let deletedCount = 0;
        if (toDelete.length > 0) {
          const { count, error: deleteError } = await supabase
            .from('customers')
            .delete()
            .in('id', toDelete.slice(0, 100))
            .select('*', { count: 'exact', head: true });

          if (deleteError) throw deleteError;
          deletedCount = count || 0;
        }

        const { count: remaining } = await supabase
          .from('customers')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId);

        result = {
          deleted: deletedCount,
          remaining: remaining || 0,
          message: `Deleted ${deletedCount} duplicate customers. ${remaining} remaining.`
        };
        break;
      }

      case 4: {
        // Step 4: Clear email import queue
        console.log('[cleanup-duplicates] Step 4: Clearing email import queue...');
        
        const { count: deleted, error } = await supabase
          .from('email_import_queue')
          .delete()
          .eq('workspace_id', workspaceId)
          .select('*', { count: 'exact', head: true });

        if (error) throw error;

        result = {
          deleted: deleted || 0,
          remaining: 0,
          message: `Cleared ${deleted || 0} email queue items.`
        };
        break;
      }

      case 5: {
        // Step 5: Reset email import progress
        console.log('[cleanup-duplicates] Step 5: Resetting email import progress...');
        
        const { error } = await supabase
          .from('email_import_progress')
          .delete()
          .eq('workspace_id', workspaceId);

        if (error) throw error;

        result = {
          deleted: 1,
          remaining: 0,
          message: 'Email import progress reset. Ready for fresh import.'
        };
        break;
      }

      default: {
        // Get current counts
        const [convCount, msgCount, custCount] = await Promise.all([
          supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
          supabase.from('messages').select('*', { count: 'exact', head: true }),
          supabase.from('customers').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
        ]);

        result = {
          deleted: 0,
          remaining: 0,
          message: `Current counts - Conversations: ${convCount.count}, Messages: ${msgCount.count}, Customers: ${custCount.count}`
        };
      }
    }

    console.log(`[cleanup-duplicates] Result:`, result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[cleanup-duplicates] Error:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
