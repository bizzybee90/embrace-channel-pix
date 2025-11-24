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

  let webhookLogId: string | null = null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const n8nWebhookUrl = Deno.env.get('N8N_WEBHOOK_URL');
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { messageId, response } = await req.json();
    console.log('Sending response to N8n for message:', messageId);

    // Get the original message details
    const { data: message, error: messageError } = await supabase
      .from('escalated_messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (messageError) {
      console.error('Error fetching message:', messageError);
      return new Response(
        JSON.stringify({ error: messageError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare payload for N8n
    const n8nPayload = {
      message_id: messageId,
      channel: message.channel,
      customer_identifier: message.customer_identifier,
      customer_name: message.customer_name,
      agent_response: response,
      n8n_workflow_id: message.n8n_workflow_id,
      timestamp: new Date().toISOString()
    };

    // Send to N8n webhook if configured
    if (n8nWebhookUrl) {
      console.log('Sending to N8n webhook:', n8nWebhookUrl);

      // Create initial webhook log
      const { data: logData } = await supabase
        .from('webhook_logs')
        .insert({
          direction: 'outbound',
          webhook_url: n8nWebhookUrl,
          payload: n8nPayload,
          status_code: null,
        })
        .select()
        .single();

      webhookLogId = logData?.id || null;
      
      // Attempt to send to N8n with retry logic
      let lastError: string | null = null;
      let retryCount = 0;
      const maxRetries = 3;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const n8nResponse = await fetch(n8nWebhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(n8nPayload),
          });

          const responseText = await n8nResponse.text();
          let responsePayload: any;
          try {
            responsePayload = JSON.parse(responseText);
          } catch {
            responsePayload = { raw: responseText };
          }

          if (!n8nResponse.ok) {
            console.error('N8n webhook error:', responseText);
            lastError = responseText;
            
            // Update log with error
            if (webhookLogId) {
              await supabase
                .from('webhook_logs')
                .update({
                  status_code: n8nResponse.status,
                  error_message: responseText,
                  response_payload: responsePayload,
                  retry_count: retryCount,
                })
                .eq('id', webhookLogId);
            }

            // Exponential backoff before retry
            if (attempt < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
              retryCount++;
              continue;
            }

            return new Response(
              JSON.stringify({ 
                error: 'Failed to send to N8n webhook after retries',
                details: responseText 
              }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          // Success! Update log
          if (webhookLogId) {
            await supabase
              .from('webhook_logs')
              .update({
                status_code: n8nResponse.status,
                response_payload: responsePayload,
                retry_count: retryCount,
              })
              .eq('id', webhookLogId);
          }

          // Update the response record to mark as sent
          const { error: updateError } = await supabase
            .from('message_responses')
            .update({ sent_to_n8n: true })
            .eq('message_id', messageId);

          if (updateError) {
            console.error('Error updating response status:', updateError);
          }

          console.log('Successfully sent to N8n');
          
          return new Response(
            JSON.stringify({ 
              success: true,
              message: 'Response sent to N8n successfully',
              retries: retryCount
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );

        } catch (fetchError: any) {
          console.error('Fetch error:', fetchError);
          lastError = fetchError.message;
          
          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            retryCount++;
            continue;
          }
        }
      }

      // Max retries reached
      if (webhookLogId) {
        await supabase
          .from('webhook_logs')
          .update({
            status_code: 500,
            error_message: lastError,
            retry_count: retryCount,
          })
          .eq('id', webhookLogId);
      }

      return new Response(
        JSON.stringify({ 
          error: 'Failed to send to N8n webhook after retries',
          details: lastError 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      console.warn('N8N_WEBHOOK_URL not configured, skipping webhook call');
      return new Response(
        JSON.stringify({ 
          success: false,
          message: 'N8N_WEBHOOK_URL not configured. Please add it in Lovable Cloud secrets.',
          payload: n8nPayload
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('Error in send-to-n8n function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
