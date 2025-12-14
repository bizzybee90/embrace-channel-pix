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
    const { configId, mode } = await req.json();
    console.log('Email sync requested:', { configId, mode });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const AURINKO_CLIENT_ID = Deno.env.get('AURINKO_CLIENT_ID')!;
    const AURINKO_CLIENT_SECRET = Deno.env.get('AURINKO_CLIENT_SECRET')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get email config
    const { data: config, error: configError } = await supabase
      .from('email_provider_configs')
      .select('*')
      .eq('id', configId)
      .single();

    if (configError || !config) {
      console.error('Config not found:', configError);
      return new Response(JSON.stringify({ error: 'Email config not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('Found config for:', config.email_address, 'mode:', mode || config.import_mode);

    const syncMode = mode || config.import_mode || 'new_only';
    let messagesProcessed = 0;

    // Determine date filter based on mode
    let afterDate: Date | null = null;
    if (syncMode === 'all_historical_90_days') {
      afterDate = new Date();
      afterDate.setDate(afterDate.getDate() - 90);
    } else if (syncMode === 'unread_only') {
      // Will use unread filter instead of date
    }

    // Fetch messages from Aurinko
    const baseUrl = 'https://api.aurinko.io/v1/email/messages';
    let queryParams: string[] = [];
    
    if (syncMode === 'unread_only') {
      queryParams.push('unread=true');
    }
    if (afterDate) {
      queryParams.push(`after=${afterDate.toISOString()}`);
    }
    queryParams.push('limit=100'); // Process in batches
    
    const fetchUrl = `${baseUrl}?${queryParams.join('&')}`;
    console.log('Fetching emails from:', fetchUrl);

    const messagesResponse = await fetch(fetchUrl, {
      headers: {
        'Authorization': `Bearer ${config.access_token}`,
      },
    });

    if (!messagesResponse.ok) {
      const errorText = await messagesResponse.text();
      console.error('Failed to fetch messages:', messagesResponse.status, errorText);
      
      // If token expired, we'd need to refresh - for now, report the error
      return new Response(JSON.stringify({ 
        error: 'Failed to fetch messages',
        details: errorText,
        status: messagesResponse.status 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const messagesData = await messagesResponse.json();
    console.log('Fetched', messagesData.records?.length || 0, 'messages');

    // Process each message
    for (const message of messagesData.records || []) {
      try {
        // Skip if already processed (check by external ID)
        const externalId = message.id?.toString();
        const { data: existing } = await supabase
          .from('conversations')
          .select('id')
          .eq('external_conversation_id', externalId)
          .single();

        if (existing) {
          console.log('Message already processed:', externalId);
          continue;
        }

        // Extract email details
        const fromEmail = message.from?.email?.toLowerCase() || '';
        const fromName = message.from?.name || fromEmail.split('@')[0];
        const subject = message.subject || 'No Subject';
        const body = message.textBody || message.htmlBody?.replace(/<[^>]+>/g, '') || '';
        const receivedAt = message.receivedAt || message.createdAt;

        // Skip outbound emails (from our connected accounts)
        const allConnectedEmails = [config.email_address.toLowerCase(), ...(config.aliases || []).map((a: string) => a.toLowerCase())];
        if (allConnectedEmails.includes(fromEmail)) {
          console.log('Skipping outbound email from:', fromEmail);
          continue;
        }

        // Find or create customer
        let customer;
        const { data: existingCustomer } = await supabase
          .from('customers')
          .select('*')
          .eq('email', fromEmail)
          .eq('workspace_id', config.workspace_id)
          .single();

        if (existingCustomer) {
          customer = existingCustomer;
        } else {
          const { data: newCustomer, error: customerError } = await supabase
            .from('customers')
            .insert({
              workspace_id: config.workspace_id,
              email: fromEmail,
              name: fromName,
              preferred_channel: 'email',
            })
            .select()
            .single();

          if (customerError) {
            console.error('Error creating customer:', customerError);
            continue;
          }
          customer = newCustomer;
        }

        // Get original recipient (to address)
        const toAddresses = message.to?.map((t: any) => t.email?.toLowerCase()) || [];
        const originalRecipient = toAddresses.find((addr: string) => allConnectedEmails.includes(addr)) || config.email_address;

        // Create conversation
        const { data: conversation, error: convError } = await supabase
          .from('conversations')
          .insert({
            workspace_id: config.workspace_id,
            customer_id: customer.id,
            channel: 'email',
            title: subject,
            status: 'new',
            external_conversation_id: externalId,
            metadata: {
              original_recipient_email: originalRecipient,
              thread_id: message.threadId,
              email_provider: config.provider,
            },
            created_at: receivedAt,
          })
          .select()
          .single();

        if (convError) {
          console.error('Error creating conversation:', convError);
          continue;
        }

        // Create message
        await supabase
          .from('messages')
          .insert({
            conversation_id: conversation.id,
            body: body.substring(0, 10000), // Limit body size
            direction: 'inbound',
            channel: 'email',
            actor_type: 'customer',
            actor_name: fromName,
            created_at: receivedAt,
          });

        messagesProcessed++;
        console.log('Processed message:', subject);

        // Trigger AI agent for the new conversation
        try {
          await supabase.functions.invoke('claude-ai-agent-tools', {
            body: {
              conversationId: conversation.id,
              messageBody: body.substring(0, 5000),
            },
          });
        } catch (aiError) {
          console.log('AI agent call failed (non-blocking):', aiError);
        }

      } catch (msgError) {
        console.error('Error processing message:', msgError);
      }
    }

    // Update last_sync_at
    await supabase
      .from('email_provider_configs')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', configId);

    console.log('Sync complete. Processed', messagesProcessed, 'messages');

    return new Response(JSON.stringify({ 
      success: true, 
      messagesProcessed,
      mode: syncMode
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in email-sync:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});