import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for Supabase Edge Functions
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// SMART IMPORT STRATEGY
const MAX_EMAILS = 10000; // Cap at 10k emails total
const MAX_AGE_DAYS = 180; // Only import last 6 months
const BATCH_SIZE = 200;
const DELAY_MS = 500;
const MAX_BATCHES_PER_INVOCATION = 40;
const EARLY_CLASSIFICATION_THRESHOLD = 1000; // Start classification after 1k emails

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

    // Check if we've already hit the cap
    if (totalFetched >= MAX_EMAILS) {
      console.log(`[historical-import] Already at cap (${totalFetched}), starting classification...`);
      await triggerClassification(supabase, workspaceId, totalFetched);
      return new Response(JSON.stringify({
        success: true,
        emailsFetched: totalFetched,
        message: `Import complete (hit ${MAX_EMAILS} cap), classification starting...`,
        hasMore: false
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[historical-import] ${isResuming ? 'Resuming' : 'Starting'} import, already fetched: ${totalFetched}`);

    // Calculate the date cutoff (6 months ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MAX_AGE_DAYS);
    const cutoffTimestamp = cutoffDate.toISOString();
    console.log(`[historical-import] Only importing emails after: ${cutoffTimestamp}`);

    // Create/update import progress
    await supabase.from('email_import_progress').upsert({
      workspace_id: workspaceId,
      current_phase: 'importing',
      phase1_status: 'running',
      started_at: isResuming ? undefined : new Date().toISOString(),
      emails_received: totalFetched,
      emails_classified: 0,
      last_error: null,
      last_import_batch_at: new Date().toISOString()
    }, { onConflict: 'workspace_id' });

    let batchCount = 0;
    let hasMoreEmails = true;
    let reachedCutoff = false;
    let reachedCap = false;
    let classificationTriggered = false;

    // PRIORITY: Fetch SENT folder first for voice learning
    const folders = isResuming ? ['INBOX'] : ['SENT', 'INBOX'];
    let currentFolderIndex = 0;

    while (hasMoreEmails && batchCount < MAX_BATCHES_PER_INVOCATION && !reachedCap) {
      const currentFolder = folders[currentFolderIndex] || 'INBOX';
      
      // Build Aurinko API URL - prioritize SENT folder and add date filter
      let url = `https://api.aurinko.io/v1/email/messages?limit=${BATCH_SIZE}`;
      
      // Add folder filter if not resuming
      if (!isResuming) {
        url += `&folder=${currentFolder}`;
      }
      
      // Add date filter for last 6 months
      url += `&after=${encodeURIComponent(cutoffTimestamp)}`;
      
      if (nextPageToken) {
        url += `&pageToken=${nextPageToken}`;
      }

      console.log(`[historical-import] Fetching batch ${batchCount + 1} from ${currentFolder}, total so far: ${totalFetched}`);

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${config.access_token}` }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[historical-import] Aurinko error:', response.status, errorText);
        
        if (response.status === 429) {
          console.log('[historical-import] Rate limited, saving state for resume...');
          await supabase.from('email_import_progress').update({
            aurinko_next_page_token: nextPageToken,
            last_error: 'Rate limited - will auto-resume in 60s',
            updated_at: new Date().toISOString()
          }).eq('workspace_id', workspaceId);
          
          // Schedule a retry
          EdgeRuntime.waitUntil((async () => {
            await new Promise(r => setTimeout(r, 60000));
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
        
        await supabase.from('email_import_progress').update({
          last_error: `Aurinko error: ${response.status} - ${errorText}`,
          updated_at: new Date().toISOString()
        }).eq('workspace_id', workspaceId);
        
        break;
      }

      const data = await response.json();
      const messages = data.records || data.messages || [];
      nextPageToken = data.nextPageToken || null;
      
      // Check if this folder is done
      if (!nextPageToken) {
        // Move to next folder if we have more
        currentFolderIndex++;
        if (currentFolderIndex < folders.length) {
          console.log(`[historical-import] Finished ${currentFolder}, moving to ${folders[currentFolderIndex]}`);
          nextPageToken = null; // Reset for new folder
        }
      }
      
      hasMoreEmails = !!nextPageToken || currentFolderIndex < folders.length;

      console.log(`[historical-import] Got ${messages.length} messages from ${currentFolder}, hasMore: ${hasMoreEmails}`);

      // Filter out emails older than cutoff and check cap
      const filteredMessages = messages.filter((msg: any) => {
        const emailDate = new Date(msg.receivedAt || msg.date);
        return emailDate >= cutoffDate;
      });

      // Check how many we can still add before hitting cap
      const remainingCapacity = MAX_EMAILS - totalFetched;
      const messagesToInsert = filteredMessages.slice(0, remainingCapacity);

      if (messagesToInsert.length < filteredMessages.length) {
        console.log(`[historical-import] Reached ${MAX_EMAILS} email cap!`);
        reachedCap = true;
      }

      // If we got fewer emails than requested after filtering, we've hit the date cutoff
      if (filteredMessages.length < messages.length) {
        console.log(`[historical-import] Reached 6-month cutoff in ${currentFolder}`);
        reachedCutoff = true;
      }

      // BULK INSERT
      if (messagesToInsert.length > 0) {
        const emailsToInsert = messagesToInsert.map((msg: any) => {
          const folder = msg.folder || msg.labelIds?.[0] || currentFolder;
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

      totalFetched += messagesToInsert.length;
      batchCount++;

      // Update progress
      await supabase.from('email_import_progress').update({
        emails_received: totalFetched,
        aurinko_next_page_token: nextPageToken,
        last_import_batch_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('workspace_id', workspaceId);

      // EARLY CLASSIFICATION: Start classification after 1000 emails (in background)
      if (totalFetched >= EARLY_CLASSIFICATION_THRESHOLD && !classificationTriggered) {
        console.log(`[historical-import] Hit ${EARLY_CLASSIFICATION_THRESHOLD} emails, triggering early classification in background...`);
        classificationTriggered = true;
        
        EdgeRuntime.waitUntil((async () => {
          const { error } = await supabase.functions.invoke('email-queue-processor', {
            body: { workspaceId }
          });
          if (error) {
            console.error('[historical-import] Failed to invoke early queue processor:', error);
          }
        })());
      }

      // Stop if we've hit cutoff for all folders
      if (reachedCutoff && !hasMoreEmails) {
        break;
      }

      // Delay between batches
      if (hasMoreEmails && batchCount < MAX_BATCHES_PER_INVOCATION && !reachedCap) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    // Check if we need to continue importing
    const shouldContinue = hasMoreEmails && !reachedCap && !reachedCutoff;
    
    if (shouldContinue) {
      console.log(`[historical-import] Reached batch limit at ${totalFetched} emails, scheduling continuation...`);
      
      EdgeRuntime.waitUntil((async () => {
        await new Promise(r => setTimeout(r, 500));
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

    // Import complete
    const reason = reachedCap ? `hit ${MAX_EMAILS} cap` : reachedCutoff ? 'reached 6-month cutoff' : 'all emails fetched';
    console.log(`[historical-import] Complete! Fetched ${totalFetched} emails (${reason}), finalizing classification...`);
    
    await triggerClassification(supabase, workspaceId, totalFetched);

    return new Response(JSON.stringify({
      success: true,
      emailsFetched: totalFetched,
      message: `Import complete (${reason}), classification ${classificationTriggered ? 'already running' : 'starting'}...`,
      hasMore: false,
      reason
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

async function triggerClassification(supabase: any, workspaceId: string, totalFetched: number) {
  await supabase.from('email_import_progress').update({
    current_phase: 'classifying',
    phase1_status: 'complete',
    phase1_completed_at: new Date().toISOString(),
    aurinko_next_page_token: null,
    last_error: null,
    updated_at: new Date().toISOString()
  }).eq('workspace_id', workspaceId);

  EdgeRuntime.waitUntil((async () => {
    console.log('[historical-import] Invoking final email-queue-processor...');
    const { error } = await supabase.functions.invoke('email-queue-processor', {
      body: { workspaceId }
    });
    if (error) {
      console.error('[historical-import] Failed to invoke queue processor:', error);
    }
  })());
}
