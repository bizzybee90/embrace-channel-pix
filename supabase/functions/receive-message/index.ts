import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NormalisedMessage {
  channel: "sms" | "whatsapp" | "email" | "web";
  customer_identifier: string;
  customer_name: string | null;
  customer_email: string | null;
  message_content: string;
  message_id: string;
  timestamp: string;
  session_id: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const contentType = req.headers.get('content-type') || '';
    let rawBody: any;

    // Parse incoming request based on content type
    if (contentType.includes('application/x-www-form-urlencoded')) {
      // Twilio webhook format
      const formData = await req.formData();
      rawBody = Object.fromEntries(formData);
    } else {
      // JSON format (for testing or web chat)
      rawBody = await req.json();
    }

    console.log('Received webhook:', rawBody);

    // Step 1: Normalise incoming message
    const normalised = normaliseMessage(rawBody);
    console.log('Normalised message:', normalised);

    // Step 2: Find or create customer
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('*')
      .or(`phone.eq.${normalised.customer_identifier},email.eq.${normalised.customer_identifier}`)
      .maybeSingle();

    let customerId: string;

    if (existingCustomer) {
      customerId = existingCustomer.id;
      console.log('Found existing customer:', customerId);
    } else {
      // Get first workspace
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('id')
        .limit(1)
        .single();

      if (!workspace) throw new Error('No workspace found');

      // Create new customer
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          workspace_id: workspace.id,
          name: normalised.customer_name || 'Unknown',
          phone: normalised.channel === 'sms' || normalised.channel === 'whatsapp' 
            ? normalised.customer_identifier 
            : null,
          email: normalised.channel === 'email' 
            ? normalised.customer_identifier 
            : normalised.customer_email,
          preferred_channel: normalised.channel,
        })
        .select()
        .single();

      if (customerError) throw customerError;
      customerId = newCustomer.id;
      console.log('Created new customer:', customerId);
    }

    // Step 3: Find or create conversation
    const { data: existingConversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('customer_id', customerId)
      .eq('channel', normalised.channel)
      .neq('status', 'resolved')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let conversationId: string;

    if (existingConversation) {
      conversationId = existingConversation.id;
      console.log('Found existing conversation:', conversationId);
      
      // Update conversation
      await supabase
        .from('conversations')
        .update({
          message_count: (existingConversation.message_count || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);
    } else {
      // Get workspace id from customer
      const { data: customer } = await supabase
        .from('customers')
        .select('workspace_id')
        .eq('id', customerId)
        .single();

      // Create new conversation
      const { data: newConversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          workspace_id: customer.workspace_id,
          customer_id: customerId,
          channel: normalised.channel,
          external_conversation_id: normalised.session_id,
          status: 'new',
          message_count: 1,
          title: normalised.message_content.substring(0, 50),
        })
        .select()
        .single();

      if (convError) throw convError;
      conversationId = newConversation.id;
      console.log('Created new conversation:', conversationId);
    }

    // Step 4: Log incoming message
    const { error: messageError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_name: normalised.customer_name || 'Customer',
        body: normalised.message_content,
        channel: normalised.channel,
        direction: 'inbound',
        raw_payload: rawBody,
      });

    if (messageError) throw messageError;

    // Step 5: Get conversation history for context
    const { data: history } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10);

    // Step 6: Call AI agent
    const aiResponse = await supabase.functions.invoke('claude-ai-agent', {
      body: {
        message: normalised,
        conversation_history: history || [],
        customer_data: existingCustomer,
      }
    });

    if (aiResponse.error) {
      console.error('AI agent error:', aiResponse.error);
      throw new Error('AI agent failed');
    }

    const aiOutput = aiResponse.data;
    console.log('AI response:', aiOutput);

    // Step 7: Log AI response message
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        actor_type: 'ai',
        actor_name: 'BizzyBee AI',
        body: aiOutput.response,
        channel: normalised.channel,
        direction: 'outbound',
      });

    // Step 8: Update conversation with AI metadata and tracking
    const updateData: any = {
      ai_confidence: aiOutput.confidence,
      ai_sentiment: aiOutput.sentiment,
      category: aiOutput.ai_category,
      title: aiOutput.ai_title,
      summary_for_human: aiOutput.ai_summary,
      updated_at: new Date().toISOString(),
      // AI/Human tracking
      ai_draft_response: aiOutput.response,
      final_response: aiOutput.response,
      auto_responded: !aiOutput.escalate,
      mode: 'ai',
      confidence: aiOutput.confidence,
      human_edited: false,
    };

    if (aiOutput.escalate) {
      updateData.is_escalated = true;
      updateData.escalated_at = new Date().toISOString();
      updateData.ai_reason_for_escalation = aiOutput.escalation_reason;
      updateData.status = 'escalated';
      updateData.conversation_type = 'escalated';
      updateData.auto_responded = false;
      
      console.log('Escalating conversation:', conversationId);
    } else {
      updateData.ai_message_count = (existingConversation?.ai_message_count || 0) + 1;
      updateData.conversation_type = 'ai_handled';
      updateData.status = 'ai_handling';
    }

    await supabase
      .from('conversations')
      .update(updateData)
      .eq('id', conversationId);

    // Step 8b: Generate embedding for the conversation (background task)
    const conversationText = `${normalised.message_content} ${aiOutput.response}`;
    
    // Start embedding generation in background (don't await)
    supabase.functions.invoke('generate-embedding', {
      body: {
        text: conversationText,
        conversationId: conversationId
      }
    }).then(result => {
      if (result.error) {
        console.error('Failed to generate embedding:', result.error);
      } else {
        console.log('Embedding generated successfully for conversation:', conversationId);
      }
    });

    // Step 9: Send response if not escalated
    if (!aiOutput.escalate) {
      console.log('Sending automated response');
      
      const sendResponse = await supabase.functions.invoke('send-response', {
        body: {
          conversation_id: conversationId,
          channel: normalised.channel,
          recipient: normalised.customer_identifier,
          message: aiOutput.response,
        }
      });

      if (sendResponse.error) {
        console.error('Send response error:', sendResponse.error);
      }
    } else {
      console.log('Conversation escalated - not sending automated response');
    }

    return new Response(JSON.stringify({
      success: true,
      conversation_id: conversationId,
      escalated: aiOutput.escalate,
      response: aiOutput.response,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in receive-message:', error);
    return new Response(JSON.stringify({
      error: error.message,
      success: false
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function normaliseMessage(rawBody: any): NormalisedMessage {
  // Detect channel from Twilio
  if (rawBody.From && rawBody.Body) {
    const from = rawBody.From;
    const isWhatsApp = from.startsWith('whatsapp:');
    
    const customerIdentifier = isWhatsApp 
      ? from.replace('whatsapp:', '')
      : from;

    const businessNumber = rawBody.To?.replace('whatsapp:', '') || '+447878758588';
    
    return {
      channel: isWhatsApp ? 'whatsapp' : 'sms',
      customer_identifier: customerIdentifier,
      customer_name: null,
      customer_email: null,
      message_content: rawBody.Body,
      message_id: rawBody.MessageSid || `msg_${Date.now()}`,
      timestamp: new Date().toISOString(),
      session_id: `${isWhatsApp ? 'whatsapp' : 'sms'}:${customerIdentifier}->${businessNumber}`,
    };
  }

  // JSON format (for testing or web chat)
  return {
    channel: rawBody.channel || 'web',
    customer_identifier: rawBody.customer_identifier || rawBody.from || 'unknown',
    customer_name: rawBody.customer_name || null,
    customer_email: rawBody.customer_email || null,
    message_content: rawBody.message || rawBody.message_content || rawBody.Body || '',
    message_id: rawBody.message_id || `msg_${Date.now()}`,
    timestamp: rawBody.timestamp || new Date().toISOString(),
    session_id: rawBody.session_id || `${rawBody.channel}:${rawBody.customer_identifier}`,
  };
}
