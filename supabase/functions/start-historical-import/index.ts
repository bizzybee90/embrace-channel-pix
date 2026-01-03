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

// Helper to safely extract email string from various formats
function extractEmail(emailObj: any): string {
  if (!emailObj) return '';
  if (typeof emailObj === 'string') return emailObj.toLowerCase();
  if (emailObj.email) return String(emailObj.email).toLowerCase();
  return '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspaceId, folder } = await req.json();
    
    // If no folder specified, kick off BOTH folders in parallel
    if (!folder) {
      console.log('[historical-import] Starting PARALLEL import for workspace:', workspaceId);
      
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      
      // Initialize progress
      await supabase.from('email_import_progress').upsert({
        workspace_id: workspaceId,
        current_phase: 'importing',
        phase1_status: 'running',
        started_at: new Date().toISOString(),
        emails_received: 0,
        sent_email_count: 0,
        inbox_email_count: 0,
        sent_import_complete: false,
        inbox_import_complete: false,
        emails_classified: 0,
        last_error: null,
        last_import_batch_at: new Date().toISOString()
      }, { onConflict: 'workspace_id' });
      
      // Start BOTH imports in parallel using background tasks
      EdgeRuntime.waitUntil((async () => {
        console.log('[historical-import] Starting SENT folder import...');
        await supabase.functions.invoke('start-historical-import', {
          body: { workspaceId, folder: 'SENT' }
        });
      })());
      
      EdgeRuntime.waitUntil((async () => {
        console.log('[historical-import] Starting INBOX folder import...');
        await supabase.functions.invoke('start-historical-import', {
          body: { workspaceId, folder: 'INBOX' }
        });
      })());
      
      return new Response(JSON.stringify({
        success: true,
        message: 'Parallel import started for SENT and INBOX folders',
        parallel: true
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Single folder import
    console.log('[historical-import] Starting folder import:', folder, 'for workspace:', workspaceId);

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

    // Get existing progress
    const { data: existingProgress } = await supabase
      .from('email_import_progress')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    // Get page token and count for this specific folder
    let pageToken: string | null = folder === 'SENT' 
      ? (existingProgress?.sent_next_page_token || null)
      : (existingProgress?.inbox_next_page_token || null);
    let folderComplete = folder === 'SENT'
      ? (existingProgress?.sent_import_complete || false)
      : (existingProgress?.inbox_import_complete || false);
    let folderCount = folder === 'SENT'
      ? (existingProgress?.sent_email_count || 0)
      : (existingProgress?.inbox_email_count || 0);
    let totalFetched = existingProgress?.emails_received || 0;

    // If this folder is already complete, nothing to do
    if (folderComplete) {
      console.log(`[historical-import] ${folder} folder already complete with ${folderCount} emails`);
      return new Response(JSON.stringify({
        success: true,
        folder,
        emailsFetched: folderCount,
        message: `${folder} folder already imported`,
        hasMore: false
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[historical-import] ${folder} - Starting from count: ${folderCount}, pageToken: ${!!pageToken}`);

    // Calculate the date cutoff (6 months ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MAX_AGE_DAYS);
    const cutoffTimestamp = cutoffDate.toISOString();

    let batchCount = 0;
    let reachedCutoff = false;
    let classificationTriggered = existingProgress?.phase2_status === 'running';

    while (batchCount < MAX_BATCHES_PER_INVOCATION) {
      // Build Aurinko API URL
      let url = `https://api.aurinko.io/v1/email/messages?limit=${BATCH_SIZE}&folder=${folder}`;
      url += `&after=${encodeURIComponent(cutoffTimestamp)}`;
      
      if (pageToken) {
        url += `&pageToken=${pageToken}`;
      }

      console.log(`[historical-import] ${folder} - Fetching batch ${batchCount + 1}, count so far: ${folderCount}`);

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${config.access_token}` }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[historical-import] ${folder} - Aurinko error:`, response.status, errorText);
        
        if (response.status === 429) {
          console.log(`[historical-import] ${folder} - Rate limited, saving state for resume...`);
          
          // Save current state for this folder
          const updateData: any = {
            last_error: `${folder} rate limited - will auto-resume in 60s`,
            updated_at: new Date().toISOString()
          };
          if (folder === 'SENT') {
            updateData.sent_next_page_token = pageToken;
            updateData.sent_email_count = folderCount;
          } else {
            updateData.inbox_next_page_token = pageToken;
            updateData.inbox_email_count = folderCount;
          }
          
          await supabase.from('email_import_progress').update(updateData).eq('workspace_id', workspaceId);
          
          // Schedule retry for this folder
          EdgeRuntime.waitUntil((async () => {
            await new Promise(r => setTimeout(r, 60000));
            await supabase.functions.invoke('start-historical-import', {
              body: { workspaceId, folder }
            });
          })());
          
          return new Response(JSON.stringify({
            success: true,
            folder,
            message: `${folder} rate limited, will resume in 60 seconds`,
            emailsFetched: folderCount,
            rateLimited: true
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        break;
      }

      const data = await response.json();
      const messages = data.records || data.messages || [];
      const nextPageToken = data.nextPageToken || null;
      pageToken = nextPageToken;

      console.log(`[historical-import] ${folder} - Got ${messages.length} messages, nextPage: ${!!nextPageToken}`);

      // Filter out emails older than cutoff
      const filteredMessages = messages.filter((msg: any) => {
        const emailDate = new Date(msg.receivedAt || msg.date);
        return emailDate >= cutoffDate;
      });

      if (filteredMessages.length < messages.length) {
        console.log(`[historical-import] ${folder} - Reached 6-month cutoff`);
        reachedCutoff = true;
      }

      // BULK INSERT with safe email extraction
      if (filteredMessages.length > 0) {
        const emailsToInsert = filteredMessages.map((msg: any) => {
          // Safely extract email addresses
          const fromEmail = extractEmail(msg.from);
          const toEmails = (msg.to || []).map((t: any) => extractEmail(t));
          
          // Determine direction for internal logic only (not stored on raw_emails)
          // Raw email direction can be inferred later from folder/from address if needed.
          const inferredDirection = (folder === 'SENT' || fromEmail === connectedEmail) ? 'outbound' : 'inbound';
          void inferredDirection;

          // Safe extraction for stored fields
          const storedFromEmail = msg.from?.email || (typeof msg.from === 'string' ? msg.from : null);
          const storedFromName = msg.from?.name || null;
          const storedToEmail = msg.to?.[0]?.email || (typeof msg.to?.[0] === 'string' ? msg.to?.[0] : null);
          const storedToName = msg.to?.[0]?.name || null;

          // raw_emails.from_email is REQUIRED in schema
          const requiredFromEmail = String(storedFromEmail || fromEmail || connectedEmail || 'unknown@unknown').toLowerCase();

          return {
            workspace_id: workspaceId,
            external_id: msg.id,
            thread_id: msg.threadId,
            from_email: requiredFromEmail,
            from_name: storedFromName,
            to_email: storedToEmail,
            to_name: storedToName,
            subject: msg.subject,
            body_text: msg.body || msg.textBody || msg.snippet,
            body_html: msg.htmlBody,
            folder,
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
          console.error(`[historical-import] ${folder} - Bulk insert error:`, insertError);
        }
      }

      folderCount += filteredMessages.length;
      batchCount++;

      // Update progress for this folder atomically
      const { data: currentProgress } = await supabase
        .from('email_import_progress')
        .select('sent_email_count, inbox_email_count, emails_received')
        .eq('workspace_id', workspaceId)
        .single();

      const newTotalFetched = folder === 'SENT'
        ? folderCount + (currentProgress?.inbox_email_count || 0)
        : (currentProgress?.sent_email_count || 0) + folderCount;

      const updateData: any = {
        emails_received: newTotalFetched,
        last_import_batch_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      if (folder === 'SENT') {
        updateData.sent_next_page_token = pageToken;
        updateData.sent_email_count = folderCount;
      } else {
        updateData.inbox_next_page_token = pageToken;
        updateData.inbox_email_count = folderCount;
      }

      await supabase.from('email_import_progress').update(updateData).eq('workspace_id', workspaceId);

      // Check if folder is complete
      if (!nextPageToken || reachedCutoff) {
        console.log(`[historical-import] ${folder} folder complete with ${folderCount} emails`);
        
        const completeUpdate: any = {
          updated_at: new Date().toISOString()
        };
        if (folder === 'SENT') {
          completeUpdate.sent_import_complete = true;
          completeUpdate.sent_next_page_token = null;
        } else {
          completeUpdate.inbox_import_complete = true;
          completeUpdate.inbox_next_page_token = null;
        }
        
        await supabase.from('email_import_progress').update(completeUpdate).eq('workspace_id', workspaceId);
        
        // Check if BOTH folders are now complete
        const { data: latestProgress } = await supabase
          .from('email_import_progress')
          .select('sent_import_complete, inbox_import_complete, sent_email_count, inbox_email_count')
          .eq('workspace_id', workspaceId)
          .single();
        
        if (latestProgress?.sent_import_complete && latestProgress?.inbox_import_complete) {
          console.log('[historical-import] BOTH folders complete, triggering classification...');
          const totalEmails = (latestProgress.sent_email_count || 0) + (latestProgress.inbox_email_count || 0);
          await triggerClassification(supabase, workspaceId, totalEmails);
        }
        
        return new Response(JSON.stringify({
          success: true,
          folder,
          emailsFetched: folderCount,
          message: `${folder} folder import complete`,
          hasMore: false
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // EARLY CLASSIFICATION: Start classification after threshold
      if (newTotalFetched >= EARLY_CLASSIFICATION_THRESHOLD && !classificationTriggered) {
        console.log(`[historical-import] Hit ${EARLY_CLASSIFICATION_THRESHOLD} emails, triggering early classification...`);
        classificationTriggered = true;
        
        EdgeRuntime.waitUntil((async () => {
          await supabase.functions.invoke('email-queue-processor', {
            body: { workspaceId }
          });
        })());
      }

      // Delay between batches
      if (batchCount < MAX_BATCHES_PER_INVOCATION) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    // Reached batch limit, schedule continuation for this folder
    console.log(`[historical-import] ${folder} - Reached batch limit at ${folderCount} emails, scheduling continuation...`);
    
    EdgeRuntime.waitUntil((async () => {
      await new Promise(r => setTimeout(r, 500));
      await supabase.functions.invoke('start-historical-import', {
        body: { workspaceId, folder }
      });
    })());
    
    return new Response(JSON.stringify({
      success: true,
      folder,
      emailsFetched: folderCount,
      message: `${folder} import continuing in background...`,
      hasMore: true
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
