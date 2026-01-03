import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Twilio signature verification
// See: https://www.twilio.com/docs/usage/security#validating-requests
function verifyTwilioSignature(
  twilioSignature: string | null,
  authToken: string,
  url: string,
  params: Record<string, string>
): boolean {
  if (!twilioSignature || !authToken) {
    console.warn('[receive-message] Missing Twilio signature or auth token');
    return false;
  }

  // Build the data string: URL + sorted params
  let data = url;
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  // Create HMAC-SHA1 signature
  const hmac = createHmac('sha1', authToken);
  hmac.update(data);
  const expectedSignature = hmac.digest('base64');

  // Constant-time comparison to prevent timing attacks
  if (twilioSignature.length !== expectedSignature.length) {
    return false;
  }
  
  let mismatch = 0;
  for (let i = 0; i < twilioSignature.length; i++) {
    mismatch |= twilioSignature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  
  return mismatch === 0;
}

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

// Check if message is a CSAT response (single digit 1-5)
function isCSATResponse(message: string): number | null {
  const trimmed = message.trim();
  // Check for single digit 1-5, optionally with punctuation
  const match = trimmed.match(/^([1-5])[\.\!\?]?$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  // Also check for spelled out numbers
  const wordMap: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5
  };
  const lower = trimmed.toLowerCase();
  if (wordMap[lower]) {
    return wordMap[lower];
  }
  return null;
}

// GDPR keyword detection patterns
interface GDPRKeywordResult {
  detected: boolean;
  type: 'forget' | 'delete' | 'unsubscribe' | 'export' | 'consent_withdraw' | null;
  keyword: string | null;
}

function detectGDPRKeywords(message: string): GDPRKeywordResult {
  const lowerMessage = message.toLowerCase().trim();
  
  // Forget me / Right to be forgotten patterns
  const forgetPatterns = [
    /\bforget\s*me\b/,
    /\bright\s*to\s*be\s*forgotten\b/,
    /\berase\s*my\s*data\b/,
    /\bremove\s*my\s*information\b/,
    /\bforget\s*my\s*data\b/,
  ];
  
  // Delete patterns
  const deletePatterns = [
    /\bdelete\s*(my|all)?\s*(data|information|account|records)\b/,
    /\bremove\s*my\s*account\b/,
    /\bgdpr\s*deletion\b/,
    /\bdata\s*deletion\b/,
  ];
  
  // Unsubscribe patterns
  const unsubscribePatterns = [
    /\bunsubscribe\b/,
    /\bstop\s*(messaging|texting|emailing|contacting)\s*me\b/,
    /\bopt\s*out\b/,
    /\bremove\s*(me\s*)?from\s*(mailing\s*)?list\b/,
    /\bno\s*more\s*(emails?|messages?|texts?)\b/,
  ];
  
  // Export patterns  
  const exportPatterns = [
    /\bexport\s*(my)?\s*data\b/,
    /\bdownload\s*(my)?\s*data\b/,
    /\bdata\s*portability\b/,
    /\bgive\s*me\s*(my)?\s*data\b/,
    /\bsend\s*me\s*(my)?\s*data\b/,
  ];
  
  // Consent withdrawal patterns
  const consentPatterns = [
    /\bwithdraw\s*(my)?\s*consent\b/,
    /\brevoke\s*(my)?\s*consent\b/,
    /\bi\s*don'?t\s*consent\b/,
    /\bremove\s*(my)?\s*consent\b/,
  ];
  
  for (const pattern of forgetPatterns) {
    const match = lowerMessage.match(pattern);
    if (match) return { detected: true, type: 'forget', keyword: match[0] };
  }
  
  for (const pattern of deletePatterns) {
    const match = lowerMessage.match(pattern);
    if (match) return { detected: true, type: 'delete', keyword: match[0] };
  }
  
  for (const pattern of unsubscribePatterns) {
    const match = lowerMessage.match(pattern);
    if (match) return { detected: true, type: 'unsubscribe', keyword: match[0] };
  }
  
  for (const pattern of exportPatterns) {
    const match = lowerMessage.match(pattern);
    if (match) return { detected: true, type: 'export', keyword: match[0] };
  }
  
  for (const pattern of consentPatterns) {
    const match = lowerMessage.match(pattern);
    if (match) return { detected: true, type: 'consent_withdraw', keyword: match[0] };
  }
  
  return { detected: false, type: null, keyword: null };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const contentType = req.headers.get('content-type') || '';
    let rawBody: any;
    let isTwilioWebhook = false;

    // Parse incoming request based on content type
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      rawBody = Object.fromEntries(formData);
      isTwilioWebhook = true; // Form data typically comes from Twilio
    } else {
      rawBody = await req.json();
    }

    // Verify Twilio signature for Twilio webhooks
    if (isTwilioWebhook && twilioAuthToken) {
      const twilioSignature = req.headers.get('X-Twilio-Signature');
      const requestUrl = req.url;
      
      const isValid = verifyTwilioSignature(
        twilioSignature,
        twilioAuthToken,
        requestUrl,
        rawBody as Record<string, string>
      );

      if (!isValid) {
        console.error('❌ [receive-message] Invalid Twilio signature - rejecting request');
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log('✅ [receive-message] Twilio signature verified');
    } else if (isTwilioWebhook && !twilioAuthToken) {
      console.warn('⚠️ [receive-message] TWILIO_AUTH_TOKEN not set - signature verification skipped');
    }

    console.log('📥 [receive-message] Incoming webhook:', JSON.stringify(rawBody, null, 2));

    // Step 1: Normalise incoming message
    const normalised = normaliseMessage(rawBody);
    console.log('📥 [receive-message] Normalised:', JSON.stringify(normalised, null, 2));

    // Step 2: Check if this is a CSAT response
    const csatRating = isCSATResponse(normalised.message_content);
    
    if (csatRating !== null) {
      console.log(`⭐ [receive-message] Detected CSAT response: ${csatRating}`);
      
      // Find a recent conversation with CSAT requested but not responded
      const { data: csatConversation } = await supabase
        .from('conversations')
        .select('id, channel, customer_id')
        .or(`channel.eq.${normalised.channel}`)
        .not('csat_requested_at', 'is', null)
        .is('csat_responded_at', null)
        .is('customer_satisfaction', null)
        .order('csat_requested_at', { ascending: false })
        .limit(10);

      // Find the conversation that matches this customer
      let matchedConversation = null;
      
      if (csatConversation && csatConversation.length > 0) {
        for (const conv of csatConversation) {
          const { data: customer } = await supabase
            .from('customers')
            .select('phone, email')
            .eq('id', conv.customer_id)
            .single();
          
          if (customer) {
            const customerIdentifier = normalised.channel === 'email' 
              ? customer.email 
              : customer.phone;
            
            if (customerIdentifier === normalised.customer_identifier) {
              matchedConversation = conv;
              break;
            }
          }
        }
      }

      if (matchedConversation) {
        console.log(`✅ [receive-message] Found matching CSAT conversation: ${matchedConversation.id}`);
        
        // Update conversation with CSAT rating
        await supabase
          .from('conversations')
          .update({
            customer_satisfaction: csatRating,
            csat_responded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', matchedConversation.id);

        // Log the CSAT response as a message
        await supabase
          .from('messages')
          .insert({
            conversation_id: matchedConversation.id,
            actor_type: 'customer',
            actor_name: 'Customer',
            body: normalised.message_content,
            channel: normalised.channel,
            direction: 'inbound',
            raw_payload: rawBody,
          });

        // Send thank you message
        const thankYouMessage = csatRating >= 4
          ? "Thank you for the great feedback! We're glad we could help. 😊"
          : "Thank you for your feedback. We're always working to improve our service.";

        await supabase.functions.invoke('send-response', {
          body: {
            conversationId: matchedConversation.id,
            channel: normalised.channel,
            to: normalised.customer_identifier,
            message: thankYouMessage,
          }
        });

        // Log the thank you message
        await supabase
          .from('messages')
          .insert({
            conversation_id: matchedConversation.id,
            actor_type: 'system',
            actor_name: 'CSAT System',
            body: thankYouMessage,
            channel: normalised.channel,
            direction: 'outbound',
          });

        console.log(`⭐ [receive-message] CSAT rating ${csatRating} recorded for conversation ${matchedConversation.id}`);

        return new Response(JSON.stringify({
          success: true,
          type: 'csat_response',
          conversation_id: matchedConversation.id,
          rating: csatRating,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        console.log('⚠️ [receive-message] CSAT response received but no matching conversation found, processing as regular message');
      }
    }

    // Step 2.5: Check for GDPR keywords (FORGET, DELETE, UNSUBSCRIBE, etc.)
    const gdprResult = detectGDPRKeywords(normalised.message_content);
    
    if (gdprResult.detected) {
      console.log(`🔒 [receive-message] GDPR keyword detected: ${gdprResult.type} - "${gdprResult.keyword}"`);
      
      // Find customer first
      const { data: gdprCustomer } = await supabase
        .from('customers')
        .select('id, workspace_id, name, email')
        .or(`phone.eq.${normalised.customer_identifier},email.eq.${normalised.customer_identifier}`)
        .maybeSingle();
      
      if (gdprCustomer) {
        // Log the GDPR request
        await supabase.from('data_access_logs').insert({
          action: `gdpr_keyword_${gdprResult.type}`,
          customer_id: gdprCustomer.id,
          metadata: {
            keyword: gdprResult.keyword,
            type: gdprResult.type,
            channel: normalised.channel,
            original_message: normalised.message_content.substring(0, 200),
          },
        });
        
        // Handle based on type
        let responseMessage = '';
        
        switch (gdprResult.type) {
          case 'forget':
          case 'delete':
            // Create deletion request
            await supabase.from('data_deletion_requests').insert({
              customer_id: gdprCustomer.id,
              reason: `Auto-detected from message: "${gdprResult.keyword}"`,
              deletion_type: 'full',
              status: 'pending',
            });
            responseMessage = "We've received your data deletion request. We'll process this within 30 days as required by GDPR. You'll receive a confirmation once complete.";
            break;
            
          case 'unsubscribe':
          case 'consent_withdraw':
            // Withdraw consent for this channel
            await supabase.functions.invoke('withdraw-consent', {
              body: {
                customer_id: gdprCustomer.id,
                channel: normalised.channel,
                reason: `Auto-detected from message: "${gdprResult.keyword}"`,
              }
            });
            responseMessage = "You've been unsubscribed from this channel. We won't contact you here anymore unless you reach out first.";
            break;
            
          case 'export':
            // Trigger data export
            await supabase.functions.invoke('export-customer-data', {
              body: { customer_identifier: gdprCustomer.id }
            });
            if (gdprCustomer.email) {
              responseMessage = `We're preparing your data export. It will be sent to ${gdprCustomer.email} within 24 hours.`;
            } else {
              responseMessage = "We're preparing your data export. Please provide an email address where we can send it.";
            }
            break;
        }
        
        // Send automatic response
        if (responseMessage) {
          await supabase.functions.invoke('send-response', {
            body: {
              channel: normalised.channel,
              to: normalised.customer_identifier,
              message: responseMessage,
            }
          });
        }
        
        console.log(`✅ [receive-message] GDPR request processed: ${gdprResult.type}`);
        
        return new Response(JSON.stringify({
          success: true,
          type: 'gdpr_request',
          gdpr_type: gdprResult.type,
          customer_id: gdprCustomer.id,
          response_sent: !!responseMessage,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        console.log('⚠️ [receive-message] GDPR keyword detected but customer not found, processing as regular message');
      }
    }

    // Step 3: Find or create customer (regular message flow)
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

    // Step 4: Find or create conversation
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

    // Step 5: Log incoming message
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

    // Step 6: Get conversation history for context
    const { data: history } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10);

    // Step 7: Call AI agent
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

    // Step 8: Validate AI response
    const validation = validateResponse(aiOutput.response);
    console.log('✅ [receive-message] Validation result:', JSON.stringify(validation));
    
    if (!validation.valid) {
      console.warn('⚠️ [receive-message] Response validation failed:', validation.reason);
      aiOutput.escalate = true;
      aiOutput.escalation_reason = `Validation failed: ${validation.reason}`;
    }

    // Step 9: Check confidence threshold
    if (aiOutput.confidence < 0.5 && !aiOutput.escalate) {
      console.warn('⚠️ [receive-message] Low confidence, forcing escalation:', aiOutput.confidence);
      aiOutput.escalate = true;
      aiOutput.escalation_reason = `Low confidence: ${aiOutput.confidence}`;
    }

    // Step 10: Final decision logging
    console.log('📊 [receive-message] Final decision:', {
      willSend: !aiOutput.escalate,
      escalate: aiOutput.escalate,
      escalation_reason: aiOutput.escalation_reason || null,
      confidence: aiOutput.confidence,
      responsePreview: aiOutput.response.substring(0, 80) + '...',
    });

    // Step 11: Update conversation with AI metadata
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

    // Step 12: Generate embedding in background
    const conversationText = `${normalised.message_content} ${aiOutput.response}`;
    supabase.functions.invoke('generate-embedding', {
      body: { text: conversationText, conversationId: conversationId }
    }).catch(err => console.error('Embedding generation failed:', err));

    // Step 13: Send response ONLY if not escalated AND not a customer reply to waiting conversation
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
