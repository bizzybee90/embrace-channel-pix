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
    const { workspaceId, daysBack = 90, limit = 500 } = await req.json();
    if (!workspaceId) throw new Error('workspaceId is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log(`[hydrate-inbox] Starting for workspace ${workspaceId}, daysBack=${daysBack}, limit=${limit}`);

    // Check if conversations already exist (avoid duplicate hydration)
    const { count: existingConvos } = await supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);

    if ((existingConvos || 0) > 10) {
      console.log(`[hydrate-inbox] Already have ${existingConvos} conversations, skipping full hydration`);
      return new Response(JSON.stringify({ 
        success: true, 
        skipped: true, 
        existing: existingConvos 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // Get all inbound emails that need replies, grouped by thread
    const { data: emails, error: emailError } = await supabase
      .from('email_import_queue')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_noise', false)
      .not('category', 'is', null)
      .not('category', 'eq', 'spam')
      .not('category', 'eq', 'notification')
      .gte('received_at', cutoffDate.toISOString())
      .order('received_at', { ascending: false })
      .limit(limit);

    if (emailError) throw emailError;
    if (!emails || emails.length === 0) {
      console.log('[hydrate-inbox] No emails to hydrate');
      return new Response(JSON.stringify({ success: true, created: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[hydrate-inbox] Found ${emails.length} emails to hydrate`);

    // Group emails by thread_id
    const threadMap = new Map<string, typeof emails>();
    const standaloneEmails: typeof emails = [];

    for (const email of emails) {
      if (email.thread_id) {
        const existing = threadMap.get(email.thread_id) || [];
        existing.push(email);
        threadMap.set(email.thread_id, existing);
      } else {
        standaloneEmails.push(email);
      }
    }

    let conversationsCreated = 0;
    let messagesCreated = 0;
    let customersCreated = 0;

    // Helper: find or create customer by email
    const customerCache = new Map<string, string>();
    
    async function getOrCreateCustomer(email: string, name: string | null): Promise<string> {
      const normalizedEmail = email.toLowerCase().trim();
      if (customerCache.has(normalizedEmail)) {
        return customerCache.get(normalizedEmail)!;
      }

      // Check existing
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('email', normalizedEmail)
        .limit(1)
        .single();

      if (existing) {
        customerCache.set(normalizedEmail, existing.id);
        return existing.id;
      }

      // Create new
      const { data: newCustomer, error: custError } = await supabase
        .from('customers')
        .insert({
          workspace_id: workspaceId,
          email: normalizedEmail,
          name: name || normalizedEmail.split('@')[0],
          tier: 'regular',
          preferred_channel: 'email',
        })
        .select('id')
        .single();

      if (custError) {
        console.error('[hydrate-inbox] Customer creation error:', custError);
        throw custError;
      }

      customerCache.set(normalizedEmail, newCustomer.id);
      customersCreated++;
      return newCustomer.id;
    }

    // Helper: determine decision bucket from classification
    function getDecisionBucket(email: any): string {
      if (!email.requires_reply) return 'auto_handled';
      if (email.category === 'complaint') return 'act_now';
      if (email.category === 'quote' || email.category === 'booking') return 'quick_win';
      return 'wait';
    }

    function getPriority(email: any): string {
      if (email.category === 'complaint') return 'high';
      if (email.category === 'quote' || email.category === 'booking') return 'medium';
      return 'low';
    }

    function getStatus(email: any): string {
      if (!email.requires_reply) return 'resolved';
      return 'new';
    }

    // Process thread groups
    for (const [threadId, threadEmails] of threadMap.entries()) {
      try {
        // Sort by date ascending within thread
        threadEmails.sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());
        
        // Find the primary inbound email (most recent inbound)
        const inboundEmails = threadEmails.filter(e => e.direction === 'inbound');
        const latestInbound = inboundEmails[inboundEmails.length - 1] || threadEmails[0];
        const primaryEmail = latestInbound;
        
        // Skip if no from_email or it's the user's own email
        if (!primaryEmail.from_email) continue;

        const customerId = await getOrCreateCustomer(
          primaryEmail.from_email,
          primaryEmail.from_name
        );

        const needsReply = threadEmails.some(e => e.requires_reply);
        const latestClassified = threadEmails.find(e => e.category) || primaryEmail;

        // Create conversation
        const { data: convo, error: convoError } = await supabase
          .from('conversations')
          .insert({
            workspace_id: workspaceId,
            customer_id: customerId,
            external_conversation_id: threadId,
            title: primaryEmail.subject || 'No subject',
            channel: 'email',
            category: latestClassified.category || 'other',
            priority: getPriority(latestClassified),
            status: getStatus(latestClassified),
            requires_reply: needsReply,
            email_classification: latestClassified.category,
            decision_bucket: getDecisionBucket(latestClassified),
            cognitive_load: latestClassified.category === 'complaint' ? 'high' : 'low',
            risk_level: latestClassified.category === 'complaint' ? 'retention' : 'none',
            message_count: threadEmails.length,
            confidence: latestClassified.confidence,
            triage_confidence: latestClassified.confidence,
            extracted_entities: latestClassified.entities || {},
            created_at: threadEmails[0].received_at,
            updated_at: threadEmails[threadEmails.length - 1].received_at,
          })
          .select('id')
          .single();

        if (convoError) {
          console.error('[hydrate-inbox] Conversation error:', convoError);
          continue;
        }

        conversationsCreated++;

        // Create messages for each email in thread
        const messagesToInsert = threadEmails.map(email => ({
          conversation_id: convo.id,
          actor_type: email.direction === 'inbound' ? 'customer' : 'human_agent',
          actor_name: email.from_name || email.from_email,
          direction: email.direction,
          channel: 'email',
          body: email.body || email.subject || '(empty)',
          is_internal: false,
          external_id: email.external_id,
          created_at: email.received_at,
          raw_payload: {
            from_email: email.from_email,
            to_emails: email.to_emails,
            subject: email.subject,
            has_html: !!email.body_html,
          },
        }));

        const { error: msgError } = await supabase
          .from('messages')
          .insert(messagesToInsert);

        if (msgError) {
          console.error('[hydrate-inbox] Messages error:', msgError);
        } else {
          messagesCreated += messagesToInsert.length;
        }
      } catch (err) {
        console.error(`[hydrate-inbox] Thread ${threadId} error:`, err);
      }
    }

    // Process standalone emails (no thread_id)
    for (const email of standaloneEmails) {
      try {
        if (!email.from_email) continue;

        const customerId = await getOrCreateCustomer(
          email.from_email,
          email.from_name
        );

        const { data: convo, error: convoError } = await supabase
          .from('conversations')
          .insert({
            workspace_id: workspaceId,
            customer_id: customerId,
            title: email.subject || 'No subject',
            channel: 'email',
            category: email.category || 'other',
            priority: getPriority(email),
            status: getStatus(email),
            requires_reply: email.requires_reply || false,
            email_classification: email.category,
            decision_bucket: getDecisionBucket(email),
            cognitive_load: email.category === 'complaint' ? 'high' : 'low',
            risk_level: email.category === 'complaint' ? 'retention' : 'none',
            message_count: 1,
            confidence: email.confidence,
            triage_confidence: email.confidence,
            extracted_entities: email.entities || {},
            created_at: email.received_at,
            updated_at: email.received_at,
          })
          .select('id')
          .single();

        if (convoError) {
          console.error('[hydrate-inbox] Standalone convo error:', convoError);
          continue;
        }

        conversationsCreated++;

        const { error: msgError } = await supabase
          .from('messages')
          .insert({
            conversation_id: convo.id,
            actor_type: email.direction === 'inbound' ? 'customer' : 'human_agent',
            actor_name: email.from_name || email.from_email,
            direction: email.direction || 'inbound',
            channel: 'email',
            body: email.body || email.subject || '(empty)',
            is_internal: false,
            external_id: email.external_id,
            created_at: email.received_at,
            raw_payload: {
              from_email: email.from_email,
              to_emails: email.to_emails,
              subject: email.subject,
            },
          });

        if (!msgError) messagesCreated++;
      } catch (err) {
        console.error('[hydrate-inbox] Standalone error:', err);
      }
    }

    console.log(`[hydrate-inbox] Done: ${conversationsCreated} conversations, ${messagesCreated} messages, ${customersCreated} customers`);

    return new Response(JSON.stringify({
      success: true,
      conversations_created: conversationsCreated,
      messages_created: messagesCreated,
      customers_created: customersCreated,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[hydrate-inbox] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
