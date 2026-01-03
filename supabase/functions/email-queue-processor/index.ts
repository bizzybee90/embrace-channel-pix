import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4.28.0";

// Declare EdgeRuntime for Supabase Edge Functions
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 100;
const CLASSIFICATION_BATCH = 15;
const PARALLEL_WORKERS = 5;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const workspaceId = body.workspaceId;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! });

    // Get connected email for direction detection
    let connectedEmail: string | null = null;
    if (workspaceId) {
      const { data: config } = await supabase
        .from('email_provider_configs')
        .select('email_address')
        .eq('workspace_id', workspaceId)
        .single();
      connectedEmail = config?.email_address?.toLowerCase() || null;
    }

    // Build query - optionally filter by workspace
    let query = supabase
      .from('raw_emails')
      .select('*')
      .eq('status', 'pending')
      .lt('retry_count', 3)
      .order('received_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }

    const { data: emails } = await query;

    if (!emails || emails.length === 0) {
      console.log('[queue-processor] No pending emails');
      
      // Check if we should trigger Phase 2
      if (workspaceId) {
        await checkAndTriggerPhase2(supabase, workspaceId);
      }
      
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[queue-processor] Processing ${emails.length} emails for workspace: ${workspaceId || 'all'}`);

    // Mark as processing
    const emailIds = emails.map(e => e.id);
    await supabase.from('raw_emails')
      .update({ status: 'processing', processing_started_at: new Date().toISOString() })
      .in('id', emailIds);

    let classifiedCount = 0;

    // Process in batches
    for (let i = 0; i < emails.length; i += CLASSIFICATION_BATCH) {
      const batch = emails.slice(i, i + CLASSIFICATION_BATCH);
      
      const classifications = await classifyBatch(openai, batch);

      const classifiedEmails: any[] = [];
      const failedEmails: any[] = [];

      for (let j = 0; j < batch.length; j++) {
        const email = batch[j];
        const result = classifications[j];

        if (result?.email_type) {
          classifiedEmails.push({ email, result });
          classifiedCount++;
        } else {
          failedEmails.push(email);
        }
      }

      // Process classified emails in parallel
      await Promise.all(classifiedEmails.map(async ({ email, result }) => {
        await supabase.from('raw_emails').update({
          status: 'classified',
          classification: result,
          email_type: result.email_type,
          lane: result.lane,
          confidence: result.confidence,
          processing_completed_at: new Date().toISOString()
        }).eq('id', email.id);

        await createConversationAndMessage(supabase, email, result, connectedEmail);
      }));

      // Update failed emails
      if (failedEmails.length > 0) {
        await Promise.all(failedEmails.map(email =>
          supabase.from('raw_emails').update({
            status: 'pending',
            retry_count: (email.retry_count || 0) + 1
          }).eq('id', email.id)
        ));
      }
      
      // Minimal delay between classification batches
      if (i + CLASSIFICATION_BATCH < emails.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Update progress for all affected workspaces
    const workspaceIds = [...new Set(emails.map(e => e.workspace_id))];
    for (const wsId of workspaceIds) {
      await updateProgress(supabase, wsId);
    }

    console.log(`[queue-processor] Classified ${classifiedCount}/${emails.length} emails`);

    // Check if there are more pending emails - if so, spawn parallel workers
    const { count: remainingCount } = await supabase
      .from('raw_emails')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lt('retry_count', 3);

    if (remainingCount && remainingCount > 0) {
      console.log(`[queue-processor] ${remainingCount} emails remaining, spawning ${PARALLEL_WORKERS} parallel workers...`);
      
      EdgeRuntime.waitUntil((async () => {
        const workers = [];
        const workersToSpawn = Math.min(PARALLEL_WORKERS, Math.ceil(remainingCount / BATCH_SIZE));
        
        for (let i = 0; i < workersToSpawn; i++) {
          workers.push(
            supabase.functions.invoke('email-queue-processor', {
              body: { workspaceId }
            })
          );
        }
        
        await Promise.all(workers);
      })());
    } else if (workspaceId) {
      // No more pending emails - check if we should trigger Phase 2
      await checkAndTriggerPhase2(supabase, workspaceId);
    }

    return new Response(JSON.stringify({ 
      processed: emails.length, 
      classified: classifiedCount,
      remaining: remainingCount || 0
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[queue-processor] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function classifyBatch(openai: OpenAI, emails: any[]) {
  const emailText = emails.map((e, i) => 
    `[${i}] Folder: ${e.folder || 'INBOX'} | From: ${e.from_email} | Subject: ${e.subject || '(none)'} | Body: ${(e.body_text || '').substring(0, 400)}`
  ).join('\n\n');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: `Classify these ${emails.length} emails. Return a JSON array with one object per email.

${emailText}

Return ONLY a JSON array like this (no markdown, no code blocks):
[{"email_type": "customer|newsletter|receipt|spam", "lane": "urgent|to_reply|training|done", "confidence": 0.0-1.0, "reason": "brief reason"}]

- customer: Emails from potential or existing customers wanting to do business
- newsletter: Marketing emails, newsletters, promotional content
- receipt: Automated transactional emails, confirmations, invoices
- spam: Junk, solicitations, irrelevant

Lanes:
- urgent: Customer complaints, time-sensitive requests
- to_reply: Quote requests, booking inquiries, general questions
- training: Past conversations to learn from
- done: No reply needed (newsletters, spam, receipts)`
      }]
    });

    let text = response.choices[0]?.message?.content || '[]';
    text = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(text);
  } catch (error) {
    console.error('[queue-processor] Classification error:', error);
    return emails.map(() => null);
  }
}

async function createConversationAndMessage(
  supabase: any, 
  email: any, 
  classification: any,
  connectedEmail: string | null
) {
  // Determine direction using email addresses (most reliable)
  const fromEmail = (email.from_email || '').toLowerCase();
  const folder = (email.folder || '').toUpperCase();
  
  let direction: 'inbound' | 'outbound' = 'inbound';
  
  // SENT folder emails are always outbound
  if (folder === 'SENT' || folder === 'SENT MAIL' || folder === 'SENT ITEMS') {
    direction = 'outbound';
  } 
  // If we have the connected email, compare against it
  else if (connectedEmail && fromEmail === connectedEmail) {
    direction = 'outbound';
  }
  // Use the direction stored during import if available
  else if (email.direction) {
    direction = email.direction;
  }

  // CRITICAL FIX: Create messages for ALL SENT/outbound emails (needed for voice learning)
  // Only skip inbound non-customer emails
  if (direction === 'inbound' && classification.email_type !== 'customer') {
    return; // Skip newsletters, spam, receipts that are inbound
  }

  // For outbound emails from SENT folder, we always create (for voice learning)
  // For inbound customer emails, we create (for conversation tracking)

  const customerEmail = direction === 'inbound' ? email.from_email : email.to_email;

  if (!customerEmail) return;

  // Find or create customer
  let { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('workspace_id', email.workspace_id)
    .eq('email', customerEmail)
    .single();

  if (!customer) {
    const { data: newCustomer } = await supabase
      .from('customers')
      .insert({ 
        workspace_id: email.workspace_id, 
        email: customerEmail, 
        name: direction === 'inbound' ? email.from_name : email.to_name 
      })
      .select('id')
      .single();
    customer = newCustomer;
  }

  if (!customer) return;

  // Find or create conversation using thread_id
  let { data: conversation } = await supabase
    .from('conversations')
    .select('id')
    .eq('workspace_id', email.workspace_id)
    .eq('external_conversation_id', email.thread_id)
    .single();

  if (!conversation) {
    const { data: newConv } = await supabase
      .from('conversations')
      .insert({
        workspace_id: email.workspace_id,
        customer_id: customer.id,
        external_conversation_id: email.thread_id,
        title: email.subject,
        channel: 'email',
        lane: classification.lane,
        status: 'open',
        updated_at: email.received_at
      })
      .select('id')
      .single();
    conversation = newConv;
  }

  if (!conversation) return;

  // Create message
  await supabase.from('messages').upsert({
    workspace_id: email.workspace_id,
    conversation_id: conversation.id,
    external_id: email.external_id,
    direction,
    channel: 'email',
    from_identifier: email.from_email,
    from_name: email.from_name,
    body: email.body_text,
    body_html: email.body_html,
    subject: email.subject,
    received_at: email.received_at,
    metadata: { classification, folder: email.folder }
  }, { onConflict: 'workspace_id,external_id' });

  // Update conversation timestamp
  await supabase.from('conversations')
    .update({ updated_at: email.received_at })
    .eq('id', conversation.id);
}

async function updateProgress(supabase: any, workspaceId: string) {
  const { count: total } = await supabase
    .from('raw_emails').select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);
  
  const { count: classified } = await supabase
    .from('raw_emails').select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId).eq('status', 'classified');

  const { count: pending } = await supabase
    .from('raw_emails').select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId).eq('status', 'pending');

  const { count: processing } = await supabase
    .from('raw_emails').select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId).eq('status', 'processing');

  const isComplete = pending === 0 && processing === 0 && (classified || 0) > 0;

  await supabase.from('email_import_progress').upsert({
    workspace_id: workspaceId,
    current_phase: isComplete ? 'analyzing' : 'classifying',
    phase1_status: isComplete ? 'complete' : 'running',
    phase1_completed_at: isComplete ? new Date().toISOString() : undefined,
    emails_received: total || 0,
    emails_classified: classified || 0,
    updated_at: new Date().toISOString()
  }, { onConflict: 'workspace_id' });

  return isComplete;
}

async function checkAndTriggerPhase2(supabase: any, workspaceId: string) {
  // Check both pending AND processing counts - must both be 0
  const { count: pending } = await supabase
    .from('raw_emails').select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending');

  const { count: processing } = await supabase
    .from('raw_emails').select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'processing');

  const { count: classified } = await supabase
    .from('raw_emails').select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'classified');

  // All emails must be classified (pending=0, processing=0, classified>0)
  if (pending === 0 && processing === 0 && (classified || 0) > 0) {
    // Check if Phase 2 is already running or complete - prevent double trigger
    const { data: progress } = await supabase
      .from('email_import_progress')
      .select('phase2_status')
      .eq('workspace_id', workspaceId)
      .single();

    if (progress?.phase2_status === 'running' || progress?.phase2_status === 'complete') {
      console.log('[queue-processor] Phase 2 already triggered, skipping');
      return;
    }

    console.log('[queue-processor] Phase 1 complete, triggering Phase 2 (analyze-conversations)');
    
    await supabase.from('email_import_progress').update({
      current_phase: 'analyzing',
      phase1_status: 'complete',
      phase1_completed_at: new Date().toISOString(),
      phase2_status: 'running',
      updated_at: new Date().toISOString()
    }).eq('workspace_id', workspaceId);

    EdgeRuntime.waitUntil((async () => {
      const { error } = await supabase.functions.invoke('email-analyze-conversations', {
        body: { workspaceId }
      });
      if (error) {
        console.error('[queue-processor] Failed to invoke analyze-conversations:', error);
      }
    })());
  }
}
