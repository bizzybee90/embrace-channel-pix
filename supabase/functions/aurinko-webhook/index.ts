import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple in-memory rate limiter per IP (resets on cold start)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 120; // max requests per window per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

const MAX_PAYLOAD_SIZE = 512_000; // 512 KB

// HMAC signature verification for webhook security
async function verifyWebhookSignature(bodyText: string, signatureHeader: string | null): Promise<boolean> {
  const webhookSecret = Deno.env.get('AURINKO_WEBHOOK_SECRET');
  
  // If no secret is configured, skip verification (log warning)
  if (!webhookSecret) {
    console.warn('AURINKO_WEBHOOK_SECRET not configured - skipping HMAC verification');
    return true;
  }
  
  // If secret is configured but no signature provided, reject
  if (!signatureHeader) {
    console.error('Webhook signature missing but AURINKO_WEBHOOK_SECRET is configured');
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyText));
    const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Constant-time comparison
    if (computed.length !== signatureHeader.length) return false;
    let mismatch = 0;
    for (let i = 0; i < computed.length; i++) {
      mismatch |= computed.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
    }
    return mismatch === 0;
  } catch (e) {
    console.error('HMAC verification error:', e);
    return false;
  }
}

// Verify the request is from Aurinko by checking the accountId exists in our database
async function verifyAurinkoRequest(supabase: any, accountId: string): Promise<boolean> {
  if (!accountId) return false;
  
  const { data, error } = await supabase
    .from('email_provider_configs')
    .select('id')
    .eq('account_id', accountId.toString())
    .single();
  
  return !error && !!data;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // Handle Aurinko URL verification (GET request with challenge) - MUST be before kill switch
  if (req.method === 'GET') {
    const challenge = url.searchParams.get('validationToken') || url.searchParams.get('challenge');
    console.log('Aurinko verification GET request, challenge:', challenge);
    return new Response(challenge || 'OK', {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });
  }

  // Check for validation token in query params (POST verification) - MUST be before kill switch
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken) {
    console.log('Aurinko verification POST with token:', validationToken);
    return new Response(validationToken, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });
  }

  // Webhook processing is always enabled (kill switch removed to prevent secret sync issues)

  // Rate limiting
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    console.warn('Rate limited webhook request from:', clientIp);
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Initialize Supabase client early for validation
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    // Enforce payload size limit
    const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_PAYLOAD_SIZE) {
      console.warn('Webhook payload too large:', contentLength);
      return new Response(JSON.stringify({ error: 'Payload too large' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const bodyText = await req.text();

    // Verify HMAC signature if configured (warn-only — accountId validation is the primary check)
    const signature = req.headers.get('x-aurinko-signature') || req.headers.get('x-webhook-signature');
    const isValidSignature = await verifyWebhookSignature(bodyText, signature);
    if (!isValidSignature) {
      console.warn('Webhook HMAC signature mismatch - proceeding with accountId validation');
    }

    if (bodyText.length > MAX_PAYLOAD_SIZE) {
      console.warn('Webhook body too large:', bodyText.length);
      return new Response(JSON.stringify({ error: 'Payload too large' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!bodyText || bodyText.trim() === '') {
      console.log('Empty body received - treating as ping');
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const payload = JSON.parse(bodyText);
    console.log('Aurinko webhook received');

    // Extract accountId for validation
    let accountId = payload.accountId || payload.subscription?.accountId;
    
    // Verify the accountId exists in our database before processing
    // Use uniform error response to prevent account enumeration
    if (accountId) {
      const isValidAccount = await verifyAurinkoRequest(supabase, accountId);
      if (!isValidAccount) {
        console.error('Aurinko webhook rejected: invalid accountId');
        // Return generic 200 to prevent enumeration via status code differences
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Aurinko webhook structure can be:
    // 1. Old format: { notification, resource, accountId }
    // 2. New format: { payloads: [{ changeType, resource, ... }], subscription: { accountId } }
    
    let notifications: any[] = [];

    // Handle new payloads array format
    if (payload.payloads && Array.isArray(payload.payloads)) {
      accountId = payload.subscription?.accountId || payload.accountId;
      notifications = payload.payloads
      notifications = payload.payloads
        .filter((p: any) => p.changeType === 'created' || p.changeType === 'updated')
        .map((p: any) => ({
          type: p.changeType === 'created' ? 'message.created' : 'message.updated',
          changeType: p.changeType,
          resource: p.resource || p,
        }));
      console.log('Parsed payloads array format, notifications:', notifications.length);
    } 
    // Handle old notification format
    else if (payload.notification && payload.resource) {
      notifications = [{ type: payload.notification, resource: payload.resource }];
      console.log('Parsed old notification format');
    }

    if (!accountId) {
      console.log('No accountId in webhook, might be a test ping');
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Find the email config for this account
    const { data: emailConfig, error: configError } = await supabase
      .from('email_provider_configs')
      .select('id, workspace_id, email_address, account_id, aliases, subscription_expires_at')
      .eq('account_id', accountId.toString())
      .single();

    if (configError || !emailConfig) {
      console.error('Email config not found for account:', accountId);
      return new Response(JSON.stringify({ error: 'Config not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get decrypted access token securely using config_id
    const { data: accessToken, error: tokenError } = await supabase
      .rpc('get_decrypted_access_token', { p_config_id: emailConfig.id });

    if (tokenError || !accessToken) {
      console.error('Failed to get access token for account:', accountId, tokenError);
      return new Response(JSON.stringify({ error: 'Failed to retrieve access token' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Add accessToken to emailConfig object for use in helper functions
    const emailConfigWithToken = { ...emailConfig, accessToken };

    console.log('Found email config for workspace:', emailConfig.workspace_id, 'processing', notifications.length, 'notifications');

    // Process each notification
    for (const notif of notifications) {
      if (notif.type === 'message.created' && notif.resource) {
        // New email arrived - process it
        await processNewEmail(supabase, emailConfigWithToken, notif.resource);
      } else if (notif.type === 'message.updated' && notif.resource) {
        // Email was updated (e.g., marked as read/unread externally)
        await processEmailUpdate(supabase, emailConfigWithToken, notif.resource);
      }
    }

    // Update last sync time
    await supabase
      .from('email_provider_configs')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', emailConfig.id);

    // Auto-renew subscription if expiring within 2 days
    if (emailConfig.subscription_expires_at) {
      const expiresAt = new Date(emailConfig.subscription_expires_at);
      const twoDaysFromNow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      if (expiresAt < twoDaysFromNow) {
        console.log('Subscription expiring soon, triggering renewal...');
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
        fetch(`${SUPABASE_URL}/functions/v1/refresh-aurinko-subscriptions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({ configId: emailConfig.id })
        }).catch(err => console.error('Auto-renewal trigger failed:', err));
      }
    }

    return new Response(JSON.stringify({ success: true, processed: notifications.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in aurinko-webhook:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function processNewEmail(supabase: any, emailConfig: any, emailData: any) {
  const messageId = emailData.id || emailData.messageId;
  console.log('Processing new email notification, messageId:', messageId);

  // Fetch full message details from Aurinko API
  const messageUrl = `https://api.aurinko.io/v1/email/messages/${messageId}`;
  console.log('Fetching message from:', messageUrl);

  const messageResponse = await fetch(messageUrl, {
    headers: {
      'Authorization': `Bearer ${emailConfig.accessToken}`,
    },
  });

  if (!messageResponse.ok) {
    const errorText = await messageResponse.text();
    console.error('Failed to fetch full message (attempt 1):', messageResponse.status, errorText);

    // Retry once after 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));
    const retryResponse = await fetch(messageUrl, {
      headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
    });

    if (!retryResponse.ok) {
      console.error('Failed to fetch full message (attempt 2), skipping email:', messageId);
      return;
    }

    const retryMessage = await retryResponse.json();
    return processEmailFromData(supabase, emailConfig, retryMessage, messageId);
  }

  const message = await messageResponse.json();
  console.log('Fetched full message:', {
    hasFrom: !!message.from,
    fromEmail: message.from?.email,
    hasTextBody: !!message.textBody,
    hasHtmlBody: !!message.htmlBody,
    hasBody: !!message.body,
    subject: message.subject,
  });
  
  return processEmailFromData(supabase, emailConfig, message, messageId);
}

async function processEmailFromData(supabase: any, emailConfig: any, message: any, originalMessageId?: string) {
  const senderEmail = (message.from?.email || message.sender?.email || '').toLowerCase();
  const senderName = message.from?.name || message.sender?.name || senderEmail.split('@')[0];
  const subject = message.subject || 'No Subject';
  const aurinkoMessageId = originalMessageId || message.id;
  
  // Try multiple fields for body content
  let body = message.textBody || message.text || message.body?.text || '';
  if (!body && message.htmlBody) {
    body = message.htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (!body && message.body?.html) {
    body = message.body.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (!body && message.snippet) {
    body = message.snippet;
  }
  
  console.log('Email body length:', body.length, 'preview:', body.substring(0, 100));

  // Extract the recipient (To) address
  let recipientEmail = emailConfig.email_address;
  if (message.to && Array.isArray(message.to) && message.to.length > 0) {
    const allOurAddresses = [
      emailConfig.email_address.toLowerCase(),
      ...(emailConfig.aliases || []).map((a: string) => a.toLowerCase()),
    ];

    const extractEmail = (value: any): string | null => {
      if (!value) return null;
      if (typeof value === 'string') return value;
      if (typeof value.email === 'string') return value.email;
      if (typeof value.address === 'string') return value.address;
      // Some providers nest email inside an object
      if (value.email && typeof value.email.address === 'string') return value.email.address;
      return null;
    };

    for (const toAddr of message.to) {
      const raw = extractEmail(toAddr);
      if (!raw) continue;
      const toEmail = raw.toLowerCase();
      if (allOurAddresses.includes(toEmail)) {
        recipientEmail = toEmail;
        break;
      }
    }
  }
  console.log('Recipient address (will reply from):', recipientEmail);

  if (!senderEmail) {
    console.log('No sender email, skipping');
    return;
  }

  // Skip emails from the connected account itself or any alias (outbound)
  const allOurAddresses = [
    emailConfig.email_address.toLowerCase(),
    ...(emailConfig.aliases || []).map((a: string) => a.toLowerCase())
  ];
  if (allOurAddresses.includes(senderEmail)) {
    console.log('Skipping outbound email from our account/alias');
    return;
  }

  // Find or create customer - UPSERT pattern to prevent duplicates
  let { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('workspace_id', emailConfig.workspace_id)
    .ilike('email', senderEmail)
    .single();

  if (!customer) {
    const { data: newCustomer, error: createError } = await supabase
      .from('customers')
      .insert({
        workspace_id: emailConfig.workspace_id,
        email: senderEmail.toLowerCase(),
        name: senderName,
        preferred_channel: 'email',
      })
      .select()
      .single();

    if (createError) {
      // Handle duplicate key error (race condition)
      if (createError.code === '23505') {
        console.log('Customer already exists (race condition), fetching...');
        const { data: existingCust } = await supabase
          .from('customers')
          .select('*')
          .eq('workspace_id', emailConfig.workspace_id)
          .ilike('email', senderEmail)
          .single();
        customer = existingCust;
      } else {
        console.error('Error creating customer:', createError);
        return;
      }
    } else {
      customer = newCustomer;
      console.log('Created new customer:', customer.id);
    }
  }

  if (!customer) {
    console.error('Could not find or create customer');
    return;
  }

  // Check for existing conversation with this email thread - UPSERT pattern
  const threadId = message.threadId || message.id;
  const externalConvId = `aurinko_${threadId}`;
  
  let { data: existingConversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('workspace_id', emailConfig.workspace_id)
    .eq('external_conversation_id', externalConvId)
    .single();

  let conversationId;
  let isNewConversation = false;

  if (existingConversation) {
    conversationId = existingConversation.id;
    await supabase
      .from('conversations')
      .update({
        status: 'open',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    console.log('Updated existing conversation:', conversationId);
  } else {
    isNewConversation = true;
    const { data: newConversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        workspace_id: emailConfig.workspace_id,
        customer_id: customer.id,
        channel: 'email',
        title: subject,
        status: 'new',
        external_conversation_id: externalConvId,
        metadata: { 
          aurinko_account_id: emailConfig.account_id,
          aurinko_message_id: aurinkoMessageId,
          original_recipient_email: recipientEmail,
        },
      })
      .select()
      .single();

    if (convError) {
      // Handle duplicate key error (race condition)
      if (convError.code === '23505') {
        console.log('Conversation already exists (race condition), fetching...');
        const { data: existingConv } = await supabase
          .from('conversations')
          .select('*')
          .eq('workspace_id', emailConfig.workspace_id)
          .eq('external_conversation_id', externalConvId)
          .single();
        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          console.error('Could not find conversation after race condition');
          return;
        }
      } else {
        console.error('Error creating conversation:', convError);
        return;
      }
    } else {
      conversationId = newConversation.id;
      console.log('Created new conversation:', conversationId);
    }
  }

  // Add message
  const { error: msgError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      actor_type: 'customer',
      actor_name: senderName,
      direction: 'inbound',
      channel: 'email',
      body: body.substring(0, 10000),
      raw_payload: message,
    });

  if (msgError) {
    console.error('Error creating message:', msgError);
    return;
  }

  console.log('Message added to conversation:', conversationId);

  // NOTE: We no longer mark email as read on arrival
  // Emails will be marked as read when the conversation is resolved in BizzyBee
  // This allows bi-directional sync with Gmail/Outlook

  // Step 1: Run deterministic pre-triage rules (zero cost, pattern matching only)
  try {
    const preTriageResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/pre-triage-rules`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          email: {
            from_email: senderEmail,
            from_name: senderName,
            subject: subject,
            body: body,
          },
          workspace_id: emailConfig.workspace_id,
        }),
      }
    );

    if (preTriageResponse.ok) {
      const triage = await preTriageResponse.json();
      console.log('Pre-triage result:', triage.rule_type, triage.decision_bucket, 'skip_llm:', triage.skip_llm);

      // Build update object with only columns that exist in conversations table
      const triageUpdate: Record<string, any> = {
        requires_reply: triage.requires_reply,
      };
      if (triage.decision_bucket) triageUpdate.decision_bucket = triage.decision_bucket;
      if (triage.classification) triageUpdate.email_classification = triage.classification;
      if (triage.confidence) triageUpdate.triage_confidence = triage.confidence;
      if (triage.why_this_needs_you) triageUpdate.why_this_needs_you = triage.why_this_needs_you;

      // Update conversation with classification
      if (triage.matched) {
        const { error: updateError } = await supabase
          .from('conversations')
          .update(triageUpdate)
          .eq('id', conversationId);

        if (updateError) {
          console.error('Failed to update triage:', updateError.message);
        }
      }

      // AI enrichment handles classification for emails pre-triage couldn't classify
      // (triggered separately after pre-triage completes)
    } else {
      console.error('Pre-triage call failed:', preTriageResponse.status);
    }
  } catch (triageErr) {
    // Non-blocking - email is already saved, classification is a bonus
    console.error('Pre-triage error (non-blocking):', triageErr);
  }

  // Step 3: Trigger AI enrichment (summary, draft, sentiment) — non-blocking
  try {
    fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-enrich-conversation`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          workspace_id: emailConfig.workspace_id,
        }),
      }
    ).catch(err => console.error('AI enrichment trigger failed:', err));
    console.log('Triggered AI enrichment for conversation:', conversationId);
  } catch (enrichErr) {
    console.error('AI enrichment error (non-blocking):', enrichErr);
  }

  console.log('Email fully processed, conversation:', conversationId);
}

// Process email update notifications (e.g., when email is marked as read/unread externally)
async function processEmailUpdate(supabase: any, emailConfig: any, emailData: any) {
  const messageId = emailData.id || emailData.messageId;
  console.log('Processing email update notification, messageId:', messageId);

  // Fetch the email details to check read status
  const messageUrl = `https://api.aurinko.io/v1/email/messages/${messageId}`;
  const messageResponse = await fetch(messageUrl, {
    headers: {
      'Authorization': `Bearer ${emailConfig.accessToken}`,
    },
  });

  if (!messageResponse.ok) {
    console.error('Failed to fetch message for update check:', messageResponse.status);
    return;
  }

  const message = await messageResponse.json();
  const isUnread = message.unread;
  const threadId = message.threadId || messageId;
  
  console.log('Email update - unread status:', isUnread, 'threadId:', threadId);

  // Find the conversation by external_conversation_id (thread ID)
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('id, status, metadata')
    .eq('workspace_id', emailConfig.workspace_id)
    .eq('external_conversation_id', `aurinko_${threadId}`)
    .single();

  if (convError || !conversation) {
    // Try finding by aurinko_message_id in metadata
    const { data: convByMsgId } = await supabase
      .from('conversations')
      .select('id, status, metadata')
      .eq('workspace_id', emailConfig.workspace_id)
      .filter('metadata->>aurinko_message_id', 'eq', messageId)
      .single();
    
    if (!convByMsgId) {
      console.log('No conversation found for this email update');
      return;
    }
    
    await handleReadStatusChange(supabase, convByMsgId, isUnread);
    return;
  }

  await handleReadStatusChange(supabase, conversation, isUnread);
}

async function handleReadStatusChange(supabase: any, conversation: any, isUnread: boolean) {
  const currentStatus = conversation.status;
  
  if (!isUnread && currentStatus !== 'resolved') {
    // Email was marked as READ externally -> auto-resolve the conversation
    console.log('Email marked as read externally, auto-resolving conversation:', conversation.id);
    
    await supabase
      .from('conversations')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);
    
    console.log('Conversation auto-resolved due to external read');
  } else if (isUnread && currentStatus === 'resolved') {
    // Email was marked as UNREAD externally -> reopen the conversation
    console.log('Email marked as unread externally, reopening conversation:', conversation.id);
    
    await supabase
      .from('conversations')
      .update({
        status: 'open',
        resolved_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);
    
    console.log('Conversation reopened due to external unread');
  }
}

async function markEmailAsRead(emailConfig: any, messageId: string) {
  try {
    console.log('Marking email as read:', messageId);
    const response = await fetch(`https://api.aurinko.io/v1/email/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${emailConfig.access_token}`,
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

