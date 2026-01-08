import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================================
// CONSTANTS
// =============================================================================

const FUNCTION_NAME = 'email-classify';
const MAX_BATCH_SIZE = 50;
const MAX_BODY_LENGTH_FOR_AI = 500; // Truncate email bodies to save tokens

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const AI_MODEL = 'anthropic/claude-sonnet-4';

// =============================================================================
// TYPES
// =============================================================================

interface ClassifyRequest {
  workspace_id: string;
  limit?: number;
}

interface RawEmail {
  id: string;
  workspace_id: string;
  external_id: string;
  thread_id: string;
  folder: 'INBOX' | 'SENT';
  from_email: string;
  from_name: string | null;
  to_email: string;
  subject: string;
  body_text: string;
  received_at: string;
  processed: boolean;
}

interface Classification {
  external_id: string;
  intent: 'quote_request' | 'booking' | 'complaint' | 'question' | 'feedback' | 'spam' | 'other';
  sentiment: 'positive' | 'neutral' | 'negative';
  priority: 'high' | 'medium' | 'low';
  requires_response: boolean;
  summary: string;
}

interface ProcessingStats {
  emailsProcessed: number;
  customersCreated: number;
  conversationsCreated: number;
  messagesCreated: number;
  errors: number;
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const startTime = Date.now();
  let currentStep = 'initializing';

  try {
    // -------------------------------------------------------------------------
    // Step 1: Validate Environment
    // -------------------------------------------------------------------------
    currentStep = 'validating_environment';
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL environment variable is not configured');
    }
    if (!supabaseServiceKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not configured');
    }
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY environment variable is not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // -------------------------------------------------------------------------
    // Step 2: Validate Input
    // -------------------------------------------------------------------------
    currentStep = 'validating_input';

    const body = await req.json() as ClassifyRequest;
    
    if (!body.workspace_id) {
      throw new Error('workspace_id is required');
    }
    if (typeof body.workspace_id !== 'string') {
      throw new Error('workspace_id must be a string');
    }

    const workspaceId = body.workspace_id;
    const limit = Math.min(body.limit || MAX_BATCH_SIZE, MAX_BATCH_SIZE);

    console.log(`[${FUNCTION_NAME}] Starting classification`, {
      workspace_id: workspaceId,
      requested_limit: body.limit,
      effective_limit: limit,
    });

    // -------------------------------------------------------------------------
    // Step 3: Fetch Unprocessed Emails
    // -------------------------------------------------------------------------
    currentStep = 'fetching_unprocessed_emails';

    const { data: rawEmails, error: fetchError } = await supabase
      .from('raw_emails')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('processed', false)
      .order('received_at', { ascending: true })
      .limit(limit);

    if (fetchError) {
      throw new Error(`Failed to fetch raw emails: ${fetchError.message}`);
    }

    // Handle empty result
    if (!rawEmails || rawEmails.length === 0) {
      console.log(`[${FUNCTION_NAME}] No unprocessed emails found`);
      return createSuccessResponse({
        classified: 0,
        conversations_created: 0,
        customers_created: 0,
        messages_created: 0,
      }, startTime);
    }

    console.log(`[${FUNCTION_NAME}] Found ${rawEmails.length} unprocessed emails`);

    // -------------------------------------------------------------------------
    // Step 4: Classify Emails with AI
    // -------------------------------------------------------------------------
    currentStep = 'classifying_with_ai';

    const classifications = await classifyEmailsWithAI(rawEmails as RawEmail[], lovableApiKey);
    
    console.log(`[${FUNCTION_NAME}] AI classified ${classifications.length} of ${rawEmails.length} emails`);

    // Create lookup map for O(1) access
    const classificationMap = new Map<string, Classification>(
      classifications.map(c => [c.external_id, c])
    );

    // -------------------------------------------------------------------------
    // Step 5: Pre-fetch Existing Records for Accurate Counting
    // -------------------------------------------------------------------------
    currentStep = 'prefetching_existing_records';

    // Extract unique customer emails from the batch
    const customerEmailsInBatch = [...new Set(
      rawEmails.map((email: RawEmail) => {
        const isInbound = email.folder === 'INBOX';
        return (isInbound ? email.from_email : email.to_email)?.toLowerCase();
      }).filter(Boolean)
    )] as string[];

    // Extract unique thread IDs from the batch
    const threadIdsInBatch = [...new Set(
      rawEmails.map((email: RawEmail) => email.thread_id).filter(Boolean)
    )] as string[];

    // Fetch existing customers
    const { data: existingCustomers, error: customersQueryError } = await supabase
      .from('customers')
      .select('email')
      .eq('workspace_id', workspaceId)
      .in('email', customerEmailsInBatch);

    if (customersQueryError) {
      console.warn(`[${FUNCTION_NAME}] Warning: Could not prefetch customers: ${customersQueryError.message}`);
    }

    const existingCustomerEmails = new Set(
      (existingCustomers || []).map(c => c.email.toLowerCase())
    );

    // Fetch existing conversations
    const { data: existingConversations, error: conversationsQueryError } = await supabase
      .from('conversations')
      .select('source_id')
      .eq('workspace_id', workspaceId)
      .in('source_id', threadIdsInBatch);

    if (conversationsQueryError) {
      console.warn(`[${FUNCTION_NAME}] Warning: Could not prefetch conversations: ${conversationsQueryError.message}`);
    }

    const existingThreadIds = new Set(
      (existingConversations || []).map(c => c.source_id)
    );

    console.log(`[${FUNCTION_NAME}] Pre-fetch complete`, {
      existing_customers: existingCustomerEmails.size,
      existing_conversations: existingThreadIds.size,
    });

    // -------------------------------------------------------------------------
    // Step 6: Process Each Email
    // -------------------------------------------------------------------------
    currentStep = 'processing_emails';

    const stats: ProcessingStats = {
      emailsProcessed: 0,
      customersCreated: 0,
      conversationsCreated: 0,
      messagesCreated: 0,
      errors: 0,
    };

    for (const email of rawEmails as RawEmail[]) {
      try {
        const classification = classificationMap.get(email.external_id);
        
        if (!classification) {
          console.warn(`[${FUNCTION_NAME}] No classification found for email ${email.external_id}, skipping`);
          stats.errors++;
          continue;
        }

        const result = await processEmail(
          supabase,
          workspaceId,
          email,
          classification,
          existingCustomerEmails,
          existingThreadIds
        );

        stats.emailsProcessed++;
        if (result.customerCreated) stats.customersCreated++;
        if (result.conversationCreated) stats.conversationsCreated++;
        if (result.messageCreated) stats.messagesCreated++;

      } catch (emailError: any) {
        console.error(`[${FUNCTION_NAME}] Failed to process email ${email.external_id}:`, emailError.message);
        stats.errors++;
        // Continue processing other emails - graceful degradation
      }
    }

    // -------------------------------------------------------------------------
    // Step 7: Return Results
    // -------------------------------------------------------------------------
    const duration = Date.now() - startTime;
    
    console.log(`[${FUNCTION_NAME}] Classification complete in ${duration}ms`, {
      emails_processed: stats.emailsProcessed,
      customers_created: stats.customersCreated,
      conversations_created: stats.conversationsCreated,
      messages_created: stats.messagesCreated,
      errors: stats.errors,
    });

    return createSuccessResponse({
      classified: stats.emailsProcessed,
      conversations_created: stats.conversationsCreated,
      customers_created: stats.customersCreated,
      messages_created: stats.messagesCreated,
      errors: stats.errors,
    }, startTime);

  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    console.error(`[${FUNCTION_NAME}] Fatal error at step '${currentStep}':`, {
      error: error.message,
      stack: error.stack,
      duration_ms: duration,
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: FUNCTION_NAME,
        step: currentStep,
        duration_ms: duration,
      }),
      { 
        status: 500, 
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Classifies a batch of emails using the Lovable AI Gateway.
 */
async function classifyEmailsWithAI(
  emails: RawEmail[], 
  apiKey: string
): Promise<Classification[]> {
  
  // Prepare email summaries for AI (truncate body to save tokens)
  const emailSummaries = emails.map(email => ({
    id: email.external_id,
    folder: email.folder,
    from: email.from_email,
    subject: email.subject || '(no subject)',
    body: (email.body_text || '').substring(0, MAX_BODY_LENGTH_FOR_AI),
  }));

  const prompt = `You are an email classifier for a customer service system. Analyze each email and classify it.

For each email, return a JSON object with these fields:
- external_id: the email id (use the "id" field from the input)
- intent: One of: quote_request, booking, complaint, question, feedback, spam, other
- sentiment: One of: positive, neutral, negative
- priority: One of: high, medium, low
  - high: Urgent issues, complaints, time-sensitive requests
  - medium: Standard inquiries, quote requests
  - low: General feedback, FYI emails, spam
- requires_response: boolean - true if this email needs a reply
- summary: A one-sentence summary of the email content

EMAILS TO CLASSIFY:
${JSON.stringify(emailSummaries, null, 2)}

Return ONLY a valid JSON array of classification objects, no other text or markdown.`;

  const response = await fetch(AI_GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`AI Gateway error (${response.status}): ${errorBody}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('AI Gateway returned empty response');
  }

  // Parse JSON from response (handle potential markdown code blocks)
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error(`[${FUNCTION_NAME}] Failed to parse AI response:`, content.substring(0, 500));
    throw new Error('AI response did not contain valid JSON array');
  }

  try {
    return JSON.parse(jsonMatch[0]) as Classification[];
  } catch (parseError) {
    console.error(`[${FUNCTION_NAME}] JSON parse error:`, parseError);
    throw new Error('Failed to parse AI classification response as JSON');
  }
}

/**
 * Processes a single email: creates/updates customer, conversation, and message.
 */
async function processEmail(
  supabase: SupabaseClient,
  workspaceId: string,
  email: RawEmail,
  classification: Classification,
  existingCustomerEmails: Set<string>,
  existingThreadIds: Set<string>
): Promise<{ customerCreated: boolean; conversationCreated: boolean; messageCreated: boolean }> {
  
  const isInbound = email.folder === 'INBOX';
  const customerEmail = (isInbound ? email.from_email : email.to_email)?.toLowerCase();

  if (!customerEmail) {
    throw new Error('Email has no valid customer email address');
  }

  const isNewCustomer = !existingCustomerEmails.has(customerEmail);
  const isNewConversation = !existingThreadIds.has(email.thread_id);

  // -------------------------------------------------------------------------
  // Upsert Customer
  // -------------------------------------------------------------------------
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .upsert(
      {
        workspace_id: workspaceId,
        email: customerEmail,
        name: isInbound ? email.from_name : null,
      },
      { onConflict: 'workspace_id,email' }
    )
    .select('id')
    .single();

  if (customerError) {
    throw new Error(`Failed to upsert customer: ${customerError.message}`);
  }

  // Track for subsequent emails in this batch
  if (isNewCustomer) {
    existingCustomerEmails.add(customerEmail);
  }

  // -------------------------------------------------------------------------
  // Upsert Conversation
  // -------------------------------------------------------------------------
  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .upsert(
      {
        workspace_id: workspaceId,
        customer_id: customer.id,
        source_id: email.thread_id,
        channel: 'email',
        title: email.subject,
        status: classification.requires_response ? 'open' : 'closed',
        priority: classification.priority,
        category: classification.intent,
        lane: classification.requires_response ? 'inbox' : 'done',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,source_id' }
    )
    .select('id')
    .single();

  if (conversationError) {
    throw new Error(`Failed to upsert conversation: ${conversationError.message}`);
  }

  // Track for subsequent emails in this batch
  if (isNewConversation) {
    existingThreadIds.add(email.thread_id);
  }

  // -------------------------------------------------------------------------
  // Insert Message (ignore duplicates via unique constraint)
  // -------------------------------------------------------------------------
  let messageCreated = false;
  
  const { error: messageError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      direction: isInbound ? 'inbound' : 'outbound',
      body: email.body_text,
      from_email: email.from_email,
      to_email: email.to_email,
      external_id: email.external_id,
      created_at: email.received_at,
    });

  if (messageError) {
    // Check if it's a duplicate key error (expected for already-imported messages)
    if (messageError.code === '23505') {
      console.log(`[${FUNCTION_NAME}] Message ${email.external_id} already exists, skipping`);
    } else {
      throw new Error(`Failed to insert message: ${messageError.message}`);
    }
  } else {
    messageCreated = true;
  }

  // -------------------------------------------------------------------------
  // Mark Raw Email as Processed
  // -------------------------------------------------------------------------
  const { error: updateError } = await supabase
    .from('raw_emails')
    .update({
      processed: true,
      classification: classification,
    })
    .eq('id', email.id);

  if (updateError) {
    // Log but don't fail - the email was processed, just not marked
    console.warn(`[${FUNCTION_NAME}] Warning: Could not mark email ${email.id} as processed: ${updateError.message}`);
  }

  return {
    customerCreated: isNewCustomer,
    conversationCreated: isNewConversation,
    messageCreated,
  };
}

/**
 * Creates a standardized success response.
 */
function createSuccessResponse(data: Record<string, any>, startTime: number): Response {
  return new Response(
    JSON.stringify({
      success: true,
      ...data,
      duration_ms: Date.now() - startTime,
    }),
    { 
      status: 200, 
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } 
    }
  );
}
