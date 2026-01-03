import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 100;
const DELAY_MS = 2000;  // 2 seconds between batches

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

    // Create/update import progress
    await supabase.from('email_import_progress').upsert({
      workspace_id: workspaceId,
      current_phase: 'importing',
      phase1_status: 'running',
      started_at: new Date().toISOString(),
      emails_received: 0,
      emails_classified: 0
    }, { onConflict: 'workspace_id' });

    // Fetch emails from Aurinko in batches
    let nextPageToken: string | null = null;
    let totalFetched = 0;

    do {
      // Build Aurinko API URL - fetch both INBOX and SENT
      let url = `https://api.aurinko.io/v1/email/messages?limit=${BATCH_SIZE}`;
      if (nextPageToken) {
        url += `&pageToken=${nextPageToken}`;
      }

      console.log(`[historical-import] Fetching batch, total so far: ${totalFetched}`);

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${config.access_token}` }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[historical-import] Aurinko error:', errorText);
        
        if (response.status === 429) {
          // Rate limited - wait and retry
          console.log('[historical-import] Rate limited, waiting 60s...');
          await new Promise(r => setTimeout(r, 60000));
          continue;
        }
        break;
      }

      const data = await response.json();
      const messages = data.records || data.messages || [];
      nextPageToken = data.nextPageToken;

      // Insert emails into raw_emails queue
      for (const msg of messages) {
        const folder = msg.folder || msg.labelIds?.[0] || 'INBOX';
        
        await supabase.from('raw_emails').upsert({
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
        }, {
          onConflict: 'workspace_id,external_id',
          ignoreDuplicates: true
        });
      }

      totalFetched += messages.length;

      // Update progress
      await supabase.from('email_import_progress').update({
        emails_received: totalFetched,
        updated_at: new Date().toISOString()
      }).eq('workspace_id', workspaceId);

      // Delay between batches to respect rate limits
      if (nextPageToken) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }

    } while (nextPageToken);

    // Update status - now ready for classification
    await supabase.from('email_import_progress').update({
      current_phase: 'classifying',
      emails_received: totalFetched,
      updated_at: new Date().toISOString()
    }).eq('workspace_id', workspaceId);

    console.log(`[historical-import] Complete. Fetched ${totalFetched} emails, now queued for classification`);

    return new Response(JSON.stringify({
      success: true,
      emailsFetched: totalFetched,
      message: 'Emails queued for classification. Queue processor will handle classification automatically.'
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
