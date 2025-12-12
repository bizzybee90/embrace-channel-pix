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

  try {
    const payload = await req.json();
    console.log('Aurinko webhook received:', JSON.stringify(payload, null, 2));

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Aurinko sends notifications for email events
    // Notification types: 'message.created', 'message.updated', etc.
    const { notification, resource, accountId, subscription } = payload;

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

    console.log('Found email config for workspace:', emailConfig.workspace_id);

    // Handle new email notification
    if (notification === 'message.created' && resource) {
      await processNewEmail(supabase, emailConfig, resource);
    }

    // Update last sync time
    await supabase
      .from('email_provider_configs')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', emailConfig.id);

    return new Response(JSON.stringify({ success: true }), {
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
  console.log('Processing new email:', emailData.id);

  const senderEmail = emailData.from?.email || emailData.sender?.email;
  const senderName = emailData.from?.name || emailData.sender?.name || senderEmail;
  const subject = emailData.subject || 'No Subject';
  const body = emailData.textBody || emailData.snippet || '';

  if (!senderEmail) {
    console.log('No sender email, skipping');
    return;
  }

  // Skip emails from the connected account itself (outbound)
  if (senderEmail === emailConfig.email_address) {
    console.log('Skipping outbound email');
    return;
  }

  // Find or create customer
  let { data: customer, error: customerError } = await supabase
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
  const threadId = emailData.threadId || emailData.id;
  let { data: existingConversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('workspace_id', emailConfig.workspace_id)
    .eq('external_conversation_id', `aurinko_${threadId}`)
    .single();

  let conversationId;

  if (existingConversation) {
    conversationId = existingConversation.id;
    // Update conversation with new activity
    await supabase
      .from('conversations')
      .update({
        status: 'open',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    console.log('Updated existing conversation:', conversationId);
  } else {
    // Create new conversation
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
          aurinko_message_id: emailData.id 
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
      body: body,
      raw_payload: emailData,
    });

  if (msgError) {
    console.error('Error creating message:', msgError);
    return;
  }

  console.log('Message added to conversation:', conversationId);

  // Trigger AI agent for processing
  try {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/claude-ai-agent-tools`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversationId,
        customerMessage: body,
        channel: 'email',
        customerName: senderName,
        customerEmail: senderEmail,
      }),
    });
    console.log('AI agent triggered for conversation:', conversationId);
  } catch (aiError) {
    console.error('Error triggering AI agent:', aiError);
  }
}
