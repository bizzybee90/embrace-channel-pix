import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  
  // Handle Aurinko URL verification (GET request with challenge)
  if (req.method === 'GET') {
    const challenge = url.searchParams.get('validationToken') || url.searchParams.get('challenge');
    console.log('Aurinko verification GET request, challenge:', challenge);
    
    return new Response(challenge || 'OK', {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });
  }

  // Check for validation token in query params (POST verification)
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken) {
    console.log('Aurinko verification POST with token:', validationToken);
    return new Response(validationToken, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });
  }

  try {
    const bodyText = await req.text();
    if (!bodyText || bodyText.trim() === '') {
      console.log('Empty body received - treating as ping');
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const payload = JSON.parse(bodyText);
    console.log('Aurinko webhook received:', JSON.stringify(payload, null, 2));

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Aurinko webhook structure can be:
    // 1. Old format: { notification, resource, accountId }
    // 2. New format: { payloads: [{ changeType, resource, ... }], subscription: { accountId } }
    
    let accountId = payload.accountId;
    let notifications: any[] = [];

    // Handle new payloads array format
    if (payload.payloads && Array.isArray(payload.payloads)) {
      accountId = payload.subscription?.accountId || payload.accountId;
      notifications = payload.payloads
        .filter((p: any) => p.changeType === 'created' || p.changeType === 'updated')
        .map((p: any) => ({
          type: p.changeType === 'created' ? 'message.created' : 'message.updated',
          resource: p.resource || p,
        }));
      console.log('Parsed payloads array format, notifications:', notifications.length);
    } 
    // Handle old notification format
    else if (payload.notification && payload.resource) {
      notifications = [{ type: payload.notification, resource: payload.resource }];
      console.log('Parsed old notification format');
    }

    if (!accountId) {
      console.log('No accountId in webhook, might be a test ping');
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Find the email config for this account
    const { data: emailConfig, error: configError } = await supabase
      .from('email_provider_configs')
      .select('*')
      .eq('account_id', accountId.toString())
      .single();

    if (configError || !emailConfig) {
      console.error('Email config not found for account:', accountId);
      return new Response(JSON.stringify({ error: 'Config not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('Found email config for workspace:', emailConfig.workspace_id, 'processing', notifications.length, 'notifications');

    // Process each notification
    for (const notif of notifications) {
      if (notif.type === 'message.created' && notif.resource) {
        await processNewEmail(supabase, emailConfig, notif.resource);
      }
    }

    // Update last sync time
    await supabase
      .from('email_provider_configs')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', emailConfig.id);

    return new Response(JSON.stringify({ success: true, processed: notifications.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in aurinko-webhook:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function processNewEmail(supabase: any, emailConfig: any, emailData: any) {
  const messageId = emailData.id || emailData.messageId;
  console.log('Processing new email notification, messageId:', messageId);

  // Fetch full message details from Aurinko API
  const messageResponse = await fetch(`https://api.aurinko.io/v1/email/messages/${messageId}`, {
    headers: {
      'Authorization': `Bearer ${emailConfig.access_token}`,
    },
  });

  if (!messageResponse.ok) {
    console.error('Failed to fetch full message:', messageResponse.status);
    return processEmailFromData(supabase, emailConfig, emailData, messageId);
  }

  const message = await messageResponse.json();
  console.log('Fetched full message, has textBody:', !!message.textBody, 'has htmlBody:', !!message.htmlBody);
  
  return processEmailFromData(supabase, emailConfig, message, messageId);
}

async function processEmailFromData(supabase: any, emailConfig: any, message: any, originalMessageId?: string) {
  const senderEmail = (message.from?.email || message.sender?.email || '').toLowerCase();
  const senderName = message.from?.name || message.sender?.name || senderEmail.split('@')[0];
  const subject = message.subject || 'No Subject';
  const aurinkoMessageId = originalMessageId || message.id;
  
  // Try multiple fields for body content
  let body = message.textBody || message.text || message.body?.text || '';
  if (!body && message.htmlBody) {
    body = message.htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (!body && message.body?.html) {
    body = message.body.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (!body && message.snippet) {
    body = message.snippet;
  }
  
  console.log('Email body length:', body.length, 'preview:', body.substring(0, 100));

  // Extract the recipient (To) address
  let recipientEmail = emailConfig.email_address;
  if (message.to && Array.isArray(message.to) && message.to.length > 0) {
    const allOurAddresses = [
      emailConfig.email_address.toLowerCase(),
      ...(emailConfig.aliases || []).map((a: string) => a.toLowerCase())
    ];
    
    for (const toAddr of message.to) {
      const toEmail = (toAddr.email || toAddr).toLowerCase();
      if (allOurAddresses.includes(toEmail)) {
        recipientEmail = toEmail;
        break;
      }
    }
  }
  console.log('Recipient address (will reply from):', recipientEmail);

  if (!senderEmail) {
    console.log('No sender email, skipping');
    return;
  }

  // Skip emails from the connected account itself or any alias (outbound)
  const allOurAddresses = [
    emailConfig.email_address.toLowerCase(),
    ...(emailConfig.aliases || []).map((a: string) => a.toLowerCase())
  ];
  if (allOurAddresses.includes(senderEmail)) {
    console.log('Skipping outbound email from our account/alias');
    return;
  }

  // Find or create customer
  let { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('workspace_id', emailConfig.workspace_id)
    .eq('email', senderEmail)
    .single();

  if (!customer) {
    const { data: newCustomer, error: createError } = await supabase
      .from('customers')
      .insert({
        workspace_id: emailConfig.workspace_id,
        email: senderEmail,
        name: senderName,
        preferred_channel: 'email',
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating customer:', createError);
      return;
    }
    customer = newCustomer;
    console.log('Created new customer:', customer.id);
  }

  // Check for existing conversation with this email thread
  const threadId = message.threadId || message.id;
  let { data: existingConversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('workspace_id', emailConfig.workspace_id)
    .eq('external_conversation_id', `aurinko_${threadId}`)
    .single();

  let conversationId;
  let isNewConversation = false;

  if (existingConversation) {
    conversationId = existingConversation.id;
    await supabase
      .from('conversations')
      .update({
        status: 'open',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    console.log('Updated existing conversation:', conversationId);
  } else {
    isNewConversation = true;
    const { data: newConversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        workspace_id: emailConfig.workspace_id,
        customer_id: customer.id,
        channel: 'email',
        title: subject,
        status: 'new',
        external_conversation_id: `aurinko_${threadId}`,
        metadata: { 
          aurinko_account_id: emailConfig.account_id,
          aurinko_message_id: aurinkoMessageId,
          original_recipient_email: recipientEmail,
        },
      })
      .select()
      .single();

    if (convError) {
      console.error('Error creating conversation:', convError);
      return;
    }
    conversationId = newConversation.id;
    console.log('Created new conversation:', conversationId);
  }

  // Add message
  const { error: msgError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      actor_type: 'customer',
      actor_name: senderName,
      direction: 'inbound',
      channel: 'email',
      body: body.substring(0, 10000),
      raw_payload: message,
    });

  if (msgError) {
    console.error('Error creating message:', msgError);
    return;
  }

  console.log('Message added to conversation:', conversationId);

  // Mark email as read in Aurinko/Gmail
  await markEmailAsRead(emailConfig, aurinkoMessageId);

  // Trigger AI agent for processing
  if (body.length > 0) {
    await triggerAIAnalysis(supabase, conversationId, body, senderName, senderEmail, customer, subject);
  }
}

async function markEmailAsRead(emailConfig: any, messageId: string) {
  try {
    console.log('Marking email as read:', messageId);
    const response = await fetch(`https://api.aurinko.io/v1/email/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${emailConfig.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ unread: false }),
    });
    
    if (response.ok) {
      console.log('Email marked as read successfully');
    } else {
      console.error('Failed to mark email as read:', response.status, await response.text());
    }
  } catch (error) {
    console.error('Error marking email as read:', error);
  }
}

async function triggerAIAnalysis(
  supabase: any, 
  conversationId: string, 
  body: string, 
  senderName: string, 
  senderEmail: string, 
  customer: any,
  subject: string
) {
  try {
    console.log('Triggering AI agent for conversation:', conversationId);
    
    // Call AI agent with proper structure
    const aiResponse = await supabase.functions.invoke('claude-ai-agent-tools', {
      body: {
        message: {
          message_content: body.substring(0, 5000),
          channel: 'email',
          customer_identifier: senderEmail,
          customer_name: senderName,
          sender_phone: customer?.phone || null,
          sender_email: senderEmail,
        },
        conversation_history: [],
        customer_data: customer,
      }
    });
    
    console.log('AI agent response:', JSON.stringify(aiResponse.data || aiResponse.error));
    
    if (aiResponse.data && !aiResponse.error) {
      const aiOutput = aiResponse.data;
      
      // Update conversation with AI analysis
      const { error: updateError } = await supabase
        .from('conversations')
        .update({
          ai_confidence: aiOutput.confidence || 0,
          ai_sentiment: aiOutput.sentiment || 'neutral',
          ai_reason_for_escalation: aiOutput.escalation_reason || null,
          ai_draft_response: aiOutput.response || null,
          summary_for_human: aiOutput.ai_summary || null,
          title: aiOutput.ai_title || subject,
          category: aiOutput.ai_category || 'other',
          is_escalated: aiOutput.escalate || false,
          status: aiOutput.escalate ? 'escalated' : 'new',
          escalated_at: aiOutput.escalate ? new Date().toISOString() : null,
        })
        .eq('id', conversationId);
      
      if (updateError) {
        console.error('Error updating conversation with AI data:', updateError);
      } else {
        console.log('Updated conversation with AI analysis:', {
          title: aiOutput.ai_title,
          category: aiOutput.ai_category,
          sentiment: aiOutput.sentiment,
          confidence: aiOutput.confidence,
          escalated: aiOutput.escalate,
        });
      }
    } else {
      console.error('AI agent error:', aiResponse.error);
    }
  } catch (aiError) {
    console.error('AI agent call failed (non-blocking):', aiError);
  }
}
