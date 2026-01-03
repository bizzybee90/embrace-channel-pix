import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4.28.0";

// Declare EdgeRuntime for background tasks
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
    const workspaceId: string | undefined = body.workspaceId;
    const rebuild: boolean = body.rebuild === true;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

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

    const targetStatus = rebuild ? 'classified' : 'pending';

    // Fetch work
    let query = supabase
      .from('raw_emails')
      .select('*')
      .eq('status', targetStatus)
      .lt('retry_count', 3)
      .order('received_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (workspaceId) query = query.eq('workspace_id', workspaceId);

    const { data: emails } = await query;

    if (!emails || emails.length === 0) {
      console.log(`[queue-processor] No ${targetStatus} emails`);
      if (workspaceId && !rebuild) {
        await checkAndTriggerPhase2(supabase, workspaceId);
      }
      return new Response(JSON.stringify({ processed: 0, mode: rebuild ? 'rebuild' : 'classify' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[queue-processor] ${rebuild ? 'Rebuilding' : 'Processing'} ${emails.length} emails for workspace: ${workspaceId || 'all'}`);

    // Lock rows by moving them to processing
    const emailIds = emails.map((e: any) => e.id);
    await supabase
      .from('raw_emails')
      .update({ status: 'processing', processing_started_at: new Date().toISOString() })
      .in('id', emailIds);

    const openai = rebuild ? null : new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! });

    let processed = 0;

    // Process in batches
    for (let i = 0; i < emails.length; i += CLASSIFICATION_BATCH) {
      const batch = emails.slice(i, i + CLASSIFICATION_BATCH);

      const classifications = rebuild
        ? batch.map((e: any) => e.classification || null)
        : await classifyBatch(openai as OpenAI, batch);

      const toHandle: Array<{ email: any; result: any }> = [];
      const failed: any[] = [];

      for (let j = 0; j < batch.length; j++) {
        const email = batch[j];
        const result = classifications[j];
        if (result?.email_type) toHandle.push({ email, result });
        else failed.push(email);
      }

      await Promise.all(toHandle.map(async ({ email, result }) => {
        if (!rebuild) {
          await supabase.from('raw_emails').update({
            status: 'classified',
            classification: result,
            email_type: result.email_type,
            lane: result.lane,
            confidence: result.confidence,
            processing_completed_at: new Date().toISOString(),
          }).eq('id', email.id);
        }

        await createConversationAndMessage(supabase, email, result, connectedEmail);

        // In rebuild mode, restore back to classified when done
        if (rebuild) {
          await supabase.from('raw_emails').update({
            status: 'classified',
            processing_completed_at: new Date().toISOString(),
          }).eq('id', email.id);
        }

        processed++;
      }));

      if (!rebuild && failed.length > 0) {
        await Promise.all(failed.map((email) =>
          supabase.from('raw_emails').update({
            status: 'pending',
            retry_count: (email.retry_count || 0) + 1,
          }).eq('id', email.id)
        ));
      }

      if (i + CLASSIFICATION_BATCH < emails.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Update progress for affected workspaces
    const workspaceIds = [...new Set(emails.map((e: any) => e.workspace_id))];
    for (const wsId of workspaceIds) {
      await updateProgress(supabase, wsId);
    }

    // Remaining work (scoped)
    let remainingQuery = supabase
      .from('raw_emails')
      .select('*', { count: 'exact', head: true })
      .eq('status', targetStatus)
      .lt('retry_count', 3);

    if (workspaceId) remainingQuery = remainingQuery.eq('workspace_id', workspaceId);

    const { count: remainingCount } = await remainingQuery;

    if (remainingCount && remainingCount > 0) {
      const workersToSpawn = Math.min(PARALLEL_WORKERS, Math.ceil(remainingCount / BATCH_SIZE));
      console.log(`[queue-processor] ${remainingCount} remaining, spawning ${workersToSpawn} workers...`);

      EdgeRuntime.waitUntil((async () => {
        const workers: Promise<any>[] = [];
        for (let i = 0; i < workersToSpawn; i++) {
          workers.push(supabase.functions.invoke('email-queue-processor', {
            body: { workspaceId, rebuild }
          }));
        }
        await Promise.all(workers);
      })());
    } else if (workspaceId) {
      if (!rebuild) {
        await checkAndTriggerPhase2(supabase, workspaceId);
      } else {
        // After rebuild finishes, regenerate pairs + trigger learning
        EdgeRuntime.waitUntil(supabase.functions.invoke('email-analyze-conversations', {
          body: { workspaceId }
        }) as any);
      }
    }

    return new Response(JSON.stringify({
      processed,
      remaining: remainingCount || 0,
      mode: rebuild ? 'rebuild' : 'classify'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[queue-processor] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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
  const fromEmail = (email.from_email || '').toLowerCase();
  const folder = (email.folder || '').toUpperCase();

  let direction: 'inbound' | 'outbound' = 'inbound';
  if (folder === 'SENT' || folder === 'SENT MAIL' || folder === 'SENT ITEMS') direction = 'outbound';
  else if (connectedEmail && fromEmail === connectedEmail) direction = 'outbound';

  // Only skip inbound non-customer emails
  if (direction === 'inbound' && classification.email_type !== 'customer') return;

  const customerEmail = direction === 'inbound' ? email.from_email : email.to_email;
  if (!customerEmail) return;

  // Customer
  let { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('workspace_id', email.workspace_id)
    .eq('email', customerEmail)
    .maybeSingle();

  if (!customer) {
    const { data: newCustomer, error: custErr } = await supabase
      .from('customers')
      .insert({
        workspace_id: email.workspace_id,
        email: customerEmail,
        name: direction === 'inbound' ? email.from_name : email.to_name,
      })
      .select('id')
      .single();
    if (custErr) {
      console.error('[queue-processor] customer insert error:', custErr);
      return;
    }
    customer = newCustomer;
  }

  if (!customer) return;

  // Conversation (thread_id)
  let { data: conversation } = await supabase
    .from('conversations')
    .select('id')
    .eq('workspace_id', email.workspace_id)
    .eq('external_conversation_id', email.thread_id)
    .maybeSingle();

  if (!conversation) {
    const { data: newConv, error: convErr } = await supabase
      .from('conversations')
      .insert({
        workspace_id: email.workspace_id,
        customer_id: customer.id,
        external_conversation_id: email.thread_id,
        title: email.subject,
        channel: 'email',
        lane: classification.lane,
        status: 'open',
        updated_at: email.received_at,
      })
      .select('id')
      .single();

    if (convErr) {
      console.error('[queue-processor] conversation insert error:', convErr);
      return;
    }

    conversation = newConv;
  }

  if (!conversation) return;

  // Dedup message within conversation by raw_payload.external_id
  const externalId = String(email.external_id || '');
  const { data: existingMsg } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .contains('raw_payload', { external_id: externalId })
    .maybeSingle();

  if (!existingMsg) {
    const actorType = direction === 'inbound' ? 'customer' : 'business';
    const actorName = direction === 'inbound'
      ? (email.from_name || email.from_email)
      : (email.to_name || email.to_email);

    const body = String(email.body_text || '').trim() || String(email.subject || '').trim() || '(no content)';

    const { error: msgErr } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      actor_type: actorType,
      actor_name: actorName,
      direction,
      channel: 'email',
      body,
      created_at: email.received_at || new Date().toISOString(),
      raw_payload: {
        external_id: externalId,
        thread_id: email.thread_id,
        subject: email.subject,
        from_email: email.from_email,
        from_name: email.from_name,
        to_email: email.to_email,
        to_name: email.to_name,
        received_at: email.received_at,
        folder: email.folder,
        classification,
      }
    });

    if (msgErr) console.error('[queue-processor] message insert error:', msgErr);
  }

  // Update conversation timestamp
  await supabase
    .from('conversations')
    .update({ updated_at: email.received_at })
    .eq('id', conversation.id);
}

async function updateProgress(supabase: any, workspaceId: string) {
  const { count: total } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  const { count: classified } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'classified');

  const { count: pending } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending');

  const { count: processing } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'processing');

  const isComplete = (pending || 0) === 0 && (processing || 0) === 0 && (classified || 0) > 0;

  await supabase.from('email_import_progress').upsert({
    workspace_id: workspaceId,
    current_phase: isComplete ? 'analyzing' : 'classifying',
    phase1_status: isComplete ? 'complete' : 'running',
    phase1_completed_at: isComplete ? new Date().toISOString() : undefined,
    emails_received: total || 0,
    emails_classified: classified || 0,
    updated_at: new Date().toISOString(),
    last_error: null,
    resume_after: null,
    paused_reason: null,
  }, { onConflict: 'workspace_id' });

  return isComplete;
}

async function checkAndTriggerPhase2(supabase: any, workspaceId: string) {
  const { count: pending } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending');

  const { count: processing } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'processing');

  const { count: classified } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'classified');

  if ((pending || 0) === 0 && (processing || 0) === 0 && (classified || 0) > 0) {
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
      if (error) console.error('[queue-processor] Failed to invoke analyze-conversations:', error);
    })());
  }
}
