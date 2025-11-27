import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PostmarkInboundEmail {
  FromFull: {
    Email: string;
    Name: string;
  };
  To: string;
  Subject: string;
  TextBody: string;
  HtmlBody: string;
  MessageID: string;
  Date: string;
  Attachments?: Array<{
    Name: string;
    Content: string;
    ContentType: string;
    ContentLength: number;
  }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const inboundEmail: PostmarkInboundEmail = await req.json();

    console.log('Received email from:', inboundEmail.FromFull.Email);

    // Get the default workspace (you may want to make this configurable)
    const { data: workspaces } = await supabase
      .from('workspaces')
      .select('id')
      .limit(1)
      .single();

    if (!workspaces) {
      throw new Error('No workspace found');
    }

    const workspaceId = workspaces.id;

    // Find or create customer
    let customerId: string;
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', inboundEmail.FromFull.Email)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          email: inboundEmail.FromFull.Email,
          name: inboundEmail.FromFull.Name || inboundEmail.FromFull.Email,
          workspace_id: workspaceId,
          preferred_channel: 'email'
        })
        .select('id')
        .single();

      if (customerError) {
        console.error('Error creating customer:', customerError);
        throw customerError;
      }

      customerId = newCustomer.id;
    }

    // Find or create conversation
    let conversationId: string;
    const { data: existingConversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('customer_id', customerId)
      .eq('channel', 'email')
      .eq('workspace_id', workspaceId)
      .in('status', ['new', 'active', 'pending'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingConversation) {
      conversationId = existingConversation.id;
      
      // Update conversation
      await supabase
        .from('conversations')
        .update({
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', conversationId);
    } else {
      const { data: newConversation, error: conversationError } = await supabase
        .from('conversations')
        .insert({
          customer_id: customerId,
          channel: 'email',
          workspace_id: workspaceId,
          status: 'new',
          title: inboundEmail.Subject,
          metadata: {
            emailMessageId: inboundEmail.MessageID,
            to: inboundEmail.To
          }
        })
        .select('id')
        .single();

      if (conversationError) {
        console.error('Error creating conversation:', conversationError);
        throw conversationError;
      }

      conversationId = newConversation.id;
    }

    // Handle attachments if present
    const attachments = [];
    if (inboundEmail.Attachments && inboundEmail.Attachments.length > 0) {
      for (const attachment of inboundEmail.Attachments) {
        try {
          // Decode base64 content
          const binaryString = atob(attachment.Content);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          // Upload to storage
          const fileName = `${conversationId}/${Date.now()}-${attachment.Name}`;
          const { error: uploadError } = await supabase.storage
            .from('message-attachments')
            .upload(fileName, bytes, {
              contentType: attachment.ContentType,
              upsert: false
            });

          if (uploadError) {
            console.error('Error uploading attachment:', uploadError);
          } else {
            attachments.push({
              name: attachment.Name,
              type: attachment.ContentType,
              size: attachment.ContentLength,
              path: fileName
            });
          }
        } catch (error) {
          console.error('Error processing attachment:', error);
        }
      }
    }

    // Insert the message
    const { error: messageError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        direction: 'inbound',
        channel: 'email',
        actor_type: 'customer',
        actor_name: inboundEmail.FromFull.Name || inboundEmail.FromFull.Email,
        body: inboundEmail.TextBody || inboundEmail.HtmlBody,
        attachments: attachments,
        raw_payload: {
          subject: inboundEmail.Subject,
          from: inboundEmail.FromFull.Email,
          to: inboundEmail.To,
          messageId: inboundEmail.MessageID,
          date: inboundEmail.Date
        }
      });

    if (messageError) {
      console.error('Error inserting message:', messageError);
      throw messageError;
    }

    console.log('Email processed successfully');

    // Invoke AI agent for automated response
    const conversationHistory = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    const aiResponse = await supabase.functions.invoke('claude-ai-agent', {
      body: {
        channel: 'email',
        customerIdentifier: inboundEmail.FromFull.Email,
        customerName: inboundEmail.FromFull.Name || inboundEmail.FromFull.Email,
        messageContent: inboundEmail.TextBody || inboundEmail.HtmlBody,
        conversationHistory: conversationHistory.data || []
      }
    });

    if (aiResponse.data?.shouldEscalate) {
      console.log('Escalating to human');
      await supabase
        .from('conversations')
        .update({
          is_escalated: true,
          escalated_at: new Date().toISOString(),
          ai_reason_for_escalation: aiResponse.data.escalationReason,
          status: 'pending'
        })
        .eq('id', conversationId);
    } else if (aiResponse.data?.response) {
      console.log('Sending automated response');
      await supabase.functions.invoke('send-response', {
        body: {
          conversationId: conversationId,
          channel: 'email',
          to: inboundEmail.FromFull.Email,
          message: aiResponse.data.response,
          metadata: {
            subject: `Re: ${inboundEmail.Subject}`
          }
        }
      });
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in receive-email:', error);
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
