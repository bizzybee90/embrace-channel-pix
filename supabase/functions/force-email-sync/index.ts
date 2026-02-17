import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspaceId, maxMessages = 50 } = await req.json();
    if (!workspaceId) throw new Error('workspaceId required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: config } = await supabase
      .from('email_provider_configs')
      .select('id, email_address')
      .eq('workspace_id', workspaceId)
      .single();

    if (!config) throw new Error('No email config');

    const { data: accessToken } = await supabase
      .rpc('get_decrypted_access_token', { p_config_id: config.id });

    if (!accessToken) throw new Error('No access token');

    const ownerEmail = config.email_address.toLowerCase();
    const ownerDomain = ownerEmail.split('@')[1];

    // Get list of recent message IDs
    const listResp = await fetch(`https://api.aurinko.io/v1/email/messages?limit=${maxMessages}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!listResp.ok) throw new Error(`List failed: ${listResp.status}`);
    const listData = await listResp.json();
    const messageStubs = listData.records || [];

    console.log(`[force-sync] Got ${messageStubs.length} message stubs`);

    // Check which ones we already have
    const externalIds = messageStubs.map((m: any) => String(m.id));
    const { data: existing } = await supabase
      .from('email_import_queue')
      .select('external_id')
      .eq('workspace_id', workspaceId)
      .in('external_id', externalIds);

    const existingSet = new Set((existing || []).map(e => e.external_id));
    const newIds = externalIds.filter((id: string) => !existingSet.has(id));

    console.log(`[force-sync] ${existingSet.size} already exist, ${newIds.length} new to fetch`);

    if (newIds.length === 0) {
      return new Response(JSON.stringify({ success: true, inserted: 0, message: 'All emails already synced' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch full details for new messages (throttled)
    let inserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < newIds.length; i++) {
      try {
        const msgResp = await fetch(`https://api.aurinko.io/v1/email/messages/${newIds[i]}`, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        if (msgResp.status === 429) {
          console.log('[force-sync] Rate limited, stopping');
          break;
        }

        if (!msgResp.ok) {
          errors.push(`${newIds[i]}: HTTP ${msgResp.status}`);
          continue;
        }

        const msg = await msgResp.json();
        const fromEmail = (msg.from?.email || '').toLowerCase();
        const fromName = msg.from?.name || fromEmail.split('@')[0];
        const toEmails = (msg.to || []).map((t: any) => t.email || t.address).filter(Boolean);
        const subject = msg.subject || '';
        const receivedAt = msg.receivedDateTime || msg.sentDateTime || new Date().toISOString();
        const threadId = msg.threadId || msg.conversationId || String(msg.id);

        let body = msg.textBody || msg.text || msg.body?.text || '';
        const bodyHtml = msg.htmlBody || msg.body?.html || null;
        if (!body && bodyHtml) {
          body = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
        if (!body && msg.snippet) body = msg.snippet;

        const isOwn = fromEmail === ownerEmail || fromEmail.endsWith(`@${ownerDomain}`);
        const direction = isOwn ? 'outbound' : 'inbound';

        const { error: insertErr } = await supabase
          .from('email_import_queue')
          .insert({
            workspace_id: workspaceId,
            config_id: config.id,
            external_id: String(msg.id),
            from_email: fromEmail || 'unknown@unknown.com',
            from_name: fromName || 'Unknown',
            to_emails: toEmails,
            subject,
            body: body.substring(0, 10000),
            body_html: bodyHtml,
            received_at: receivedAt,
            thread_id: threadId,
            direction,
            status: 'processed',
          });

        if (insertErr) {
          if (insertErr.code === '23505') {
            // duplicate, skip
          } else {
            errors.push(`${msg.id}: ${insertErr.message}`);
          }
        } else {
          inserted++;
        }

        // Throttle: 5 per second
        if ((i + 1) % 5 === 0) await sleep(1000);
      } catch (e) {
        errors.push(`${newIds[i]}: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }

    console.log(`[force-sync] Inserted ${inserted} new emails, ${errors.length} errors`);
    if (errors.length > 0) console.log('[force-sync] Errors:', errors.slice(0, 5));

    // Now create conversations for new inbound emails
    // Trigger hydrate-inbox for just these new ones
    if (inserted > 0) {
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
      fetch(`${SUPABASE_URL}/functions/v1/hydrate-inbox`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ workspaceId, daysBack: 7, limit: 200, force: true }),
      }).catch(err => console.error('Hydrate trigger failed:', err));
    }

    return new Response(JSON.stringify({
      success: true,
      total: messageStubs.length,
      alreadyExisted: existingSet.size,
      inserted,
      errors: errors.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[force-sync] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
