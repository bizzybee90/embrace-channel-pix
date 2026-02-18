import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // --- AUTH CHECK ---
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  // --- END AUTH CHECK ---

  try {
    const { conversationId, markAsRead = true } = await req.json();

    if (!conversationId) {
      return new Response(
        JSON.stringify({ error: 'conversationId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`mark-email-read: conversationId=${conversationId}, markAsRead=${markAsRead}`);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Fetch the conversation to get metadata
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, workspace_id, channel, metadata, external_conversation_id')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      console.error('Conversation not found:', convError);
      return new Response(
        JSON.stringify({ error: 'Conversation not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only process email conversations
    if (conversation.channel !== 'email') {
      console.log('Not an email conversation, skipping');
      return new Response(
        JSON.stringify({ success: true, message: 'Not an email conversation' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const metadata = conversation.metadata || {};
    const aurinkoMessageId = metadata.aurinko_message_id;
    const aurinkoAccountId = metadata.aurinko_account_id;

    if (!aurinkoMessageId) {
      console.log('No aurinko_message_id in metadata, skipping');
      return new Response(
        JSON.stringify({ success: true, message: 'No aurinko message ID' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the email provider config
    const { data: emailConfig, error: configError } = await supabase
      .from('email_provider_configs')
      .select('id, account_id, email_address')
      .eq('workspace_id', conversation.workspace_id)
      .eq('account_id', aurinkoAccountId?.toString())
      .single();

    if (configError || !emailConfig) {
      console.error('Email config not found:', configError);
      return new Response(
        JSON.stringify({ error: 'Email configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get decrypted access token securely
    const { data: tokenData, error: tokenError } = await supabase
      .rpc('get_decrypted_access_token', { config_id: emailConfig.id });

    if (tokenError || !tokenData) {
      console.error('Failed to get access token:', tokenError);
      return new Response(
        JSON.stringify({ error: 'Failed to retrieve access token' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = tokenData;

    // Mark email as read/unread in Aurinko
    console.log(`Marking email ${aurinkoMessageId} as ${markAsRead ? 'read' : 'unread'}`);
    
    const response = await fetch(`https://api.aurinko.io/v1/email/messages/${aurinkoMessageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ unread: !markAsRead }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to update email read status:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to update email read status', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Email ${aurinkoMessageId} marked as ${markAsRead ? 'read' : 'unread'} successfully`);

    return new Response(
      JSON.stringify({ success: true, messageId: aurinkoMessageId, markedAsRead: markAsRead }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in mark-email-read:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
