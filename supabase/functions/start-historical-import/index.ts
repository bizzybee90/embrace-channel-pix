import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for Supabase Edge Functions
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 200; // Increased from 100
const DELAY_MS = 500; // Reduced from 2000ms
const MAX_BATCHES_PER_INVOCATION = 40; // Increased from 20 (~8000 emails per invocation)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspaceId } = await req.json();
    console.log('[historical-import] Starting for workspace:', workspaceId);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get Aurinko credentials
    const { data: config } = await supabase
      .from('email_provider_configs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single();

    if (!config || !config.access_token) {
      return new Response(JSON.stringify({ error: 'No email connected' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get existing progress to check for resume token
    const { data: existingProgress } = await supabase
      .from('email_import_progress')
      .select('aurinko_next_page_token, emails_received')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    let nextPageToken: string | null = existingProgress?.aurinko_next_page_token || null;
    let totalFetched = existingProgress?.emails_received || 0;
    const isResuming = !!nextPageToken;

    console.log(`[historical-import] ${isResuming ? 'Resuming' : 'Starting'} import, already fetched: ${totalFetched}`);

    // Create/update import progress
    await supabase.from('email_import_progress').upsert({
      workspace_id: workspaceId,
      current_phase: 'importing',
      phase1_status: 'running',
      started_at: isResuming ? undefined : new Date().toISOString(),
      emails_received: totalFetched,
      emails_classified: 0,
      last_error: null, // Clear any previous errors on resume
      last_import_batch_at: new Date().toISOString()
    }, { onConflict: 'workspace_id' });

    let batchCount = 0;
    let hasMoreEmails = true;

    while (hasMoreEmails && batchCount < MAX_BATCHES_PER_INVOCATION) {
      // Build Aurinko API URL
      let url = `https://api.aurinko.io/v1/email/messages?limit=${BATCH_SIZE}`;
      if (nextPageToken) {
        url += `&pageToken=${nextPageToken}`;
      }

      console.log(`[historical-import] Fetching batch ${batchCount + 1}, total so far: ${totalFetched}`);

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${config.access_token}` }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[historical-import] Aurinko error:', response.status, errorText);
        
        if (response.status === 429) {
          // Rate limited - save state and let it be resumed later
          console.log('[historical-import] Rate limited, saving state for resume...');
          await supabase.from('email_import_progress').update({
            aurinko_next_page_token: nextPageToken,
            last_error: 'Rate limited - click Resume to continue',
            updated_at: new Date().toISOString()
          }).eq('workspace_id', workspaceId);
          
          // Schedule a retry by calling ourselves after a delay
          EdgeRuntime.waitUntil((async () => {
            await new Promise(r => setTimeout(r, 60000)); // Wait 60s
            await supabase.functions.invoke('start-historical-import', {
              body: { workspaceId }
            });
          })());
          
          return new Response(JSON.stringify({
            success: true,
            message: 'Rate limited, will resume in 60 seconds',
            emailsFetched: totalFetched,
            rateLimited: true
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // Other error - log and stop
        await supabase.from('email_import_progress').update({
          last_error: `Aurinko error: ${response.status} - ${errorText}`,
          updated_at: new Date().toISOString()
        }).eq('workspace_id', workspaceId);
        
        break;
      }

      const data = await response.json();
      const messages = data.records || data.messages || [];
      nextPageToken = data.nextPageToken || null;
      hasMoreEmails = !!nextPageToken;

      console.log(`[historical-import] Got ${messages.length} messages, hasMore: ${hasMoreEmails}`);

      // BULK INSERT - transform all messages at once
      if (messages.length > 0) {
        const emailsToInsert = messages.map((msg: any) => {
          const folder = msg.folder || msg.labelIds?.[0] || 'INBOX';
          return {
            workspace_id: workspaceId,
            external_id: msg.id,
            thread_id: msg.threadId,
            from_email: msg.from?.email || msg.from,
            from_name: msg.from?.name,
            to_email: msg.to?.[0]?.email || msg.to,
            to_name: msg.to?.[0]?.name,
            subject: msg.subject,
            body_text: msg.body || msg.textBody || msg.snippet,
            body_html: msg.htmlBody,
            folder: folder,
            received_at: msg.receivedAt || msg.date,
            has_attachments: (msg.attachments?.length || 0) > 0,
            status: 'pending'
          };
        });

        // Single bulk upsert instead of individual inserts
        const { error: insertError } = await supabase
          .from('raw_emails')
          .upsert(emailsToInsert, {
            onConflict: 'workspace_id,external_id',
            ignoreDuplicates: true
          });

        if (insertError) {
          console.error('[historical-import] Bulk insert error:', insertError);
        }
      }

      totalFetched += messages.length;
      batchCount++;

      // Update progress with current token for resume capability
      await supabase.from('email_import_progress').update({
        emails_received: totalFetched,
        aurinko_next_page_token: nextPageToken,
        last_import_batch_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('workspace_id', workspaceId);

      // Delay between batches to respect rate limits
      if (hasMoreEmails && batchCount < MAX_BATCHES_PER_INVOCATION) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    // Check if we need to continue importing or start classification
    if (hasMoreEmails) {
      console.log(`[historical-import] Reached batch limit at ${totalFetched} emails, scheduling continuation...`);
      
      // Continue importing in background
      EdgeRuntime.waitUntil((async () => {
        await new Promise(r => setTimeout(r, 500)); // Brief pause
        await supabase.functions.invoke('start-historical-import', {
          body: { workspaceId }
        });
      })());
      
      return new Response(JSON.stringify({
        success: true,
        emailsFetched: totalFetched,
        message: 'Import continuing in background...',
        hasMore: true
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Import complete - clear resume token and trigger classification
    console.log(`[historical-import] Complete! Fetched ${totalFetched} emails, triggering classification...`);
    
    await supabase.from('email_import_progress').update({
      current_phase: 'classifying',
      phase1_status: 'complete',
      phase1_completed_at: new Date().toISOString(),
      aurinko_next_page_token: null, // Clear resume token
      last_error: null,
      updated_at: new Date().toISOString()
    }).eq('workspace_id', workspaceId);

    // Trigger the queue processor to start classification
    EdgeRuntime.waitUntil((async () => {
      console.log('[historical-import] Invoking email-queue-processor...');
      const { error } = await supabase.functions.invoke('email-queue-processor', {
        body: { workspaceId }
      });
      if (error) {
        console.error('[historical-import] Failed to invoke queue processor:', error);
      }
    })());

    return new Response(JSON.stringify({
      success: true,
      emailsFetched: totalFetched,
      message: 'Import complete, classification starting...',
      hasMore: false
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[historical-import] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
