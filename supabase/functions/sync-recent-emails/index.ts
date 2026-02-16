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
    const { workspaceId, maxPages = 5 } = await req.json();
    if (!workspaceId) throw new Error('workspaceId required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get email config
    const { data: config, error: configErr } = await supabase
      .from('email_provider_configs')
      .select('id, email_address, account_id')
      .eq('workspace_id', workspaceId)
      .limit(1)
      .single();

    if (configErr || !config) throw new Error('No email config found');

    // Get access token
    const { data: accessToken, error: tokenErr } = await supabase
      .rpc('get_decrypted_access_token', { p_config_id: config.id });

    if (tokenErr || !accessToken) throw new Error('Failed to get access token');

    const ownerEmail = config.email_address.toLowerCase();
    const ownerDomain = ownerEmail.split('@')[1];

    let totalFetched = 0;
    let totalInserted = 0;
    let pageToken: string | null = null;

    // Fetch recent emails page by page (newest first)
    for (let page = 0; page < maxPages; page++) {
      let url = `https://api.aurinko.io/v1/email/messages?limit=50`;
      if (pageToken) url += `&pageToken=${pageToken}`;

      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!resp.ok) {
        if (resp.status === 429) {
          console.log('Rate limited, stopping early');
          break;
        }
        throw new Error(`Aurinko API error: ${resp.status}`);
      }

      const data = await resp.json();
      const messages = data.records || data.value || [];
      pageToken = data.nextPageToken || null;
      totalFetched += messages.length;

      if (messages.length === 0) break;

      // Process each message
      for (const msg of messages) {
        const aurinkoId = String(msg.id);
        const fromEmail = (msg.from?.email || msg.from?.address || '').toLowerCase();
        const fromName = msg.from?.name || fromEmail.split('@')[0];
        const toEmails = (msg.to || []).map((t: any) => t.email || t.address).filter(Boolean);
        const subject = msg.subject || '';
        const receivedAt = msg.receivedDateTime || msg.sentDateTime || new Date().toISOString();
        const threadId = msg.threadId || msg.conversationId || aurinkoId;

        // Body extraction
        let body = msg.textBody || msg.text || msg.body?.text || '';
        const bodyHtml = msg.htmlBody || msg.body?.html || null;
        if (!body && bodyHtml) {
          body = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
        if (!body && msg.snippet) body = msg.snippet;

        // Direction
        const isOwn = fromEmail === ownerEmail || fromEmail.endsWith(`@${ownerDomain}`);
        const direction = isOwn ? 'outbound' : 'inbound';

        // Upsert into email_import_queue
        const { error: upsertErr } = await supabase
          .from('email_import_queue')
          .upsert({
            workspace_id: workspaceId,
            external_id: aurinkoId,
            from_email: fromEmail,
            from_name: fromName,
            to_emails: toEmails,
            subject,
            body: body.substring(0, 10000),
            body_html: bodyHtml,
            received_at: receivedAt,
            thread_id: threadId,
            direction,
            status: 'imported',
          }, {
            onConflict: 'workspace_id,external_id',
            ignoreDuplicates: true,
          });

        if (!upsertErr) totalInserted++;
      }

      console.log(`[sync-recent] Page ${page + 1}: fetched ${messages.length}, total inserted ${totalInserted}`);

      if (!pageToken) break;
    }

    // Now classify any unclassified emails
    const { count: unclassified } = await supabase
      .from('email_import_queue')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .is('category', null)
      .eq('status', 'imported');

    if (unclassified && unclassified > 0) {
      console.log(`[sync-recent] ${unclassified} unclassified emails, triggering classification`);
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
      fetch(`${SUPABASE_URL}/functions/v1/email-classify-bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ workspaceId }),
      }).catch(err => console.error('Classification trigger failed:', err));
    }

    return new Response(JSON.stringify({
      success: true,
      fetched: totalFetched,
      inserted: totalInserted,
      unclassified: unclassified || 0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[sync-recent] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
