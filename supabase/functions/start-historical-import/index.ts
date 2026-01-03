import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// SEQUENTIAL IMPORT STRATEGY: SENT first, then INBOX to avoid rate limiting
const MAX_AGE_DAYS = 180;
const BATCH_SIZE = 100; // Reduced from 200
const DELAY_MS = 800; // Increased from 500
const MAX_BATCHES_PER_INVOCATION = 30; // Reduced from 40
const EARLY_CLASSIFICATION_THRESHOLD = 1000;
const PARALLEL_CLASSIFICATION_WORKERS = 3; // Reduced from 5

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
    const { workspaceId, folder, runId } = await req.json();
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // If no folder specified, start SEQUENTIAL import (SENT first)
    if (!folder) {
      console.log('[historical-import] Starting SEQUENTIAL import for workspace:', workspaceId);
      
      // Generate a new run_id for this import session
      const newRunId = crypto.randomUUID();
      
      // Initialize progress with the new run_id
      await supabase.from('email_import_progress').upsert({
        workspace_id: workspaceId,
        run_id: newRunId,
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
        resume_after: null,
        paused_reason: null,
        current_import_folder: 'SENT',
        last_import_batch_at: new Date().toISOString()
      }, { onConflict: 'workspace_id' });
      
      // Start with SENT folder only (INBOX will be started after SENT completes)
      const { error } = await supabase.functions.invoke('start-historical-import', {
        body: { workspaceId, folder: 'SENT', runId: newRunId }
      });
      
      if (error) {
        console.error('[historical-import] Failed to start SENT import:', error);
      }
      
      return new Response(JSON.stringify({
        success: true,
        message: 'Sequential import started (SENT first, then INBOX)',
        runId: newRunId,
        sequential: true
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Single folder import
    console.log('[historical-import] Starting folder import:', folder, 'for workspace:', workspaceId, 'runId:', runId);

    // Check if this is still the active run
    const { data: currentProgress } = await supabase
      .from('email_import_progress')
      .select('run_id, resume_after')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    
    // If runId doesn't match current run_id, this is a stale task - exit silently
    if (runId && currentProgress?.run_id && currentProgress.run_id !== runId) {
      console.log('[historical-import] Stale run detected, exiting. Expected:', currentProgress.run_id, 'Got:', runId);
      return new Response(JSON.stringify({
        success: false,
        message: 'Stale run - ignoring',
        stale: true
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

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
    
    const activeRunId = runId || existingProgress?.run_id;

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

    // If this folder is already complete, check if we need to start INBOX
    if (folderComplete) {
      console.log(`[historical-import] ${folder} folder already complete with ${folderCount} emails`);
      
      // If SENT is complete but INBOX isn't, start INBOX
      if (folder === 'SENT' && !existingProgress?.inbox_import_complete) {
        console.log('[historical-import] SENT complete, starting INBOX...');
        
        await supabase.from('email_import_progress').update({
          current_import_folder: 'INBOX',
          updated_at: new Date().toISOString()
        }).eq('workspace_id', workspaceId);
        
        await supabase.functions.invoke('start-historical-import', {
          body: { workspaceId, folder: 'INBOX', runId: activeRunId }
        });
      }
      
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

    // Update current folder being imported
    await supabase.from('email_import_progress').update({
      current_import_folder: folder,
      updated_at: new Date().toISOString()
    }).eq('workspace_id', workspaceId);

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
          console.log(`[historical-import] ${folder} - Rate limited, setting resume_after...`);
          
          // Set resume_after to 90 seconds from now (let frontend handle resume)
          const resumeAfter = new Date(Date.now() + 90000).toISOString();
          
          const updateData: any = {
            resume_after: resumeAfter,
            paused_reason: 'rate_limit',
            last_error: `Rate limited on ${folder} - auto-resume scheduled`,
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
          
          // DO NOT schedule backend retry - let frontend handle it
          return new Response(JSON.stringify({
            success: true,
            folder,
            message: `${folder} rate limited - frontend will resume`,
            emailsFetched: folderCount,
            rateLimited: true,
            resumeAfter
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
          const fromEmail = extractEmail(msg.from);
          const storedFromEmail = msg.from?.email || (typeof msg.from === 'string' ? msg.from : null);
          const storedFromName = msg.from?.name || null;
          const storedToEmail = msg.to?.[0]?.email || (typeof msg.to?.[0] === 'string' ? msg.to?.[0] : null);
          const storedToName = msg.to?.[0]?.name || null;

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
      const { data: latestProgress } = await supabase
        .from('email_import_progress')
        .select('sent_email_count, inbox_email_count, emails_received, run_id')
        .eq('workspace_id', workspaceId)
        .single();
      
      // Check run_id again to ensure we're still the active run
      if (activeRunId && latestProgress?.run_id && latestProgress.run_id !== activeRunId) {
        console.log('[historical-import] Run superseded, exiting gracefully');
        return new Response(JSON.stringify({
          success: false,
          message: 'Run superseded by new import',
          stale: true
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const newTotalFetched = folder === 'SENT'
        ? folderCount + (latestProgress?.inbox_email_count || 0)
        : (latestProgress?.sent_email_count || 0) + folderCount;

      const updateData: any = {
        emails_received: newTotalFetched,
        last_import_batch_at: new Date().toISOString(),
        last_error: null,
        resume_after: null,
        paused_reason: null,
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
          updated_at: new Date().toISOString(),
          last_error: null,
          resume_after: null,
          paused_reason: null
        };
        if (folder === 'SENT') {
          completeUpdate.sent_import_complete = true;
          completeUpdate.sent_next_page_token = null;
        } else {
          completeUpdate.inbox_import_complete = true;
          completeUpdate.inbox_next_page_token = null;
        }
        
        await supabase.from('email_import_progress').update(completeUpdate).eq('workspace_id', workspaceId);
        
        // SEQUENTIAL: If SENT is complete, start INBOX
        if (folder === 'SENT') {
          console.log('[historical-import] SENT complete, starting INBOX...');
          
          await supabase.from('email_import_progress').update({
            current_import_folder: 'INBOX'
          }).eq('workspace_id', workspaceId);
          
          // Start INBOX import
          await supabase.functions.invoke('start-historical-import', {
            body: { workspaceId, folder: 'INBOX', runId: activeRunId }
          });
          
          return new Response(JSON.stringify({
            success: true,
            folder: 'SENT',
            emailsFetched: folderCount,
            message: 'SENT folder complete, INBOX starting...',
            hasMore: false
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // INBOX complete - trigger classification
        console.log('[historical-import] INBOX complete, triggering classification...');
        await triggerClassification(supabase, workspaceId, newTotalFetched);
        
        return new Response(JSON.stringify({
          success: true,
          folder,
          emailsFetched: folderCount,
          message: 'All folders imported, classification started',
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
        
        // Just invoke once, not in background
        await supabase.functions.invoke('email-queue-processor', {
          body: { workspaceId }
        });
      }

      // Delay between batches
      if (batchCount < MAX_BATCHES_PER_INVOCATION) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    // Reached batch limit, schedule continuation for this folder
    console.log(`[historical-import] ${folder} - Reached batch limit at ${folderCount} emails, scheduling continuation...`);
    
    // Continue with same folder
    await supabase.functions.invoke('start-historical-import', {
      body: { workspaceId, folder, runId: activeRunId }
    });
    
    return new Response(JSON.stringify({
      success: true,
      folder,
      emailsFetched: folderCount,
      message: `${folder} import continuing...`,
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
    resume_after: null,
    paused_reason: null,
    updated_at: new Date().toISOString()
  }).eq('workspace_id', workspaceId);

  // Spawn workers
  console.log(`[historical-import] Invoking ${PARALLEL_CLASSIFICATION_WORKERS} classification workers...`);
  
  for (let i = 0; i < PARALLEL_CLASSIFICATION_WORKERS; i++) {
    await supabase.functions.invoke('email-queue-processor', {
      body: { workspaceId }
    });
  }
}
