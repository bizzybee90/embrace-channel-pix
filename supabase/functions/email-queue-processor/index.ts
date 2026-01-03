import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4.28.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 50;
const CLASSIFICATION_BATCH = 10;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! });

    // Get pending emails
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('*')
      .eq('status', 'pending')
      .lt('retry_count', 3)
      .order('received_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (!emails || emails.length === 0) {
      console.log('[queue-processor] No pending emails');
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[queue-processor] Processing ${emails.length} emails`);

    // Mark as processing
    const emailIds = emails.map(e => e.id);
    await supabase.from('raw_emails')
      .update({ status: 'processing', processing_started_at: new Date().toISOString() })
      .in('id', emailIds);

    let classifiedCount = 0;

    // Process in batches of 10
    for (let i = 0; i < emails.length; i += CLASSIFICATION_BATCH) {
      const batch = emails.slice(i, i + CLASSIFICATION_BATCH);
      
      const classifications = await classifyBatch(openai, batch);

      for (let j = 0; j < batch.length; j++) {
        const email = batch[j];
        const result = classifications[j];

        if (result?.email_type) {
          await supabase.from('raw_emails').update({
            status: 'classified',
            classification: result,
            email_type: result.email_type,
            lane: result.lane,
            confidence: result.confidence,
            processing_completed_at: new Date().toISOString()
          }).eq('id', email.id);

          // Create conversation and message
          await createConversationAndMessage(supabase, email, result);
          classifiedCount++;
        } else {
          await supabase.from('raw_emails').update({
            status: 'pending',
            retry_count: email.retry_count + 1
          }).eq('id', email.id);
        }
      }

      // Small delay between batches to respect rate limits
      await new Promise(r => setTimeout(r, 200));
    }

    // Update progress
    const workspaceIds = [...new Set(emails.map(e => e.workspace_id))];
    for (const wsId of workspaceIds) {
      await updateProgress(supabase, wsId);
    }

    console.log(`[queue-processor] Classified ${classifiedCount}/${emails.length} emails`);

    return new Response(JSON.stringify({ processed: emails.length, classified: classifiedCount }), {
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
    `[${i}] From: ${e.from_email} | Subject: ${e.subject || '(none)'} | Body: ${(e.body_text || '').substring(0, 400)}`
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

async function createConversationAndMessage(supabase: any, email: any, classification: any) {
  // Only create conversations for customer emails
  if (classification.email_type !== 'customer') return;

  const direction = email.folder?.toUpperCase().includes('SENT') ? 'outbound' : 'inbound';
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
    metadata: { classification }
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

  await supabase.from('email_import_progress').upsert({
    workspace_id: workspaceId,
    current_phase: pending === 0 && classified > 0 ? 'analyzing' : 'classifying',
    phase1_status: pending === 0 ? 'complete' : 'running',
    emails_received: total || 0,
    emails_classified: classified || 0,
    updated_at: new Date().toISOString()
  }, { onConflict: 'workspace_id' });

  // If Phase 1 complete, trigger Phase 2
  if (pending === 0 && (classified || 0) > 0) {
    console.log('[queue-processor] Phase 1 complete, triggering Phase 2');
    await supabase.functions.invoke('email-analyze-conversations', {
      body: { workspaceId }
    });
  }
}
