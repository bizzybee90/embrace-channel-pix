import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for Supabase Edge Functions
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// SMART IMPORT STRATEGY - NO CAPS, IMPORT ALL WITHIN 6 MONTHS
const MAX_AGE_DAYS = 180; // Only import last 6 months
const BATCH_SIZE = 200;
const DELAY_MS = 500;
const MAX_BATCHES_PER_INVOCATION = 40;
const EARLY_CLASSIFICATION_THRESHOLD = 1000;
const PARALLEL_CLASSIFICATION_WORKERS = 5;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspaceId, resumeFolder } = await req.json();
    console.log('[historical-import] Starting for workspace:', workspaceId, resumeFolder ? `(resuming ${resumeFolder})` : '');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get Aurinko credentials and email address
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

    const connectedEmail = config.email_address?.toLowerCase();
    console.log('[historical-import] Connected email:', connectedEmail);

    // Get existing progress to check for resume state
    const { data: existingProgress } = await supabase
      .from('email_import_progress')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    // Determine current folder and page tokens based on resume state
    let currentFolder = resumeFolder || existingProgress?.current_import_folder || 'SENT';
    let sentPageToken: string | null = existingProgress?.sent_next_page_token || null;
    let inboxPageToken: string | null = existingProgress?.inbox_next_page_token || null;
    let sentComplete = existingProgress?.sent_import_complete || false;
    let inboxComplete = existingProgress?.inbox_import_complete || false;
    let totalFetched = existingProgress?.emails_received || 0;
    let sentCount = existingProgress?.sent_email_count || 0;
    let inboxCount = existingProgress?.inbox_email_count || 0;
    
    const isResuming = !!(sentPageToken || inboxPageToken || sentComplete);

    // If SENT is already complete, switch to INBOX
    if (sentComplete && !inboxComplete) {
      currentFolder = 'INBOX';
    }

    // If both are complete, we're done
    if (sentComplete && inboxComplete) {
      console.log('[historical-import] Both folders complete, triggering classification...');
      await triggerClassification(supabase, workspaceId, totalFetched);
      return new Response(JSON.stringify({
        success: true,
        emailsFetched: totalFetched,
        message: 'Import complete, classification starting...',
        hasMore: false
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[historical-import] ${isResuming ? 'Resuming' : 'Starting'} import from ${currentFolder}, already fetched: ${totalFetched} (SENT: ${sentCount}, INBOX: ${inboxCount})`);

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
      current_import_folder: currentFolder,
      started_at: isResuming ? undefined : new Date().toISOString(),
      emails_received: totalFetched,
      sent_email_count: sentCount,
      inbox_email_count: inboxCount,
      sent_import_complete: sentComplete,
      inbox_import_complete: inboxComplete,
      emails_classified: 0,
      last_error: null,
      last_import_batch_at: new Date().toISOString()
    }, { onConflict: 'workspace_id' });

    let batchCount = 0;
    let reachedCutoff = false;
    let classificationTriggered = false;

    while (batchCount < MAX_BATCHES_PER_INVOCATION) {
      // Get the correct page token for current folder
      const pageToken = currentFolder === 'SENT' ? sentPageToken : inboxPageToken;
      
      // Build Aurinko API URL
      let url = `https://api.aurinko.io/v1/email/messages?limit=${BATCH_SIZE}&folder=${currentFolder}`;
      url += `&after=${encodeURIComponent(cutoffTimestamp)}`;
      
      if (pageToken) {
        url += `&pageToken=${pageToken}`;
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
          
          // Save current state with proper folder tracking
          await supabase.from('email_import_progress').update({
            current_import_folder: currentFolder,
            sent_next_page_token: currentFolder === 'SENT' ? pageToken : sentPageToken,
            inbox_next_page_token: currentFolder === 'INBOX' ? pageToken : inboxPageToken,
            sent_import_complete: sentComplete,
            inbox_import_complete: inboxComplete,
            sent_email_count: sentCount,
            inbox_email_count: inboxCount,
            last_error: 'Rate limited - will auto-resume in 60s',
            updated_at: new Date().toISOString()
          }).eq('workspace_id', workspaceId);
          
          // Schedule retry
          EdgeRuntime.waitUntil((async () => {
            await new Promise(r => setTimeout(r, 60000));
            await supabase.functions.invoke('start-historical-import', {
              body: { workspaceId, resumeFolder: currentFolder }
            });
          })());
          
          return new Response(JSON.stringify({
            success: true,
            message: 'Rate limited, will resume in 60 seconds',
            emailsFetched: totalFetched,
            currentFolder,
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
      const nextPageToken = data.nextPageToken || null;
      
      // Update the correct page token
      if (currentFolder === 'SENT') {
        sentPageToken = nextPageToken;
      } else {
        inboxPageToken = nextPageToken;
      }

      console.log(`[historical-import] Got ${messages.length} messages from ${currentFolder}, nextPage: ${!!nextPageToken}`);

      // Filter out emails older than cutoff
      const filteredMessages = messages.filter((msg: any) => {
        const emailDate = new Date(msg.receivedAt || msg.date);
        return emailDate >= cutoffDate;
      });

      if (filteredMessages.length < messages.length) {
        console.log(`[historical-import] Reached 6-month cutoff in ${currentFolder}`);
        reachedCutoff = true;
      }

      // BULK INSERT
      if (filteredMessages.length > 0) {
        const emailsToInsert = filteredMessages.map((msg: any) => {
          // Determine direction based on email addresses
          const fromEmail = (msg.from?.email || msg.from || '').toLowerCase();
          const toEmails = (msg.to || []).map((t: any) => (t.email || t || '').toLowerCase());
          
          let direction = 'inbound';
          if (currentFolder === 'SENT' || fromEmail === connectedEmail) {
            direction = 'outbound';
          }
          
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
            folder: currentFolder,
            direction, // Store direction in raw_emails
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

      totalFetched += filteredMessages.length;
      if (currentFolder === 'SENT') {
        sentCount += filteredMessages.length;
      } else {
        inboxCount += filteredMessages.length;
      }
      batchCount++;

      // Check if current folder is complete
      if (!nextPageToken || reachedCutoff) {
        if (currentFolder === 'SENT') {
          sentComplete = true;
          console.log(`[historical-import] SENT folder complete with ${sentCount} emails. Moving to INBOX...`);
          currentFolder = 'INBOX';
          reachedCutoff = false; // Reset for next folder
        } else {
          inboxComplete = true;
          console.log(`[historical-import] INBOX folder complete with ${inboxCount} emails.`);
        }
      }

      // Update progress
      await supabase.from('email_import_progress').update({
        emails_received: totalFetched,
        current_import_folder: currentFolder,
        sent_next_page_token: sentPageToken,
        inbox_next_page_token: inboxPageToken,
        sent_import_complete: sentComplete,
        inbox_import_complete: inboxComplete,
        sent_email_count: sentCount,
        inbox_email_count: inboxCount,
        last_import_batch_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('workspace_id', workspaceId);

      // EARLY CLASSIFICATION: Start classification after threshold
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

      // Check if both folders are complete
      if (sentComplete && inboxComplete) {
        break;
      }

      // Delay between batches
      if (batchCount < MAX_BATCHES_PER_INVOCATION) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    // Check if we need to continue importing
    const shouldContinue = !sentComplete || !inboxComplete;
    
    if (shouldContinue && batchCount >= MAX_BATCHES_PER_INVOCATION) {
      console.log(`[historical-import] Reached batch limit at ${totalFetched} emails, scheduling continuation...`);
      
      EdgeRuntime.waitUntil((async () => {
        await new Promise(r => setTimeout(r, 500));
        await supabase.functions.invoke('start-historical-import', {
          body: { workspaceId, resumeFolder: currentFolder }
        });
      })());
      
      return new Response(JSON.stringify({
        success: true,
        emailsFetched: totalFetched,
        sentCount,
        inboxCount,
        currentFolder,
        message: 'Import continuing in background...',
        hasMore: true
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Import complete - both folders done
    console.log(`[historical-import] Complete! Fetched ${totalFetched} emails (SENT: ${sentCount}, INBOX: ${inboxCount}), finalizing classification...`);
    
    await triggerClassification(supabase, workspaceId, totalFetched);

    return new Response(JSON.stringify({
      success: true,
      emailsFetched: totalFetched,
      sentCount,
      inboxCount,
      message: `Import complete, classification ${classificationTriggered ? 'already running' : 'starting'}...`,
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

async function triggerClassification(supabase: any, workspaceId: string, totalFetched: number) {
  await supabase.from('email_import_progress').update({
    current_phase: 'classifying',
    phase1_status: 'complete',
    phase1_completed_at: new Date().toISOString(),
    sent_next_page_token: null,
    inbox_next_page_token: null,
    last_error: null,
    updated_at: new Date().toISOString()
  }).eq('workspace_id', workspaceId);

  // Spawn PARALLEL_CLASSIFICATION_WORKERS workers
  EdgeRuntime.waitUntil((async () => {
    console.log(`[historical-import] Invoking ${PARALLEL_CLASSIFICATION_WORKERS} parallel classification workers...`);
    
    const workers = [];
    for (let i = 0; i < PARALLEL_CLASSIFICATION_WORKERS; i++) {
      workers.push(
        supabase.functions.invoke('email-queue-processor', {
          body: { workspaceId }
        })
      );
    }
    
    const results = await Promise.allSettled(workers);
    const errors = results.filter(r => r.status === 'rejected');
    if (errors.length > 0) {
      console.error('[historical-import] Some workers failed:', errors);
    }
  })());
}
