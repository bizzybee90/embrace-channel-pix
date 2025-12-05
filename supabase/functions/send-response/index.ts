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
  skipMessageLog?: boolean; // Skip logging if message already saved by frontend
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

    console.log('Sending message:', {
      channel: sendRequest.channel,
      to: sendRequest.to,
      messagePreview: sendRequest.message.substring(0, 50)
    });

    let messageId: string;
    let messageStatus: string;

    // Handle email channel via Postmark
    if (sendRequest.channel === 'email') {
      const postmarkApiKey = Deno.env.get('POSTMARK_API_KEY');
      if (!postmarkApiKey) {
        throw new Error('Postmark API key not configured');
      }

      // Prepare attachments for Postmark
      const postmarkAttachments = [];
      if (sendRequest.attachments && sendRequest.attachments.length > 0) {
        for (const attachment of sendRequest.attachments) {
          try {
            // Download file from storage
            const { data: fileData, error: downloadError } = await supabase.storage
              .from('message-attachments')
              .download(attachment.path);

            if (downloadError) {
              console.error('Error downloading attachment:', downloadError);
              continue;
            }

            // Convert to base64
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

      console.log('Sending email via Postmark...');
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

    // Get conversation to find customer
    const { data: conversation } = await supabase
      .from('conversations')
      .select('customer_id')
      .eq('id', sendRequest.conversationId)
      .single();

    if (!conversation) {
      throw new Error('Conversation not found');
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
            messageStatus: messageStatus
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
