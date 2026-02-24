import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rate-limit.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // --- Auth validation ---
    const { validateAuth, AuthError, authErrorResponse } = await import('../_shared/auth.ts');
    let body: { conversation_id?: string; content?: string; workspace_id?: string };
    try {
      body = await req.clone().json();
    } catch {
      body = {};
    }
    try {
      await validateAuth(req, body.workspace_id);
    } catch (authErr: unknown) {
      if (authErr instanceof AuthError) return authErrorResponse(authErr);
      throw authErr;
    }

    // --- Validate input ---
    const conversationId = body.conversation_id;
    const content = body.content;
    const workspaceId = body.workspace_id;

    if (!conversationId) throw new Error('conversation_id is required');
    if (!workspaceId) throw new Error('workspace_id is required');
    if (!content || content.trim().length === 0) throw new Error('content is required and cannot be empty');

    // --- Rate limiting ---
    const rateLimited = await checkRateLimit(workspaceId, RATE_LIMITS['send-reply']);
    if (rateLimited) return rateLimited;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- Fetch conversation with customer ---
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        id, title, status, channel, workspace_id, external_conversation_id, metadata,
        customer:customers(id, email, name)
      `)
      .eq('id', conversationId)
      .eq('workspace_id', workspaceId)
      .single();

    if (convError || !conversation) {
      throw new Error(`Conversation not found: ${convError?.message || conversationId}`);
    }

    const channel = conversation.channel || 'email';
    const customer = Array.isArray(conversation.customer) ? conversation.customer[0] : conversation.customer;

    if (!customer) throw new Error(`No customer associated with conversation ${conversationId}`);

    // --- Channel-specific send ---
    switch (channel) {
      case 'email': {
        if (!customer.email) {
          throw new Error(`Customer has no email address for conversation ${conversationId}`);
        }

        // Get email provider config
        const { data: emailConfig, error: configError } = await supabase
          .from('email_provider_configs')
          .select('id, account_id, email_address')
          .eq('workspace_id', workspaceId)
          .single();

        if (configError || !emailConfig) {
          throw new Error('No email provider configured. Please connect your email first.');
        }

        // Get access token
        const { data: accessToken, error: tokenError } = await supabase
          .rpc('get_decrypted_access_token', { config_id: emailConfig.id });

        if (tokenError || !accessToken) {
          throw new Error('Email access token missing. Please reconnect your email.');
        }

        // Fetch the latest inbound message for threading headers
        const { data: latestInbound } = await supabase
          .from('messages')
          .select('external_id, external_thread_id')
          .eq('conversation_id', conversationId)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const subject = conversation.title || 'Re: Your inquiry';
        const emailPayload: Record<string, unknown> = {
          to: [{ email: customer.email, name: customer.name || '' }],
          subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
          body: content,
          bodyType: 'text',
        };

        // Thread into the existing conversation
        const threadId = latestInbound?.external_thread_id
          || conversation.external_conversation_id
          || (conversation.metadata as Record<string, unknown>)?.aurinko_thread_id;

        if (threadId) {
          emailPayload.threadId = threadId;
        }

        // Set In-Reply-To header for proper email threading
        if (latestInbound?.external_id) {
          emailPayload.inReplyTo = latestInbound.external_id;
        }

        // Send via Aurinko
        const aurinkoResponse = await fetch('https://api.aurinko.io/v1/email/messages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(emailPayload),
        });

        if (!aurinkoResponse.ok) {
          const errorBody = await aurinkoResponse.text();
          if (aurinkoResponse.status === 401) {
            throw new Error('Email access token expired. Please reconnect your email account.');
          }
          throw new Error(`Aurinko API error ${aurinkoResponse.status}: ${errorBody}`);
        }

        const aurinkoData = await aurinkoResponse.json();
        const externalMessageId = aurinkoData.id;

        // Save outbound message
        const { data: savedMessage, error: messageError } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            direction: 'outbound',
            channel: 'email',
            body: content,
            actor_type: 'agent',
            actor_name: emailConfig.email_address,
            from_email: emailConfig.email_address,
            to_email: customer.email,
            external_id: externalMessageId ? String(externalMessageId) : null,
            external_thread_id: threadId ? String(threadId) : null,
            config_id: emailConfig.id,
            is_ai_draft: false,
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (messageError) {
          console.error('[send-reply] Warning: Failed to save message:', messageError);
        }

        // Update conversation status to resolved
        await supabase
          .from('conversations')
          .update({
            status: 'resolved',
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversationId);

        // Fire-and-forget: mark email as read in Gmail
        fetch(`${supabaseUrl}/functions/v1/mark-email-read`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({ conversationId, markAsRead: true }),
        }).catch((e) => console.warn('[send-reply] mark-email-read failed:', e));

        return new Response(JSON.stringify({
          success: true,
          message_id: savedMessage?.id || null,
          external_id: externalMessageId || null,
          duration_ms: Date.now() - startTime,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'sms':
        throw new Error('SMS sending is not yet implemented. Coming soon via Twilio.');

      case 'whatsapp':
        throw new Error('WhatsApp sending is not yet implemented. Coming soon via Twilio/WhatsApp Business API.');

      default:
        throw new Error(`Unsupported channel: ${channel}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[send-reply] Error:', errorMessage);
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
      duration_ms: Date.now() - startTime,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
