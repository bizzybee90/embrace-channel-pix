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
    const { configId, mode, maxMessages } = await req.json();
    console.log('Email sync requested:', { configId, mode, maxMessages });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
    const maxToProcess = typeof maxMessages === 'number' && maxMessages > 0 ? Math.min(maxMessages, 25) : 10;
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
    queryParams.push(`limit=${Math.max(5, maxToProcess)}`); // Keep runs quick to avoid timeouts
    
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
    console.log('Fetched', messagesData.records?.length || 0, 'messages from list API');

    // Process each message (hard-capped to keep sync responsive)
    for (const messageSummary of messagesData.records || []) {
      if (messagesProcessed >= maxToProcess) {
        console.log('Reached maxToProcess cap, stopping early:', maxToProcess);
        break;
      }
      try {
        // Skip if already processed (check by external ID)
        const externalId = messageSummary.id?.toString();
        const { data: existing } = await supabase
          .from('conversations')
          .select('id')
          .eq('external_conversation_id', `aurinko_${externalId}`)
          .single();

        if (existing) {
          console.log('Message already processed:', externalId);
          continue;
        }

        // IMPORTANT: Fetch full message details to get the body content
        console.log('Fetching full message details for:', externalId);
        const fullMessageResponse = await fetch(`https://api.aurinko.io/v1/email/messages/${externalId}`, {
          headers: {
            'Authorization': `Bearer ${config.access_token}`,
          },
        });

        if (!fullMessageResponse.ok) {
          console.error('Failed to fetch full message:', externalId, fullMessageResponse.status);
          continue;
        }

        const message = await fullMessageResponse.json();
        console.log('Full message fetched:', JSON.stringify({
          hasTextBody: !!message.textBody,
          hasHtmlBody: !!message.htmlBody,
          hasBody: !!message.body,
          bodyType: typeof message.body,
          bodyKeys: message.body ? Object.keys(message.body) : [],
        }));

        // Extract email details - Aurinko uses 'address' not 'email'
        const fromEmail = (message.from?.address || message.from?.email || message.sender?.address || message.sender?.email || '').toLowerCase();
        const fromName = message.from?.name || message.sender?.name || fromEmail.split('@')[0] || 'Unknown';
        const subject = message.subject || 'No Subject';
        
        console.log('Extracted sender:', { fromEmail, fromName, rawFrom: message.from });
        
        // Helper to strip HTML and clean up text
        const stripHtml = (html: string): string => {
          return html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove style blocks
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove script blocks
            .replace(/<[^>]+>/g, ' ') // Remove HTML tags
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
        };

        // Try multiple fields for body content - Aurinko uses nested body object
        let body = '';
        if (message.textBody) {
          body = message.textBody;
        } else if (message.body && typeof message.body === 'object') {
          // Aurinko returns body as { text: "...", html: "..." }
          body = message.body.text || message.body.plain || '';
          if (!body && message.body.html) {
            body = stripHtml(message.body.html);
          }
        } else if (message.htmlBody) {
          body = stripHtml(message.htmlBody);
        } else if (message.snippet) {
          body = message.snippet;
        } else if (typeof message.body === 'string') {
          // Check if it looks like HTML
          if (message.body.includes('<') && message.body.includes('>')) {
            body = stripHtml(message.body);
          } else {
            body = message.body;
          }
        }
        
        console.log('Extracted body length:', body.length, 'preview:', body.substring(0, 100));
        
        const receivedAt = message.receivedAt || message.createdAt || message.date;

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

        // Get original recipient (to address) - safely extract email
        const toAddresses: string[] = [];
        if (Array.isArray(message.to)) {
          for (const t of message.to) {
            if (typeof t === 'string') {
              toAddresses.push(t.toLowerCase());
            } else if (t && typeof t.email === 'string') {
              toAddresses.push(t.email.toLowerCase());
            } else if (t && typeof t.address === 'string') {
              toAddresses.push(t.address.toLowerCase());
            }
          }
        }
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
            external_conversation_id: `aurinko_${externalId}`,
            metadata: {
              original_recipient_email: originalRecipient,
              thread_id: message.threadId,
              email_provider: config.provider,
              aurinko_message_id: externalId,
            },
            created_at: receivedAt,
          })
          .select()
          .single();

        if (convError) {
          console.error('Error creating conversation:', convError);
          continue;
        }

        // Create message with the full body
        const { error: msgError } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversation.id,
            body: body.substring(0, 10000), // Limit body size
            direction: 'inbound',
            channel: 'email',
            actor_type: 'customer',
            actor_name: fromName,
            created_at: receivedAt,
            raw_payload: message, // Store full message for debugging
          });

        if (msgError) {
          console.error('Error creating message:', msgError);
          continue;
        }

        messagesProcessed++;
        console.log('Processed message:', subject, 'body length:', body.length);

        // Trigger AI agent for analysis
        if (body.length > 0) {
          try {
            console.log('Triggering AI agent for conversation:', conversation.id);
            
            // Call AI agent with proper structure matching receive-message
            const aiResponse = await supabase.functions.invoke('claude-ai-agent-tools', {
              body: {
                message: {
                  message_content: body.substring(0, 5000),
                  channel: 'email',
                  customer_identifier: fromEmail,
                  customer_name: fromName,
                  sender_phone: customer?.phone || null,
                  sender_email: fromEmail,
                },
                conversation_history: [],
                customer_data: customer,
              }
            });
            
            console.log('AI agent response:', JSON.stringify(aiResponse.data || aiResponse.error));
            
            if (aiResponse.data && !aiResponse.error) {
              const aiOutput = aiResponse.data;
              
              // Determine status based on requires_reply and escalate flags
              const requiresReply = aiOutput.requires_reply !== false; // Default to true for backwards compatibility
              let status = 'new';
              if (!requiresReply) {
                status = 'resolved'; // Auto-close emails that don't need reply
              } else if (aiOutput.escalate) {
                status = 'escalated';
              }
              
              // Update conversation with AI analysis including triage fields
              const { error: updateError } = await supabase
                .from('conversations')
                .update({
                  ai_confidence: aiOutput.confidence || 0,
                  ai_sentiment: aiOutput.sentiment || 'neutral',
                  ai_reason_for_escalation: aiOutput.escalation_reason || null,
                  ai_draft_response: aiOutput.response || null,
                  summary_for_human: aiOutput.ai_summary || null,
                  title: aiOutput.ai_title || subject,
                  category: aiOutput.ai_category || 'other',
                  is_escalated: aiOutput.escalate || false,
                  status: status,
                  escalated_at: aiOutput.escalate ? new Date().toISOString() : null,
                  resolved_at: !requiresReply ? new Date().toISOString() : null,
                  requires_reply: requiresReply,
                  email_classification: aiOutput.email_classification || null,
                })
                .eq('id', conversation.id);
              
              if (updateError) {
                console.error('Error updating conversation with AI data:', updateError);
              } else {
                console.log('Updated conversation with AI analysis:', {
                  title: aiOutput.ai_title,
                  category: aiOutput.ai_category,
                  sentiment: aiOutput.sentiment,
                  confidence: aiOutput.confidence,
                  escalated: aiOutput.escalate,
                  requires_reply: requiresReply,
                  email_classification: aiOutput.email_classification,
                  status: status,
                });
              }
            } else {
              console.error('AI agent error:', aiResponse.error);
            }
          } catch (aiError) {
            console.error('AI agent call failed (non-blocking):', aiError);
          }
        } else {
          console.log('Skipping AI agent - no body content');
        }

        // Mark email as read in Aurinko/Gmail
        await markEmailAsRead(config.access_token, message.id);

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

async function markEmailAsRead(accessToken: string, messageId: string) {
  try {
    console.log('Marking email as read:', messageId);
    const response = await fetch(`https://api.aurinko.io/v1/email/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ unread: false }),
    });
    
    if (response.ok) {
      console.log('Email marked as read successfully');
    } else {
      console.error('Failed to mark email as read:', response.status, await response.text());
    }
  } catch (error) {
    console.error('Error marking email as read:', error);
  }
}
