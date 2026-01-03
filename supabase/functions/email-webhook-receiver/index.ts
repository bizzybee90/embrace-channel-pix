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
    const payload = await req.json();
    const eventType = payload.type || payload.event;

    console.log('[webhook-receiver] Received event:', eventType);

    // Only process email events
    if (!['message.created', 'message.updated', 'email.received', 'messageCreated'].includes(eventType)) {
      console.log('[webhook-receiver] Ignoring event type:', eventType);
      return new Response(JSON.stringify({ received: true, ignored: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const emailData = payload.data || payload.message || payload;
    const accountId = emailData.accountId || payload.accountId;

    console.log('[webhook-receiver] Processing email for account:', accountId);

    // Get workspace from account
    const { data: config } = await supabase
      .from('email_provider_configs')
      .select('workspace_id')
      .eq('account_id', accountId)
      .single();

    if (!config) {
      console.log('[webhook-receiver] Unknown account:', accountId);
      return new Response(JSON.stringify({ error: 'Unknown account' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[webhook-receiver] Found workspace:', config.workspace_id);

    // Save to queue immediately
    const { error: insertError } = await supabase.from('raw_emails').upsert({
      workspace_id: config.workspace_id,
      external_id: emailData.id || emailData.internetMessageId,
      thread_id: emailData.threadId || emailData.conversationId,
      from_email: emailData.from?.email || emailData.from?.address || emailData.from,
      from_name: emailData.from?.name,
      to_email: emailData.to?.[0]?.email || emailData.to?.[0]?.address || emailData.to,
      to_name: emailData.to?.[0]?.name,
      subject: emailData.subject,
      body_text: emailData.body || emailData.textBody || emailData.snippet || emailData.bodyPreview,
      body_html: emailData.htmlBody,
      folder: emailData.folder || emailData.labels?.[0] || 'INBOX',
      received_at: emailData.receivedAt || emailData.date || emailData.receivedDateTime,
      has_attachments: (emailData.attachments?.length || 0) > 0 || emailData.hasAttachments,
      status: 'pending',
    }, { onConflict: 'workspace_id,external_id', ignoreDuplicates: true });

    if (insertError) {
      console.error('[webhook-receiver] Insert error:', insertError);
    } else {
      console.log('[webhook-receiver] Email queued successfully');
    }

    // Update progress counter
    await supabase.rpc('increment_emails_received', { 
      p_workspace_id: config.workspace_id 
    });

    return new Response(JSON.stringify({ received: true, queued: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[webhook-receiver] Error:', error);
    return new Response(JSON.stringify({ received: true, error: 'logged' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
