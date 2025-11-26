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

  const startTime = Date.now();
  let webhookLogId: string | null = null;

  // IP validation
  const requestIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 
                    req.headers.get('x-real-ip') || 
                    'unknown';
  
  console.log('Incoming webhook from IP:', requestIp);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload = await req.json();
    console.log('Received webhook from N8n:', payload);

    // Check IP allowlist if workspace_id is provided
    if (payload.workspace_id) {
      const { data: allowedIps } = await supabase
        .from('allowed_webhook_ips')
        .select('ip_address')
        .eq('workspace_id', payload.workspace_id)
        .eq('enabled', true);

      if (allowedIps && allowedIps.length > 0) {
        const isAllowed = allowedIps.some(row => row.ip_address === requestIp);
        
        if (!isAllowed) {
          console.error('IP not in allowlist:', requestIp);
          
          await supabase.from('webhook_logs').insert({
            direction: 'inbound',
            webhook_url: req.url,
            payload: payload,
            status_code: 403,
            error_message: `IP ${requestIp} not in allowlist`,
          });

          return new Response(
            JSON.stringify({ error: 'Unauthorized IP address' }),
            { 
              status: 403, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        console.log('IP validated successfully:', requestIp);
      }
    }

    // Extract data from N8n payload
    const {
      channel,
      customer_name,
      customer_identifier,
      customer_email,
      customer_phone,
      customer_tier,
      message_content,
      conversation_context,
      title,
      priority = 'medium',
      category = 'other',
      ai_reason_for_escalation,
      summary_for_human,
      ai_confidence,
      ai_sentiment,
      ai_draft_response,
      n8n_workflow_id,
      metadata
    } = payload;

    // Validate required fields
    if (!channel || !customer_identifier || !message_content) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: channel, customer_identifier, message_content' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get workspace_id (using first workspace for now - could be enhanced)
    const { data: workspaceData } = await supabase
      .from('workspaces')
      .select('id')
      .limit(1)
      .single();

    if (!workspaceData) {
      console.error('No workspace found');
      return new Response(
        JSON.stringify({ error: 'No workspace configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const workspace_id = workspaceData.id;

    // Log webhook reception
    const { data: logData } = await supabase
      .from('webhook_logs')
      .insert({
        direction: 'inbound',
        webhook_url: req.url,
        payload,
        status_code: null,
      })
      .select()
      .single();

    webhookLogId = logData?.id || null;

    // Check for duplicate message using message_id from metadata
    if (metadata?.message_id) {
      const { data: existingLog } = await supabase
        .from('webhook_logs')
        .select('id, conversation_id')
        .eq('direction', 'inbound')
        .contains('payload', { metadata: { message_id: metadata.message_id } })
        .neq('id', webhookLogId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingLog?.conversation_id) {
        console.log('Duplicate message detected, returning existing conversation:', existingLog.conversation_id);
        
        await supabase
          .from('webhook_logs')
          .update({
            conversation_id: existingLog.conversation_id,
            status_code: 200,
            response_payload: { 
              success: true, 
              conversation_id: existingLog.conversation_id,
              duplicate: true
            }
          })
          .eq('id', webhookLogId);

        return new Response(
          JSON.stringify({ 
            success: true, 
            conversation_id: existingLog.conversation_id,
            duplicate: true,
            message: 'Duplicate message ignored' 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Step 1: Create or update customer
    let customerId: string;
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('workspace_id', workspace_id)
      .or(`email.eq.${customer_email || ''},phone.eq.${customer_phone || ''}`)
      .maybeSingle();

    if (existingCustomer) {
      customerId = existingCustomer.id;
      // Update customer if new info provided
      await supabase
        .from('customers')
        .update({
          name: customer_name || undefined,
          email: customer_email || undefined,
          phone: customer_phone || undefined,
          tier: customer_tier || undefined,
        })
        .eq('id', customerId);
    } else {
      // Create new customer
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          workspace_id,
          name: customer_name,
          email: customer_email,
          phone: customer_phone,
          tier: customer_tier || 'regular',
        })
        .select('id')
        .single();

      if (customerError) {
        console.error('Error creating customer:', customerError);
        throw customerError;
      }
      customerId = newCustomer.id;
    }

    // Step 2: Find existing open conversation or create new one
    let conversation;
    
    // Look for existing open conversation for this customer and channel
    const { data: existingConversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('customer_id', customerId)
      .eq('channel', channel)
      .in('status', ['new', 'open', 'pending'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingConversation) {
      console.log('Found existing open conversation:', existingConversation.id);
      conversation = existingConversation;
    } else {
      console.log('Creating new conversation');
      const conversationMetadata: any = { ...metadata };
      if (ai_draft_response) {
        conversationMetadata.ai_draft_response = ai_draft_response;
      }
      // Store customer contact info in metadata as fallback
      if (customer_name) conversationMetadata.customer_name = customer_name;
      if (customer_email) conversationMetadata.customer_email = customer_email;
      if (customer_phone) conversationMetadata.customer_phone = customer_phone;
      if (customer_identifier) conversationMetadata.customer_identifier = customer_identifier;

      const { data: newConversation, error: conversationError } = await supabase
        .from('conversations')
        .insert({
          workspace_id,
          customer_id: customerId,
          channel,
          title: title || `${channel} - ${customer_name || customer_identifier}`,
          priority,
          category,
          status: 'new',
          ai_reason_for_escalation,
          summary_for_human,
          ai_confidence: ai_confidence ? parseFloat(ai_confidence) : null,
          ai_sentiment,
          metadata: conversationMetadata,
        })
        .select()
        .single();

      if (conversationError) {
        console.error('Error creating conversation:', conversationError);
        
        if (webhookLogId) {
          await supabase
            .from('webhook_logs')
            .update({
              status_code: 500,
              error_message: conversationError.message,
              response_payload: { error: conversationError.message }
            })
            .eq('id', webhookLogId);
        }

        return new Response(
          JSON.stringify({ error: conversationError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      conversation = newConversation;
    }

    console.log('Using conversation:', conversation.id);

    // Step 3: Create messages from conversation_context
    if (conversation_context && Array.isArray(conversation_context)) {
      const messages = conversation_context.map((msg: any) => {
        let actor_type = 'customer';
        if (msg.role === 'assistant' || msg.role === 'ai') {
          actor_type = 'ai_agent';
        } else if (msg.role === 'agent' || msg.role === 'human') {
          actor_type = 'human_agent';
        }

        return {
          conversation_id: conversation.id,
          actor_type,
          actor_name: msg.role === 'customer' ? customer_name : msg.role,
          body: msg.content || msg.message || '',
          channel,
          direction: actor_type === 'customer' ? 'inbound' : 'outbound',
          is_internal: false,
        };
      });

      const { error: messagesError } = await supabase
        .from('messages')
        .insert(messages);

      if (messagesError) {
        console.error('Error creating messages:', messagesError);
      } else {
        console.log(`Created ${messages.length} messages`);
      }
    }

    // Step 4: Create initial escalation message
    const { error: messageError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        actor_type: 'customer',
        actor_name: customer_name,
        body: message_content,
        channel,
        direction: 'inbound',
        is_internal: false,
      });

    if (messageError) {
      console.error('Error creating initial message:', messageError);
    }

    // Step 5: Keep backward compatibility - insert into escalated_messages
    const { data: escalatedMsg, error: escalatedError } = await supabase
      .from('escalated_messages')
      .insert({
        channel,
        customer_name,
        customer_identifier,
        message_content,
        conversation_context,
        priority,
        status: 'pending',
        n8n_workflow_id,
        metadata,
      })
      .select()
      .single();

    if (escalatedError) {
      console.error('Error creating escalated message:', escalatedError);
    }

    console.log('Escalation processed successfully');

    // Update webhook log with success
    if (webhookLogId) {
      await supabase
        .from('webhook_logs')
        .update({
          conversation_id: conversation.id,
          status_code: 200,
          response_payload: { 
            success: true, 
            conversation_id: conversation.id,
            escalated_message_id: escalatedMsg?.id 
          }
        })
        .eq('id', webhookLogId);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        conversation_id: conversation.id,
        escalated_message_id: escalatedMsg?.id,
        customer_id: customerId,
        message: 'Escalation processed successfully' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing webhook:', error);
    
    // Update webhook log with error if we have the ID
    if (webhookLogId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        await supabase
          .from('webhook_logs')
          .update({
            status_code: 500,
            error_message: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('id', webhookLogId);
      } catch (logError) {
        console.error('Failed to update webhook log:', logError);
      }
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});