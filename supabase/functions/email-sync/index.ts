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
    
    // Determine max messages based on mode
    let maxToProcess = 25; // Default quick limit
    if (syncMode === 'all_history') {
      maxToProcess = Math.min(maxMessages || 10000, 10000); // Full history up to 10k
    } else if (syncMode === 'last_1000') {
      maxToProcess = Math.min(maxMessages || 1000, 1000);
    } else if (typeof maxMessages === 'number' && maxMessages > 0) {
      maxToProcess = Math.min(maxMessages, 500);
    }
    
    let inboundProcessed = 0;
    let outboundProcessed = 0;
    let threadsLinked = 0;

    // Update sync status to 'syncing'
    await supabase
      .from('email_provider_configs')
      .update({ 
        sync_status: 'syncing',
        sync_stage: 'fetching_inbox',
        sync_started_at: new Date().toISOString(),
        sync_error: null,
        inbound_emails_found: 0,
        outbound_emails_found: 0,
        threads_linked: 0,
      })
      .eq('id', configId);

    // Determine date filter based on mode
    let afterDate: Date | null = null;
    if (syncMode === 'all_historical_90_days') {
      afterDate = new Date();
      afterDate.setDate(afterDate.getDate() - 90);
    } else if (syncMode === 'all_historical_30_days') {
      afterDate = new Date();
      afterDate.setDate(afterDate.getDate() - 30);
    }

    // Helper function to strip HTML
    const stripHtml = (html: string): string => {
      return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    };

    // All connected email addresses (main + aliases)
    const allConnectedEmails = [
      config.email_address.toLowerCase(), 
      ...(config.aliases || []).map((a: string) => a.toLowerCase())
    ];

    // =============================================
    // STEP 1: FETCH AND IMPORT INBOUND EMAILS
    // =============================================
    console.log('=== STEP 1: Fetching inbound emails ===');
    
    let nextPageToken: string | null = null;
    let totalFetched = 0;
    
    do {
      const baseUrl = 'https://api.aurinko.io/v1/email/messages';
      let queryParams: string[] = [];
      
      if (syncMode === 'unread_only') {
        queryParams.push('unread=true');
      }
      if (afterDate) {
        queryParams.push(`after=${afterDate.toISOString()}`);
      }
      // Fetch in batches of 50 for pagination
      queryParams.push(`limit=50`);
      if (nextPageToken) {
        queryParams.push(`pageToken=${nextPageToken}`);
      }
      
      const fetchUrl = `${baseUrl}?${queryParams.join('&')}`;
      console.log('Fetching from:', fetchUrl);

      const messagesResponse = await fetch(fetchUrl, {
        headers: {
          'Authorization': `Bearer ${config.access_token}`,
        },
      });

      if (!messagesResponse.ok) {
        const errorText = await messagesResponse.text();
        console.error('Failed to fetch messages:', messagesResponse.status, errorText);
        break;
      }

      const messagesData = await messagesResponse.json();
      const messages = messagesData.records || [];
      nextPageToken = messagesData.nextPageToken || null;
      totalFetched += messages.length;
      
      console.log(`Fetched batch: ${messages.length} messages, total: ${totalFetched}, hasMore: ${!!nextPageToken}`);

      // Update progress
      await supabase
        .from('email_provider_configs')
        .update({ 
          sync_total: Math.min(totalFetched + (nextPageToken ? 50 : 0), maxToProcess),
          sync_progress: inboundProcessed + outboundProcessed
        })
        .eq('id', configId);

      // Process each message
      for (const messageSummary of messages) {
        if (inboundProcessed >= maxToProcess) {
          console.log('Reached max inbound limit:', maxToProcess);
          nextPageToken = null; // Stop pagination
          break;
        }

        try {
          const externalId = messageSummary.id?.toString();
          
          // Skip if already processed
          const { data: existing } = await supabase
            .from('conversations')
            .select('id')
            .eq('external_conversation_id', `aurinko_${externalId}`)
            .single();

          if (existing) {
            continue;
          }

          // Fetch full message details
          const fullMessageResponse = await fetch(`https://api.aurinko.io/v1/email/messages/${externalId}`, {
            headers: {
              'Authorization': `Bearer ${config.access_token}`,
            },
          });

          if (!fullMessageResponse.ok) {
            continue;
          }

          const message = await fullMessageResponse.json();
          
          // Extract email details
          const fromEmail = (message.from?.address || message.from?.email || message.sender?.address || '').toLowerCase();
          const fromName = message.from?.name || message.sender?.name || fromEmail.split('@')[0] || 'Unknown';
          const subject = message.subject || 'No Subject';
          const threadId = message.threadId || externalId;
          
          // Check if this is an outbound email (from us)
          const isOutbound = allConnectedEmails.includes(fromEmail);
          
          if (isOutbound) {
            // Skip outbound in this pass - we'll handle them separately
            continue;
          }

          // Extract body
          let body = '';
          if (message.textBody) {
            body = message.textBody;
          } else if (message.body && typeof message.body === 'object') {
            body = message.body.text || message.body.plain || '';
            if (!body && message.body.html) {
              body = stripHtml(message.body.html);
            }
          } else if (message.htmlBody) {
            body = stripHtml(message.htmlBody);
          } else if (message.snippet) {
            body = message.snippet;
          } else if (typeof message.body === 'string') {
            if (message.body.includes('<') && message.body.includes('>')) {
              body = stripHtml(message.body);
            } else {
              body = message.body;
            }
          }
          
          const receivedAt = message.receivedAt || message.createdAt || message.date;

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

          // Get original recipient
          const toAddresses: string[] = [];
          if (Array.isArray(message.to)) {
            for (const t of message.to) {
              if (typeof t === 'string') {
                toAddresses.push(t.toLowerCase());
              } else if (t?.email) {
                toAddresses.push(t.email.toLowerCase());
              } else if (t?.address) {
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
                thread_id: threadId,
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

          // Create message
          const { error: msgError } = await supabase
            .from('messages')
            .insert({
              conversation_id: conversation.id,
              body: body.substring(0, 10000),
              direction: 'inbound',
              channel: 'email',
              actor_type: 'customer',
              actor_name: fromName,
              created_at: receivedAt,
              raw_payload: message,
            });

          if (msgError) {
            console.error('Error creating message:', msgError);
            continue;
          }

          inboundProcessed++;

          // Update progress periodically
          if (inboundProcessed % 10 === 0) {
            await supabase
              .from('email_provider_configs')
              .update({ 
                sync_progress: inboundProcessed,
                inbound_emails_found: inboundProcessed
              })
              .eq('id', configId);
          }

          // Trigger AI triage (non-blocking)
          if (body.length > 0) {
            triggerAITriage(supabase, conversation, body, fromEmail, fromName, customer, subject, originalRecipient, config.workspace_id);
          }

        } catch (msgError) {
          console.error('Error processing message:', msgError);
        }
      }

      // Small delay between pages to avoid rate limits
      if (nextPageToken && inboundProcessed < maxToProcess) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
    } while (nextPageToken && inboundProcessed < maxToProcess);

    console.log(`Inbound import complete: ${inboundProcessed} emails`);

    // =============================================
    // STEP 2: FETCH AND IMPORT OUTBOUND EMAILS (for voice learning)
    // =============================================
    console.log('=== STEP 2: Fetching outbound (sent) emails ===');
    
    await supabase
      .from('email_provider_configs')
      .update({ sync_stage: 'fetching_sent' })
      .eq('id', configId);

    // Fetch from sent folder
    nextPageToken = null;
    let sentFetched = 0;
    const maxSentToFetch = Math.min(500, maxToProcess); // Limit sent emails for voice learning
    
  do {
    const sentUrlStr: string = `https://api.aurinko.io/v1/email/messages?folder=SENT&limit=50${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`;
    console.log('Fetching sent emails from:', sentUrlStr);

    const sentResp: Response = await fetch(sentUrlStr, {
      headers: {
        'Authorization': `Bearer ${config.access_token}`,
      },
    });

    if (!sentResp.ok) {
      console.log('Sent folder fetch failed (may not be supported):', sentResp.status);
      break;
    }

    const sentDataJson: any = await sentResp.json();
    const sentMessages = sentDataJson.records || [];
    nextPageToken = sentDataJson.nextPageToken || null;
      
      console.log(`Fetched ${sentMessages.length} sent emails`);

      for (const message of sentMessages) {
        if (outboundProcessed >= maxSentToFetch) {
          nextPageToken = null;
          break;
        }

        try {
          const externalId = message.id?.toString();
          const threadId = message.threadId || externalId;

          // Check if we already have this message
          const { data: existingMsg } = await supabase
            .from('messages')
            .select('id')
            .eq('raw_payload->>id', externalId)
            .single();

          if (existingMsg) {
            continue;
          }

          // Fetch full message for body
          const fullMsgResponse = await fetch(`https://api.aurinko.io/v1/email/messages/${externalId}`, {
            headers: {
              'Authorization': `Bearer ${config.access_token}`,
            },
          });

          if (!fullMsgResponse.ok) continue;

          const fullMsg = await fullMsgResponse.json();
          
          // Extract body (strip quoted content for voice learning)
          let body = '';
          if (fullMsg.textBody) {
            body = fullMsg.textBody;
          } else if (fullMsg.body?.text) {
            body = fullMsg.body.text;
          } else if (fullMsg.body?.html || fullMsg.htmlBody) {
            body = stripHtml(fullMsg.body?.html || fullMsg.htmlBody);
          }

          // Strip quoted content (lines starting with > or On ... wrote:)
          body = stripQuotedContent(body);

          if (!body || body.length < 20) {
            continue; // Skip very short replies
          }

          // Find the conversation this reply belongs to
          const { data: conversation } = await supabase
            .from('conversations')
            .select('id, customer_id')
            .eq('metadata->>thread_id', threadId)
            .eq('workspace_id', config.workspace_id)
            .single();

          if (conversation) {
            // Link outbound message to existing conversation
            await supabase
              .from('messages')
              .insert({
                conversation_id: conversation.id,
                body: body.substring(0, 10000),
                direction: 'outbound',
                channel: 'email',
                actor_type: 'human_agent',
                actor_name: config.email_address.split('@')[0],
                created_at: fullMsg.sentAt || fullMsg.createdAt || fullMsg.date,
                raw_payload: fullMsg,
              });

            threadsLinked++;
          }

          outboundProcessed++;
          sentFetched++;

        } catch (err) {
          console.error('Error processing sent email:', err);
        }
      }

      if (nextPageToken && outboundProcessed < maxSentToFetch) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
    } while (nextPageToken && outboundProcessed < maxSentToFetch);

    console.log(`Outbound import complete: ${outboundProcessed} emails, ${threadsLinked} threads linked`);

    // =============================================
    // STEP 3: TRIGGER VOICE PROFILE ANALYSIS
    // =============================================
    if (outboundProcessed >= 10) {
      console.log('=== STEP 3: Triggering voice profile analysis ===');
      
      await supabase
        .from('email_provider_configs')
        .update({ 
          sync_stage: 'analyzing_voice',
          voice_profile_status: 'analyzing'
        })
        .eq('id', configId);

      // Trigger voice analysis asynchronously
      supabase.functions.invoke('analyze-voice-profile', {
        body: { workspace_id: config.workspace_id }
      }).then(result => {
        console.log('Voice profile analysis triggered:', result.data || result.error);
      }).catch(err => {
        console.error('Voice analysis failed:', err);
      });
    }

    // =============================================
    // COMPLETE
    // =============================================
    await supabase
      .from('email_provider_configs')
      .update({ 
        last_sync_at: new Date().toISOString(),
        sync_status: 'completed',
        sync_stage: 'complete',
        sync_completed_at: new Date().toISOString(),
        sync_progress: inboundProcessed + outboundProcessed,
        inbound_emails_found: inboundProcessed,
        outbound_emails_found: outboundProcessed,
        threads_linked: threadsLinked,
      })
      .eq('id', configId);

    console.log('Sync complete:', { inboundProcessed, outboundProcessed, threadsLinked });

    return new Response(JSON.stringify({ 
      success: true, 
      inboundProcessed,
      outboundProcessed,
      threadsLinked,
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

// Helper to strip quoted content from email replies
function stripQuotedContent(text: string): string {
  const lines = text.split('\n');
  const cleanLines: string[] = [];
  let hitQuoteMarker = false;

  for (const line of lines) {
    // Stop at common quote markers
    if (line.match(/^On .+ wrote:$/i) || 
        line.match(/^-{3,} Original Message -{3,}$/i) ||
        line.match(/^>{2,}/) ||
        line.match(/^From: .+@.+$/i)) {
      hitQuoteMarker = true;
      break;
    }
    
    // Skip lines that start with >
    if (line.startsWith('>')) {
      continue;
    }
    
    cleanLines.push(line);
  }

  return cleanLines.join('\n').trim();
}

// Trigger AI triage asynchronously
async function triggerAITriage(
  supabase: any,
  conversation: any,
  body: string,
  fromEmail: string,
  fromName: string,
  customer: any,
  subject: string,
  toEmail: string,
  workspaceId: string
) {
  try {
    // Call pre-triage-rules first
    const preTriageResponse = await supabase.functions.invoke('pre-triage-rules', {
      body: {
        email: { from_email: fromEmail, from_name: fromName, subject, body: body.substring(0, 5000) },
        workspace_id: workspaceId,
      }
    });

    if (preTriageResponse.data?.matched && preTriageResponse.data?.skip_llm) {
      const preTriage = preTriageResponse.data;
      await supabase
        .from('conversations')
        .update({
          email_classification: preTriage.classification,
          decision_bucket: preTriage.decision_bucket,
          requires_reply: preTriage.requires_reply,
          triage_confidence: 1.0,
          status: !preTriage.requires_reply ? 'resolved' : 'new',
          resolved_at: !preTriage.requires_reply ? new Date().toISOString() : null,
        })
        .eq('id', conversation.id);
      return;
    }

    // Call LLM-based triage
    const triageResponse = await supabase.functions.invoke('email-triage-agent', {
      body: {
        email: { from_email: fromEmail, from_name: fromName, subject, body: body.substring(0, 5000), to_email: toEmail },
        workspace_id: workspaceId,
      }
    });

    if (triageResponse.data && !triageResponse.error) {
      const triage = triageResponse.data;
      await supabase
        .from('conversations')
        .update({
          email_classification: triage.decision?.classification,
          decision_bucket: triage.decision?.bucket || 'wait',
          requires_reply: triage.decision?.requires_reply,
          why_this_needs_you: triage.decision?.why_this_needs_you,
          triage_confidence: triage.decision?.confidence,
          ai_sentiment: triage.sentiment,
          urgency: triage.priority?.urgency,
          needs_review: (triage.decision?.confidence || 0) < 0.85,
        })
        .eq('id', conversation.id);
    }

  } catch (err) {
    console.error('Triage error (non-blocking):', err);
  }
}
