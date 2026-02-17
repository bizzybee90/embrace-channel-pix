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

    // Verify HMAC signature if webhook secret is configured
    const signature = req.headers.get('x-aurinko-signature') || req.headers.get('x-webhook-signature');
    const isValidSignature = await verifyWebhookSignature(bodyText, signature);
    if (!isValidSignature) {
      console.error('Webhook HMAC signature verification failed');
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
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

  // Fetch full message details from Aurinko API with body content
  // The bodyType=full parameter is required to get the actual email body
  const messageUrl = `https://api.aurinko.io/v1/email/messages/${messageId}?bodyType=full`;
  console.log('Fetching message from:', messageUrl);
  
  const messageResponse = await fetch(messageUrl, {
    headers: {
      'Authorization': `Bearer ${emailConfig.accessToken}`,
    },
  });

  if (!messageResponse.ok) {
    const errorText = await messageResponse.text();
    console.error('Failed to fetch full message:', messageResponse.status, errorText);
    return processEmailFromData(supabase, emailConfig, emailData, messageId);
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

  // Trigger triage and AI agent for processing
  if (body.length > 0) {
    await triggerAIAnalysis(supabase, conversationId, body, senderName, senderEmail, customer, subject, recipientEmail);
  }
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

async function triggerAIAnalysis(
  supabase: any, 
  conversationId: string, 
  body: string, 
  senderName: string, 
  senderEmail: string, 
  customer: any,
  subject: string,
  toEmail?: string
) {
  try {
    console.log('Triggering AI analysis pipeline for conversation:', conversationId);
    
    const senderDomain = senderEmail.split('@')[1]?.toLowerCase();
    
    // Fetch workspace
    const { data: workspace } = await supabase
      .from('users')
      .select('workspace_id')
      .limit(1)
      .single();
    
    const workspaceId = workspace?.workspace_id;

    // ============================================================
    // STEP 1: Call pre-triage-rules FIRST (deterministic, no LLM)
    // This should handle 30-50% of emails with 100% accuracy
    // ============================================================
    console.log('Step 1: Calling pre-triage-rules...');
    
    const preTriageResponse = await supabase.functions.invoke('pre-triage-rules', {
      body: {
        email: {
          from_email: senderEmail,
          from_name: senderName,
          subject: subject,
          body: body.substring(0, 5000),
        },
        workspace_id: workspaceId,
      }
    });

    console.log('Pre-triage response:', JSON.stringify(preTriageResponse.data || preTriageResponse.error));

    // If pre-triage matched a rule and wants to skip LLM
    if (preTriageResponse.data?.matched && preTriageResponse.data?.skip_llm) {
      const preTriage = preTriageResponse.data;
      console.log('Pre-triage matched! Skipping LLM. Bucket:', preTriage.decision_bucket);
      
      // Update conversation directly from pre-triage result
      const updateData: any = {
        status: preTriage.decision_bucket === 'auto_handled' ? 'resolved' : 'new',
        requires_reply: preTriage.requires_reply ?? false,
        decision_bucket: preTriage.decision_bucket,
        why_this_needs_you: preTriage.why_this_needs_you || `Matched rule: ${preTriage.rule_type}`,
        triage_confidence: 0.99,
        email_classification: preTriage.classification || 'automated_notification',
        urgency: preTriage.decision_bucket === 'act_now' ? 'high' : 'low',
        urgency_reason: `Pre-triage rule: ${preTriage.rule_type}`,
        cognitive_load: 'low',
        risk_level: 'none',
      };

      // Set auto_handled_at for metrics
      if (preTriage.decision_bucket === 'auto_handled') {
        updateData.auto_handled_at = new Date().toISOString();
        updateData.resolved_at = new Date().toISOString();
      }

      await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', conversationId);

      console.log('Conversation updated from pre-triage (no LLM call):', {
        bucket: preTriage.decision_bucket,
        rule_type: preTriage.rule_type,
      });

      // Update sender behaviour stats
      await updateSenderStats(supabase, workspaceId, senderDomain, senderEmail, preTriage.decision_bucket);

      return; // Skip LLM entirely!
    }

    // ============================================================
    // STEP 2: If pre-triage didn't match, call LLM triage agent
    // ============================================================
    console.log('Step 2: Pre-triage did not match, calling LLM triage agent...');

    // Fetch business context
    let businessContext = null;
    if (workspaceId) {
      const { data: context } = await supabase
        .from('business_context')
        .select('*')
        .eq('workspace_id', workspaceId)
        .single();
      businessContext = context;
    }

    // Fetch sender behaviour stats for personalization
    const { data: senderStats } = await supabase
      .from('sender_behaviour_stats')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('sender_domain', senderDomain)
      .maybeSingle();

    // Call the dedicated triage agent (Haiku - fast & cheap)
    const triageResponse = await supabase.functions.invoke('email-triage-agent', {
      body: {
        email: {
          from_email: senderEmail,
          from_name: senderName,
          subject: subject,
          body: body.substring(0, 5000),
          to_email: toEmail,
        },
        workspace_id: workspaceId,
        business_context: businessContext ? {
          is_hiring: businessContext.is_hiring,
          active_dispute: businessContext.active_stripe_case || businessContext.active_insurance_claim,
        } : null,
        sender_behaviour: senderStats ? {
          reply_rate: senderStats.reply_rate,
          ignored_rate: senderStats.ignored_rate,
          vip_score: senderStats.vip_score,
          suggested_bucket: senderStats.suggested_bucket,
        } : null,
        pre_triage_hints: preTriageResponse.data?.hints || null,
      }
    });

    console.log('Triage response:', JSON.stringify(triageResponse.data || triageResponse.error));

    if (triageResponse.error) {
      console.error('Triage agent error:', triageResponse.error);
      // On triage error, default to requiring human review
      await supabase
        .from('conversations')
        .update({
          status: 'new',
          requires_reply: true,
          urgency: 'high',
          urgency_reason: 'Triage failed - requires manual review',
        })
        .eq('id', conversationId);
      return;
    }

    const triage = triageResponse.data;

    // Determine status based on triage result
    let status = 'new';
    if (!triage.classification.requires_reply) {
      status = 'resolved'; // Auto-close non-reply emails
    } else if (triage.needs_human_review) {
      status = 'pending_review';
    } else if (triage.priority.urgency === 'high' && (triage.sentiment.tone === 'angry' || triage.sentiment.tone === 'frustrated')) {
      status = 'escalated';
    }

    // Update conversation with triage data
    const updateData: any = {
      status: status,
      requires_reply: triage.classification.requires_reply,
      email_classification: triage.classification.category,
      triage_confidence: triage.classification.confidence,
      urgency: triage.priority.urgency,
      urgency_reason: triage.priority.urgency_reason,
      ai_sentiment: triage.sentiment.tone,
      extracted_entities: triage.entities || {},
      suggested_actions: triage.suggested_actions || [],
      triage_reasoning: triage.reasoning,
      thread_context: triage.thread_context || {},
      summary_for_human: triage.summary?.one_line || null,
      title: triage.summary?.one_line || subject,
    };

    // Set resolved_at if auto-resolved
    if (!triage.classification.requires_reply) {
      updateData.resolved_at = new Date().toISOString();
    }

    // Set escalated_at if escalated
    if (status === 'escalated') {
      updateData.is_escalated = true;
      updateData.escalated_at = new Date().toISOString();
    }

    await supabase
      .from('conversations')
      .update(updateData)
      .eq('id', conversationId);

    console.log('Conversation updated with triage data:', {
      category: triage.classification.category,
      requires_reply: triage.classification.requires_reply,
      urgency: triage.priority.urgency,
      status: status,
    });

    // If requires reply and not escalated, generate AI draft response
    if (triage.classification.requires_reply && status !== 'escalated') {
      console.log('Generating AI draft response...');
      
      const aiResponse = await supabase.functions.invoke('claude-ai-agent-tools', {
        body: {
          message: {
            message_content: body.substring(0, 5000),
            channel: 'email',
            customer_identifier: senderEmail,
            customer_name: senderName,
            sender_phone: customer?.phone || null,
            sender_email: senderEmail,
          },
          conversation_history: [],
          customer_data: customer,
          triage_context: {
            category: triage.classification.category,
            urgency: triage.priority.urgency,
            sentiment: triage.sentiment.tone,
            entities: triage.entities,
            suggested_actions: triage.suggested_actions,
          }
        }
      });

      if (aiResponse.data && !aiResponse.error) {
        const aiOutput = aiResponse.data;
        
        // Update with AI draft response
        await supabase
          .from('conversations')
          .update({
            ai_draft_response: aiOutput.response || null,
            ai_confidence: aiOutput.confidence || triage.classification.confidence,
            ai_reason_for_escalation: aiOutput.escalation_reason || null,
            category: aiOutput.ai_category || triage.classification.category,
            is_escalated: aiOutput.escalate || false,
            status: aiOutput.escalate ? 'escalated' : status,
            escalated_at: aiOutput.escalate ? new Date().toISOString() : null,
          })
          .eq('id', conversationId);

        console.log('AI draft response generated:', {
          has_response: !!aiOutput.response,
          confidence: aiOutput.confidence,
          escalated: aiOutput.escalate,
        });
      } else {
        console.error('AI response generation error:', aiResponse.error);
      }
    }

    // Update sender behaviour stats after processing
    await updateSenderStats(supabase, workspaceId, senderDomain, senderEmail, triage.decision?.bucket || 'wait');

  } catch (aiError) {
    console.error('Triage/AI pipeline failed (non-blocking):', aiError);
    // Ensure conversation is at least visible
    await supabase
      .from('conversations')
      .update({
        status: 'new',
        requires_reply: true,
      })
      .eq('id', conversationId);
  }
}

// Helper to update sender behaviour stats
async function updateSenderStats(
  supabase: any,
  workspaceId: string | null,
  senderDomain: string,
  senderEmail: string,
  bucket: string
) {
  if (!workspaceId || !senderDomain) return;

  try {
    // Upsert sender stats
    const { data: existing } = await supabase
      .from('sender_behaviour_stats')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('sender_domain', senderDomain)
      .maybeSingle();

    const isAutoHandled = bucket === 'auto_handled';
    
    if (existing) {
      const totalMessages = (existing.total_messages || 0) + 1;
      const ignoredCount = (existing.ignored_count || 0) + (isAutoHandled ? 1 : 0);
      
      await supabase
        .from('sender_behaviour_stats')
        .update({
          total_messages: totalMessages,
          ignored_count: ignoredCount,
          ignored_rate: ignoredCount / totalMessages,
          last_interaction_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('sender_behaviour_stats')
        .insert({
          workspace_id: workspaceId,
          sender_domain: senderDomain,
          sender_email: senderEmail,
          total_messages: 1,
          ignored_count: isAutoHandled ? 1 : 0,
          ignored_rate: isAutoHandled ? 1 : 0,
          last_interaction_at: new Date().toISOString(),
        });
    }
  } catch (error) {
    console.error('Error updating sender stats:', error);
    // Non-blocking - don't fail the main flow
  }
}
