import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendRequest {
  conversationId: string;
  channel: 'sms' | 'whatsapp' | 'email' | 'webchat';
  to: string;
  message: string;
  metadata?: Record<string, any>;
  attachments?: Array<{
    name: string;
    path: string;
    type: string;
  }>;
  skipMessageLog?: boolean;
}

// Send email via Gmail API or Aurinko-connected email
async function sendViaGmail(
  sendRequest: SendRequest,
  supabase: any
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    
    // Get conversation to find workspace and original recipient
    const { data: conversation } = await supabase
      .from('conversations')
      .select('workspace_id, external_conversation_id, metadata')
      .eq('id', sendRequest.conversationId)
      .single();

    if (!conversation) {
      return { success: false, error: 'Conversation not found' };
    }

    // Determine which email address to send FROM
    // Priority: metadata.original_recipient_email > sendRequest.metadata.fromEmail > config default
    const originalRecipientEmail = conversation.metadata?.original_recipient_email;
    console.log('Original recipient email from metadata:', originalRecipientEmail);

    // First try Gmail config
    const { data: gmailConfig } = await supabase
      .from('gmail_channel_configs')
      .select('*')
      .eq('workspace_id', conversation.workspace_id)
      .maybeSingle();

    // Also check Aurinko email config
    const { data: emailConfig } = await supabase
      .from('email_provider_configs')
      .select('*')
      .eq('workspace_id', conversation.workspace_id)
      .maybeSingle();

    if (!gmailConfig && !emailConfig) {
      console.log('No email config found, will use fallback');
      return { success: false, error: 'Email not configured' };
    }

    // Determine the from address
    let fromAddress: string;
    if (originalRecipientEmail) {
      // Use the original address the customer emailed
      // Verify it's either the primary or an alias of our config
      const config = gmailConfig || emailConfig;
      const allAddresses = [
        config.email_address?.toLowerCase(),
        ...(emailConfig?.aliases || []).map((a: string) => a.toLowerCase())
      ].filter(Boolean);
      
      if (allAddresses.includes(originalRecipientEmail.toLowerCase())) {
        fromAddress = originalRecipientEmail;
        console.log('Using original recipient address as from:', fromAddress);
      } else {
        fromAddress = config.email_address;
        console.log('Original recipient not in our addresses, using default:', fromAddress);
      }
    } else {
      fromAddress = gmailConfig?.email_address || emailConfig?.email_address;
      console.log('No original recipient, using default from:', fromAddress);
    }

    // For now, use Gmail config if available (direct Gmail OAuth)
    if (gmailConfig) {
      // Refresh token if needed
      let accessToken = gmailConfig.access_token;
      if (new Date(gmailConfig.token_expires_at) < new Date()) {
        accessToken = await refreshGmailToken(gmailConfig.refresh_token, supabase, gmailConfig.id);
      }

      // Get email settings for signature
      const { data: emailSettings } = await supabase
        .from('email_settings')
        .select('*')
        .eq('workspace_id', conversation.workspace_id)
        .maybeSingle();

      // Build email with signature
      const htmlBody = buildEmailWithSignature(sendRequest.message, emailSettings);
      
      // Get thread ID for reply
      const threadId = conversation.external_conversation_id?.replace('gmail:', '') || null;

      // Build raw email with correct from address
      const rawEmail = buildRawEmail({
        to: sendRequest.to,
        from: fromAddress,
        subject: sendRequest.metadata?.subject || 'Re: Your inquiry',
        htmlBody,
        textBody: sendRequest.message,
        threadId,
        inReplyTo: conversation.metadata?.gmail_message_id,
      });

      // Send via Gmail API
      const sendUrl = `https://www.googleapis.com/gmail/v1/users/me/messages/send`;

      const response = await fetch(sendUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw: rawEmail,
          threadId: threadId || undefined,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Gmail API error:', response.status, errorText);
        return { success: false, error: `Gmail error: ${response.status}` };
      }

      const result = await response.json();
      console.log('Email sent via Gmail:', result.id);

      return { success: true, messageId: result.id };
    }

    // If no Gmail config but we have Aurinko config, note that sending via Aurinko would require additional implementation
    // For now, fall back to Postmark
    console.log('No Gmail config, Aurinko email sending not yet implemented');
    return { success: false, error: 'Gmail not configured for sending' };
  } catch (error) {
    console.error('Gmail send error:', error);
    return { success: false, error: String(error) };
  }
}

async function refreshGmailToken(refreshToken: string, supabase: any, configId: string): Promise<string> {
  const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
  const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(`Token refresh failed: ${data.error}`);
  }

  const tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabase
    .from('gmail_channel_configs')
    .update({ access_token: data.access_token, token_expires_at: tokenExpiresAt })
    .eq('id', configId);

  return data.access_token;
}

function buildEmailWithSignature(message: string, settings: any): string {
  const signature = settings?.signature_html || '';
  
  // Convert plain text message to HTML paragraphs
  const htmlMessage = message
    .split('\n')
    .map(line => `<p style="margin: 0 0 10px 0; font-family: Arial, sans-serif; font-size: 14px; color: #333;">${line || '&nbsp;'}</p>`)
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
    </head>
    <body style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.5;">
      ${htmlMessage}
      ${signature ? `<br><br>${signature}` : ''}
    </body>
    </html>
  `;
}

function buildRawEmail(opts: {
  to: string;
  from: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  threadId?: string | null;
  inReplyTo?: string;
}): string {
  const boundary = `boundary_${Date.now()}`;
  
  let headers = [
    `To: ${opts.to}`,
    `From: ${opts.from}`,
    `Subject: ${opts.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  if (opts.inReplyTo) {
    headers.push(`In-Reply-To: <${opts.inReplyTo}>`);
    headers.push(`References: <${opts.inReplyTo}>`);
  }

  const email = [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    opts.textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    opts.htmlBody,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  // Base64url encode
  return btoa(email)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioPhoneNumber = Deno.env.get('TWILIO_PHONE_NUMBER');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
      throw new Error('Twilio credentials not configured');
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const sendRequest: SendRequest = await req.json();

    // Get conversation to check automation level
    const { data: conversation } = await supabase
      .from('conversations')
      .select('workspace_id, customer_id')
      .eq('id', sendRequest.conversationId)
      .single();

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Check automation level for this channel
    let automationLevel = 'draft_only'; // Default
    
    if (sendRequest.channel === 'email') {
      // Check email provider config first
      const { data: emailConfig } = await supabase
        .from('email_provider_configs')
        .select('automation_level')
        .eq('workspace_id', conversation.workspace_id)
        .limit(1)
        .maybeSingle();
      
      if (emailConfig?.automation_level) {
        automationLevel = emailConfig.automation_level;
      }
    } else {
      // Check workspace channel config for SMS/WhatsApp
      const { data: channelConfig } = await supabase
        .from('workspace_channels')
        .select('automation_level')
        .eq('workspace_id', conversation.workspace_id)
        .eq('channel', sendRequest.channel)
        .maybeSingle();
      
      if (channelConfig?.automation_level) {
        automationLevel = channelConfig.automation_level;
      }
    }

    console.log('[SendResponse] Channel:', sendRequest.channel, 'Automation level:', automationLevel);

    // If review_required, route to review queue instead of sending
    if (automationLevel === 'review_required' && !sendRequest.metadata?.bypassReview) {
      console.log('[SendResponse] Review required - routing to review queue');
      
      await supabase
        .from('conversations')
        .update({
          needs_review: true,
          ai_draft_response: sendRequest.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', sendRequest.conversationId);

      return new Response(
        JSON.stringify({
          success: true,
          routed_to_review: true,
          message: 'Message routed to review queue'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // If disabled, reject the send
    if (automationLevel === 'disabled' && !sendRequest.metadata?.manualSend) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Automation is disabled for this channel'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    console.log('Sending message:', {
      channel: sendRequest.channel,
      to: sendRequest.to,
      messagePreview: sendRequest.message.substring(0, 50)
    });

    let messageId: string;
    let messageStatus: string;

    // Handle email channel via Gmail API
    if (sendRequest.channel === 'email') {
      const result = await sendViaGmail(sendRequest, supabase);
      if (result.success) {
        messageId = result.messageId!;
        messageStatus = 'sent';
        console.log('Email sent via Gmail:', messageId);
      } else {
        // Fallback to Postmark if Gmail not configured
        const postmarkApiKey = Deno.env.get('POSTMARK_API_KEY');
        if (!postmarkApiKey) {
          throw new Error('Email not configured - connect Gmail in settings');
        }

        // Prepare attachments for Postmark
        const postmarkAttachments = [];
        if (sendRequest.attachments && sendRequest.attachments.length > 0) {
          for (const attachment of sendRequest.attachments) {
            try {
              const { data: fileData, error: downloadError } = await supabase.storage
                .from('message-attachments')
                .download(attachment.path);

              if (downloadError) {
                console.error('Error downloading attachment:', downloadError);
                continue;
              }

              const arrayBuffer = await fileData.arrayBuffer();
              const bytes = new Uint8Array(arrayBuffer);
              let binary = '';
              for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64 = btoa(binary);

              postmarkAttachments.push({
                Name: attachment.name,
                Content: base64,
                ContentType: attachment.type
              });
            } catch (error) {
              console.error('Error processing attachment for email:', error);
            }
          }
        }

        console.log('Sending email via Postmark (fallback)...');
        const emailBody: any = {
          From: 'support@bizzybee.io',
          To: sendRequest.to,
          Subject: sendRequest.metadata?.subject || 'Re: Your inquiry',
          TextBody: sendRequest.message,
          MessageStream: 'outbound',
        };

        if (postmarkAttachments.length > 0) {
          emailBody.Attachments = postmarkAttachments;
        }

        const emailRes = await fetch('https://api.postmarkapp.com/email', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Postmark-Server-Token': postmarkApiKey,
          },
          body: JSON.stringify(emailBody),
        });

        if (!emailRes.ok) {
          const errorText = await emailRes.text();
          console.error('Postmark API error:', emailRes.status, errorText);
          throw new Error(`Postmark error: ${emailRes.status} - ${errorText}`);
        }

        const emailResponse = await emailRes.json();
        messageId = emailResponse.MessageID;
        messageStatus = 'sent';
        console.log('Email sent via Postmark:', messageId);
      }
    } else {
      // Handle SMS/WhatsApp via Twilio
      let from: string;
      let to: string;

      if (sendRequest.channel === 'whatsapp') {
        from = `whatsapp:${twilioPhoneNumber}`;
        to = `whatsapp:${sendRequest.to}`;
      } else {
        // SMS
        from = twilioPhoneNumber;
        to = sendRequest.to;
      }

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
      const auth = btoa(`${twilioAccountSid}:${twilioAuthToken}`);

      const formData = new URLSearchParams();
      formData.append('From', from);
      formData.append('To', to);
      formData.append('Body', sendRequest.message);

      console.log('Calling Twilio API...');
      const twilioRes = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData,
      });

      if (!twilioRes.ok) {
        const errorText = await twilioRes.text();
        console.error('Twilio API error:', twilioRes.status, errorText);
        throw new Error(`Twilio error: ${twilioRes.status} - ${errorText}`);
      }

      const twilioResponse = await twilioRes.json();
      messageId = twilioResponse.sid;
      messageStatus = twilioResponse.status;
      console.log('Message sent via Twilio:', messageId);
    }

    // Log the outbound message to database (skip if frontend already saved it)
    if (!sendRequest.skipMessageLog) {
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          conversation_id: sendRequest.conversationId,
          direction: 'outbound',
          channel: sendRequest.channel,
          actor_type: sendRequest.metadata?.actorType || 'ai_agent',
          actor_name: sendRequest.metadata?.actorName || 'MAC Cleaning AI',
          body: sendRequest.message,
          attachments: sendRequest.attachments || [],
          raw_payload: {
            ...sendRequest.metadata,
            messageId: messageId,
            messageStatus: messageStatus,
            automation_level: automationLevel
          }
        });

      if (messageError) {
        console.error('Error logging message:', messageError);
        // Don't fail the request if logging fails
      }
    } else {
      console.log('Skipping message log (already saved by frontend)');
    }

    // Update conversation
    await supabase
      .from('conversations')
      .update({
        updated_at: new Date().toISOString(),
        message_count: supabase.rpc('increment_message_count', { conversation_id: sendRequest.conversationId })
      })
      .eq('id', sendRequest.conversationId);

    return new Response(
      JSON.stringify({
        success: true,
        messageId: messageId,
        status: messageStatus,
        channel: sendRequest.channel
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in send-response:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.toString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
