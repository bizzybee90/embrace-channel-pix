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

interface AIOutput {
  response: string;
  confidence: number;
  intent: string;
  sentiment: string;
  escalate: boolean;
  escalation_reason?: string;
  ai_title: string;
  ai_summary: string;
  ai_category: string;
}

// Validation function for AI responses
function validateResponse(response: string): { valid: boolean; reason?: string } {
  // Length check
  if (!response || response.length < 20) {
    return { valid: false, reason: `Response too short: ${response?.length || 0} chars (min 20)` };
  }
  if (response.length > 500) {
    return { valid: false, reason: `Response too long: ${response.length} chars (max 500)` };
  }
  
  // Placeholder check - catches [name], [customer], {{variable}}, etc.
  if (/\[.*?\]|{{.*?}}/.test(response)) {
    return { valid: false, reason: 'Response contains placeholder text like [name] or {{variable}}' };
  }
  
  // Raw JSON check - catches if AI accidentally included JSON in response
  if (response.includes('"response":') || response.includes('"escalate":') || response.includes('"confidence":')) {
    return { valid: false, reason: 'Response contains raw JSON - not a valid customer message' };
  }
  
  // Internal reasoning check - catches AI talking to itself
  if (/I should|I need to|I will|Let me|I'll respond|The customer|My response/i.test(response.substring(0, 50))) {
    return { valid: false, reason: 'Response appears to be internal AI reasoning, not a customer message' };
  }
  
  return { valid: true };
}

// Safe default response when anything goes wrong
function createSafeEscalationResponse(reason: string, originalMessage: string): AIOutput {
  return {
    response: "Thank you for your message. A team member will review this and get back to you shortly.",
    confidence: 0,
    intent: "unknown",
    sentiment: "neutral",
    escalate: true,
    escalation_reason: reason,
    ai_title: "Needs Human Review",
    ai_summary: originalMessage.substring(0, 100),
    ai_category: "other"
  };
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
      const formData = await req.formData();
      rawBody = Object.fromEntries(formData);
    } else {
      rawBody = await req.json();
    }

    console.log('📥 [receive-message] Incoming webhook:', JSON.stringify(rawBody, null, 2));

    // Step 1: Normalise incoming message
    const normalised = normaliseMessage(rawBody);
    console.log('📥 [receive-message] Normalised:', JSON.stringify(normalised, null, 2));

    // Step 2: Find or create customer
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('*')
      .or(`phone.eq.${normalised.customer_identifier},email.eq.${normalised.customer_identifier}`)
      .maybeSingle();

    let customerId: string;

    if (existingCustomer) {
      customerId = existingCustomer.id;
      console.log('👤 [receive-message] Found existing customer:', customerId, existingCustomer.name);
    } else {
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('id')
        .limit(1)
        .single();

      if (!workspace) throw new Error('No workspace found');

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
      console.log('👤 [receive-message] Created new customer:', customerId);
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
    let previousStatus: string | null = null;

    if (existingConversation) {
      conversationId = existingConversation.id;
      previousStatus = existingConversation.status;
      console.log('💬 [receive-message] Found existing conversation:', conversationId, 'previous status:', previousStatus);
      
      await supabase
        .from('conversations')
        .update({
          message_count: (existingConversation.message_count || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);
    } else {
      const { data: customer } = await supabase
        .from('customers')
        .select('workspace_id')
        .eq('id', customerId)
        .single();

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
      console.log('💬 [receive-message] Created new conversation:', conversationId);
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
    console.log('📝 [receive-message] Logged inbound message');

    // Step 5: Get conversation history for context
    const { data: history } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10);

    // Step 6: Call AI agent
    console.log('🤖 [receive-message] Calling AI agent...');
    
    let aiOutput: AIOutput;
    
    try {
      // Determine sender phone/email for customer lookup
      const senderPhone = (normalised.channel === 'sms' || normalised.channel === 'whatsapp') 
        ? normalised.customer_identifier 
        : null;
      const senderEmail = normalised.channel === 'email' 
        ? normalised.customer_identifier 
        : normalised.customer_email;
      
      const aiResponse = await supabase.functions.invoke('claude-ai-agent-tools', {
        body: {
          message: {
            ...normalised,
            sender_phone: senderPhone,
            sender_email: senderEmail,
          },
          conversation_history: history || [],
          customer_data: existingCustomer,
        }
      });

      if (aiResponse.error) {
        console.error('❌ [receive-message] AI agent invoke error:', aiResponse.error);
        aiOutput = createSafeEscalationResponse(`AI agent invoke failed: ${aiResponse.error}`, normalised.message_content);
      } else if (!aiResponse.data) {
        console.error('❌ [receive-message] AI agent returned no data');
        aiOutput = createSafeEscalationResponse('AI agent returned no data', normalised.message_content);
      } else {
        aiOutput = aiResponse.data as AIOutput;
        console.log('🤖 [receive-message] AI response received:', JSON.stringify(aiOutput, null, 2));
      }
    } catch (aiError) {
      console.error('❌ [receive-message] AI agent call failed:', aiError);
      aiOutput = createSafeEscalationResponse(
        `AI agent exception: ${aiError instanceof Error ? aiError.message : 'unknown'}`,
        normalised.message_content
      );
    }

    // Step 7: Validate AI response
    const validation = validateResponse(aiOutput.response);
    console.log('✅ [receive-message] Validation result:', JSON.stringify(validation));
    
    if (!validation.valid) {
      console.warn('⚠️ [receive-message] Response validation failed:', validation.reason);
      aiOutput.escalate = true;
      aiOutput.escalation_reason = `Validation failed: ${validation.reason}`;
    }

    // Step 8: Check confidence threshold
    if (aiOutput.confidence < 0.5 && !aiOutput.escalate) {
      console.warn('⚠️ [receive-message] Low confidence, forcing escalation:', aiOutput.confidence);
      aiOutput.escalate = true;
      aiOutput.escalation_reason = `Low confidence: ${aiOutput.confidence}`;
    }

    // Step 9: Final decision logging
    console.log('📊 [receive-message] Final decision:', {
      willSend: !aiOutput.escalate,
      escalate: aiOutput.escalate,
      escalation_reason: aiOutput.escalation_reason || null,
      confidence: aiOutput.confidence,
      responsePreview: aiOutput.response.substring(0, 80) + '...',
    });

    // Step 10: Update conversation with AI metadata
    const updateData: any = {
      ai_confidence: aiOutput.confidence,
      ai_sentiment: aiOutput.sentiment,
      category: aiOutput.ai_category,
      title: aiOutput.ai_title,
      summary_for_human: aiOutput.ai_summary,
      updated_at: new Date().toISOString(),
      ai_draft_response: aiOutput.response,
      mode: 'ai',
      confidence: aiOutput.confidence,
    };

    // Check if customer is replying to a conversation we were waiting on
    const wasWaitingForCustomer = previousStatus === 'waiting_customer';
    
    if (wasWaitingForCustomer) {
      // Customer replied to our message - set to 'open' for human review
      updateData.status = 'open';
      updateData.conversation_type = 'customer_replied';
      console.log('📬 [receive-message] Customer replied to waiting conversation - setting to OPEN');
    } else if (aiOutput.escalate) {
      // ESCALATED: Save draft but don't send
      updateData.is_escalated = true;
      updateData.escalated_at = new Date().toISOString();
      updateData.ai_reason_for_escalation = aiOutput.escalation_reason;
      updateData.status = 'escalated';
      updateData.conversation_type = 'escalated';
      updateData.auto_responded = false;
      updateData.human_edited = false;
      // DO NOT set final_response for escalated - human will provide it
      
      console.log('🚨 [receive-message] ESCALATING conversation:', conversationId);
      console.log('🚨 [receive-message] Reason:', aiOutput.escalation_reason);
    } else {
      // AI HANDLED: Will send response
      updateData.ai_message_count = (existingConversation?.ai_message_count || 0) + 1;
      updateData.conversation_type = 'ai_handled';
      updateData.status = 'ai_handling';
      updateData.auto_responded = true;
      updateData.final_response = aiOutput.response;
      updateData.human_edited = false;
    }

    await supabase
      .from('conversations')
      .update(updateData)
      .eq('id', conversationId);

    // Step 11: Generate embedding in background
    const conversationText = `${normalised.message_content} ${aiOutput.response}`;
    supabase.functions.invoke('generate-embedding', {
      body: { text: conversationText, conversationId: conversationId }
    }).catch(err => console.error('Embedding generation failed:', err));

    // Step 12: Send response ONLY if not escalated AND not a customer reply to waiting conversation
    if (!aiOutput.escalate && !wasWaitingForCustomer) {
      console.log('📤 [receive-message] Sending automated response...');
      
      // Log AI message ONLY when actually sending
      await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          actor_type: 'ai',
          actor_name: 'MAC Cleaning AI',
          body: aiOutput.response,
          channel: normalised.channel,
          direction: 'outbound',
        });
      
      const sendResponse = await supabase.functions.invoke('send-response', {
        body: {
          conversationId: conversationId,
          channel: normalised.channel,
          to: normalised.customer_identifier,
          message: aiOutput.response,
        }
      });

      if (sendResponse.error) {
        console.error('❌ [receive-message] Send response error:', sendResponse.error);
      } else {
        console.log('✅ [receive-message] Response sent successfully');
      }
    } else {
      console.log('🚫 [receive-message] NOT sending - escalated to human');
    }

    return new Response(JSON.stringify({
      success: true,
      conversation_id: conversationId,
      escalated: aiOutput.escalate,
      escalation_reason: aiOutput.escalation_reason || null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('❌ [receive-message] Fatal error:', error);
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
