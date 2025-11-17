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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload = await req.json();
    console.log('Received webhook from N8n:', payload);

    // Extract data from N8n payload
    const {
      channel,
      customer_name,
      customer_identifier,
      message_content,
      conversation_context,
      priority = 'medium',
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

    // Insert escalated message into database
    const { data, error } = await supabase
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
        metadata
      })
      .select()
      .single();

    if (error) {
      console.error('Error inserting message:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Message escalated successfully:', data);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message_id: data.id,
        message: 'Message escalated successfully' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing webhook:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});