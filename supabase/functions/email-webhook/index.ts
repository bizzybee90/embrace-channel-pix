import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AurinkoWebhookPayload {
  accountId: string;
  type: string;
  payload: {
    messageId: string;
    threadId?: string;
    folder?: string;
  };
}

interface ClassificationResult {
  intent: string;
  sentiment: string;
  priority: string;
  requires_response: boolean;
  summary: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'email-webhook';
  let step = 'initializing';

  try {
    // Parse webhook payload
    step = 'parsing_webhook';
    const webhookPayload: AurinkoWebhookPayload = await req.json();
    
    console.log(`[${functionName}] Received webhook:`, {
      type: webhookPayload.type,
      accountId: webhookPayload.accountId,
      messageId: webhookPayload.payload?.messageId
    });

    // Only process new message events
    if (webhookPayload.type !== 'newMessage' && webhookPayload.type !== 'messageCreated') {
      console.log(`[${functionName}] Ignoring webhook type: ${webhookPayload.type}`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'Unsupported webhook type' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate required fields
    if (!webhookPayload.accountId) {
      throw new Error('accountId is required in webhook payload');
    }
    if (!webhookPayload.payload?.messageId) {
      throw new Error('payload.messageId is required in webhook payload');
    }

    // Initialize Supabase client
    step = 'initializing_supabase';
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase environment variables not configured');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Look up workspace by Aurinko account_id
    step = 'looking_up_workspace';
    const { data: emailConfig, error: configError } = await supabase
      .from('email_provider_configs')
      .select('workspace_id, access_token, email_address')
      .eq('account_id', webhookPayload.accountId)
      .single();

    if (configError || !emailConfig) {
      throw new Error(`No workspace found for account_id: ${webhookPayload.accountId}`);
    }

    const { workspace_id, access_token, email_address: workspaceEmail } = emailConfig;
    console.log(`[${functionName}] Found workspace: ${workspace_id}`);

    // Check if we already processed this email
    step = 'checking_duplicate';
    const { data: existingEmail } = await supabase
      .from('raw_emails')
      .select('id')
      .eq('workspace_id', workspace_id)
      .eq('external_id', webhookPayload.payload.messageId)
      .single();

    if (existingEmail) {
      console.log(`[${functionName}] Email already processed: ${webhookPayload.payload.messageId}`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'Already processed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch full email from Aurinko
    step = 'fetching_email_from_aurinko';
    const aurinkoResponse = await fetch(
      `https://api.aurinko.io/v1/email/messages/${webhookPayload.payload.messageId}`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!aurinkoResponse.ok) {
      const errorBody = await aurinkoResponse.text();
      throw new Error(`Aurinko API error ${aurinkoResponse.status}: ${errorBody}`);
    }

    const emailData = await aurinkoResponse.json();
    console.log(`[${functionName}] Fetched email:`, {
      id: emailData.id,
      subject: emailData.subject?.substring(0, 50),
      from: emailData.from?.email
    });

    // Determine if this is inbound or outbound
    const fromEmail = emailData.from?.email?.toLowerCase() || '';
    const isInbound = fromEmail !== workspaceEmail?.toLowerCase();
    
    // Skip outbound emails (sent by the workspace)
    if (!isInbound) {
      console.log(`[${functionName}] Skipping outbound email from workspace`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'Outbound email' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract email content
    const rawEmail = {
      workspace_id,
      external_id: emailData.id,
      thread_id: emailData.threadId || emailData.id,
      folder: 'INBOX',
      from_email: emailData.from?.email || '',
      from_name: emailData.from?.name || '',
      to_email: emailData.to?.[0]?.email || workspaceEmail || '',
      subject: emailData.subject || '(No Subject)',
      body_text: emailData.textBody || emailData.htmlBody || '',
      received_at: emailData.date || new Date().toISOString(),
      processed: false
    };

    // Save to raw_emails
    step = 'saving_raw_email';
    const { error: rawEmailError } = await supabase
      .from('raw_emails')
      .insert(rawEmail);

    if (rawEmailError) {
      if (rawEmailError.code === '23505') {
        console.log(`[${functionName}] Duplicate email, already exists`);
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: 'Duplicate' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Failed to save raw email: ${rawEmailError.message}`);
    }

    console.log(`[${functionName}] Saved raw email`);

    // Classify email with AI
    step = 'classifying_email';
    const classification = await classifyEmail(rawEmail.subject, rawEmail.body_text);
    console.log(`[${functionName}] Classification:`, classification);

    // Update raw_email with classification
    step = 'updating_classification';
    await supabase
      .from('raw_emails')
      .update({ 
        processed: true 
      })
      .eq('workspace_id', workspace_id)
      .eq('external_id', rawEmail.external_id);

    // Upsert customer
    step = 'upserting_customer';
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .upsert({
        workspace_id,
        email: rawEmail.from_email,
        name: rawEmail.from_name || rawEmail.from_email.split('@')[0]
      }, {
        onConflict: 'workspace_id,email'
      })
      .select('id')
      .single();

    if (customerError) {
      throw new Error(`Failed to upsert customer: ${customerError.message}`);
    }

    console.log(`[${functionName}] Upserted customer: ${customer.id}`);

    // Upsert conversation
    step = 'upserting_conversation';
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .upsert({
        workspace_id,
        customer_id: customer.id,
        source_id: rawEmail.thread_id,
        channel: 'email',
        title: rawEmail.subject,
        subject: rawEmail.subject,
        status: 'open',
        priority: classification.priority || 'medium',
        intent: classification.intent || 'other',
        lane: 'inbox',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'workspace_id,source_id'
      })
      .select('id')
      .single();

    if (convError) {
      throw new Error(`Failed to upsert conversation: ${convError.message}`);
    }

    console.log(`[${functionName}] Upserted conversation: ${conversation.id}`);

    // Create message
    step = 'creating_message';
    const { error: messageError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        direction: 'inbound',
        body: rawEmail.body_text,
        from_email: rawEmail.from_email,
        to_email: rawEmail.to_email,
        external_id: rawEmail.external_id,
        is_ai_draft: false
      });

    if (messageError) {
      // Duplicate message is okay
      if (messageError.code !== '23505') {
        throw new Error(`Failed to create message: ${messageError.message}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms:`, {
      conversation_id: conversation.id,
      customer_id: customer.id,
      priority: classification.priority,
      intent: classification.intent
    });

    return new Response(
      JSON.stringify({
        success: true,
        conversation_id: conversation.id,
        customer_id: customer.id,
        classification,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[${functionName}] Error at step "${step}":`, error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: functionName,
        step,
        duration_ms: duration
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function classifyEmail(subject: string, body: string): Promise<ClassificationResult> {
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  
  if (!lovableApiKey) {
    console.warn('[classifyEmail] LOVABLE_API_KEY not set, using default classification');
    return {
      intent: 'other',
      sentiment: 'neutral',
      priority: 'medium',
      requires_response: true,
      summary: subject || 'No subject'
    };
  }

  const prompt = `Classify this email and return ONLY valid JSON, no other text.

SUBJECT: ${subject}

BODY: ${body.substring(0, 2000)}

Return this exact JSON structure:
{
  "intent": "quote_request" | "booking" | "complaint" | "question" | "feedback" | "spam" | "other",
  "sentiment": "positive" | "neutral" | "negative",
  "priority": "high" | "medium" | "low",
  "requires_response": true | false,
  "summary": "one sentence summary"
}

Classification rules:
- quote_request: asking for pricing or quotes
- booking: wanting to schedule or book
- complaint: expressing dissatisfaction
- question: asking for information
- feedback: providing feedback (positive or negative)
- spam: marketing, automated, or irrelevant
- other: doesn't fit above categories

Priority rules:
- high: complaints, urgent requests, time-sensitive
- medium: questions, bookings, quotes
- low: feedback, spam, FYI messages`;

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`AI Gateway error ${response.status}: ${errorBody}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content || '';
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in AI response');
    }

    const classification = JSON.parse(jsonMatch[0]);
    
    // Validate and sanitize
    return {
      intent: ['quote_request', 'booking', 'complaint', 'question', 'feedback', 'spam', 'other']
        .includes(classification.intent) ? classification.intent : 'other',
      sentiment: ['positive', 'neutral', 'negative']
        .includes(classification.sentiment) ? classification.sentiment : 'neutral',
      priority: ['high', 'medium', 'low']
        .includes(classification.priority) ? classification.priority : 'medium',
      requires_response: classification.requires_response !== false,
      summary: String(classification.summary || subject).substring(0, 200)
    };

  } catch (error: any) {
    console.error('[classifyEmail] Classification failed:', error.message);
    return {
      intent: 'other',
      sentiment: 'neutral',
      priority: 'medium',
      requires_response: true,
      summary: subject || 'No subject'
    };
  }
}
