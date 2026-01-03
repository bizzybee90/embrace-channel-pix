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
    console.log('[get-mailbox-stats] Fetching stats for workspace:', workspaceId);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get email provider config with access token
    const { data: config, error: configError } = await supabase
      .from('email_provider_configs')
      .select('access_token, email_address, provider')
      .eq('workspace_id', workspaceId)
      .single();

    if (configError || !config?.access_token) {
      console.error('[get-mailbox-stats] No email config found:', configError);
      return new Response(JSON.stringify({ error: 'No email connected' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch folder stats from Aurinko
    const response = await fetch('https://api.aurinko.io/v1/email/folders', {
      headers: { 'Authorization': `Bearer ${config.access_token}` }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[get-mailbox-stats] Aurinko error:', response.status, errorText);
      
      if (response.status === 401) {
        return new Response(JSON.stringify({ error: 'Email token expired, please reconnect' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      return new Response(JSON.stringify({ error: 'Failed to fetch mailbox stats' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const foldersData = await response.json();
    const folders = foldersData.records || foldersData.folders || [];

    // Find INBOX and SENT folders
    let inboxCount = 0;
    let sentCount = 0;

    for (const folder of folders) {
      const name = (folder.name || folder.displayName || '').toUpperCase();
      const totalItems = folder.totalItems || folder.messagesTotal || folder.itemCount || 0;
      
      if (name === 'INBOX' || name === 'INBOUND') {
        inboxCount = totalItems;
      } else if (name === 'SENT' || name === 'SENT MAIL' || name === 'SENT ITEMS') {
        sentCount = totalItems;
      }
    }

    // Apply 6-month filter estimate (assume ~50% of emails are within 6 months)
    const estimatedInbox = Math.ceil(inboxCount * 0.5);
    const estimatedSent = Math.ceil(sentCount * 0.5);
    const estimatedTotal = estimatedInbox + estimatedSent;

    // Calculate time estimates based on observed speeds:
    // - Import + Classify: ~500 emails per 1.3 minutes (appears faster than expected)
    // - Phase 2/3 learning: ~8 minutes
    const emailsPerMinute = 500 / 1.3; // ~385 emails/minute
    const importClassifyMinutes = Math.ceil(estimatedTotal / emailsPerMinute);
    const learningMinutes = 8;
    const totalMinutes = importClassifyMinutes + learningMinutes;

    console.log(`[get-mailbox-stats] Raw counts - Inbox: ${inboxCount}, Sent: ${sentCount}`);
    console.log(`[get-mailbox-stats] Estimated (6mo) - Inbox: ${estimatedInbox}, Sent: ${estimatedSent}, Total: ${estimatedTotal}`);
    console.log(`[get-mailbox-stats] Time estimate: ${totalMinutes} minutes`);

    // Store estimates in progress table for later use
    await supabase.from('email_import_progress').upsert({
      workspace_id: workspaceId,
      current_phase: 'ready',
      estimated_total_emails: estimatedTotal,
      estimated_minutes: totalMinutes,
      inbox_email_count: estimatedInbox,
      sent_email_count: estimatedSent,
      updated_at: new Date().toISOString()
    }, { onConflict: 'workspace_id' });

    return new Response(JSON.stringify({
      success: true,
      rawCounts: {
        inbox: inboxCount,
        sent: sentCount,
        total: inboxCount + sentCount
      },
      estimatedCounts: {
        inbox: estimatedInbox,
        sent: estimatedSent,
        total: estimatedTotal
      },
      timeEstimate: {
        importClassifyMinutes,
        learningMinutes,
        totalMinutes
      },
      connectedEmail: config.email_address,
      provider: config.provider
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[get-mailbox-stats] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
