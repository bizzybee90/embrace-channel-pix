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
    const { workspaceId, daysBack = 90, limit = 500, force = false } = await req.json();
    if (!workspaceId) throw new Error('workspaceId is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log(`[hydrate-inbox] Starting for workspace ${workspaceId}, daysBack=${daysBack}, limit=${limit}, force=${force}`);

    // Get the user's own email domain to determine direction
    const { data: emailConfig } = await supabase
      .from('email_provider_configs')
      .select('email_address')
      .eq('workspace_id', workspaceId)
      .limit(1)
      .single();

    const ownerEmail = emailConfig?.email_address?.toLowerCase() || '';
    const ownerDomain = ownerEmail.split('@')[1] || '';
    console.log(`[hydrate-inbox] Owner email: ${ownerEmail}, domain: ${ownerDomain}`);

    if (!ownerDomain) {
      throw new Error('No email provider configured - cannot determine owner domain');
    }

    // Check if conversations already exist (avoid duplicate hydration)
    if (!force) {
      const { count: existingConvos } = await supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId);

      if ((existingConvos || 0) > 10) {
        console.log(`[hydrate-inbox] Already have ${existingConvos} conversations, skipping (use force=true to override)`);
        return new Response(JSON.stringify({ 
          success: true, skipped: true, existing: existingConvos 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // Get all non-noise, non-spam emails
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
      return new Response(JSON.stringify({ success: true, created: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[hydrate-inbox] Found ${emails.length} emails to process`);

    // Determine true direction based on from_email domain
    function isOwnEmail(fromEmail: string): boolean {
      if (!fromEmail) return false;
      const normalized = fromEmail.toLowerCase().trim();
      return normalized === ownerEmail || normalized.endsWith(`@${ownerDomain}`);
    }

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

    // Customer cache
    const customerCache = new Map<string, string>();
    
    async function getOrCreateCustomer(email: string, name: string | null): Promise<string> {
      const normalizedEmail = email.toLowerCase().trim();
      if (customerCache.has(normalizedEmail)) return customerCache.get(normalizedEmail)!;

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

      if (custError) throw custError;
      customerCache.set(normalizedEmail, newCustomer.id);
      customersCreated++;
      return newCustomer.id;
    }

    function getDecisionBucket(category: string, needsReply: boolean): string {
      if (!needsReply) return 'auto_handled';
      if (category === 'complaint') return 'act_now';
      if (category === 'quote' || category === 'booking') return 'quick_win';
      return 'wait';
    }

    function getPriority(category: string): string {
      if (category === 'complaint') return 'high';
      if (category === 'quote' || category === 'booking') return 'medium';
      return 'low';
    }

    // Process threads
    for (const [threadId, threadEmails] of threadMap.entries()) {
      try {
        threadEmails.sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());
        
        // Determine the customer (first non-owner sender)
        const customerEmail = threadEmails.find(e => !isOwnEmail(e.from_email))?.from_email;
        const customerName = threadEmails.find(e => !isOwnEmail(e.from_email))?.from_name;
        
        if (!customerEmail) continue; // Skip threads with only own emails

        const customerId = await getOrCreateCustomer(customerEmail, customerName);
        
        // Check if the latest message is from a customer (meaning WE need to reply)
        const latestEmail = threadEmails[threadEmails.length - 1];
        const latestIsInbound = !isOwnEmail(latestEmail.from_email);
        
        // Thread needs reply if latest message is from customer AND classified as requiring reply
        const needsReply = latestIsInbound && (latestEmail.requires_reply !== false);
        const latestCategory = threadEmails.find(e => e.category)?.category || 'other';

        // Determine conversation status
        const status = needsReply ? 'new' : 'resolved';

        const { data: convo, error: convoError } = await supabase
          .from('conversations')
          .insert({
            workspace_id: workspaceId,
            customer_id: customerId,
            external_conversation_id: threadId,
            title: latestEmail.subject || 'No subject',
            channel: 'email',
            category: latestCategory,
            priority: getPriority(latestCategory),
            status,
            requires_reply: needsReply,
            email_classification: latestCategory,
            decision_bucket: getDecisionBucket(latestCategory, needsReply),
            cognitive_load: latestCategory === 'complaint' ? 'high' : 'low',
            risk_level: latestCategory === 'complaint' ? 'retention' : 'none',
            message_count: threadEmails.length,
            confidence: latestEmail.confidence,
            triage_confidence: latestEmail.confidence,
            extracted_entities: latestEmail.entities || {},
            created_at: threadEmails[0].received_at,
            updated_at: latestEmail.received_at,
          })
          .select('id')
          .single();

        if (convoError) { console.error('Convo error:', convoError); continue; }
        conversationsCreated++;

        // Create messages
        const msgs = threadEmails.map(email => {
          const isSent = isOwnEmail(email.from_email);
          return {
            conversation_id: convo.id,
            actor_type: isSent ? 'human_agent' : 'customer',
            actor_name: email.from_name || email.from_email,
            direction: isSent ? 'outbound' : 'inbound',
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
          };
        });

        const { error: msgError } = await supabase.from('messages').insert(msgs);
        if (!msgError) messagesCreated += msgs.length;
      } catch (err) {
        console.error(`Thread ${threadId} error:`, err);
      }
    }

    // Process standalone emails
    for (const email of standaloneEmails) {
      try {
        const isSent = isOwnEmail(email.from_email);
        
        // For sent emails, try to find recipient as customer
        const customerEmailAddr = isSent 
          ? (email.to_emails?.[0] || null)
          : email.from_email;
        
        if (!customerEmailAddr) continue;

        const customerId = await getOrCreateCustomer(
          customerEmailAddr,
          isSent ? null : email.from_name
        );

        const needsReply = !isSent && (email.requires_reply !== false);
        const category = email.category || 'other';

        const { data: convo, error: convoError } = await supabase
          .from('conversations')
          .insert({
            workspace_id: workspaceId,
            customer_id: customerId,
            title: email.subject || 'No subject',
            channel: 'email',
            category,
            priority: getPriority(category),
            status: needsReply ? 'new' : 'resolved',
            requires_reply: needsReply,
            email_classification: category,
            decision_bucket: getDecisionBucket(category, needsReply),
            cognitive_load: category === 'complaint' ? 'high' : 'low',
            risk_level: category === 'complaint' ? 'retention' : 'none',
            message_count: 1,
            confidence: email.confidence,
            triage_confidence: email.confidence,
            extracted_entities: email.entities || {},
            created_at: email.received_at,
            updated_at: email.received_at,
          })
          .select('id')
          .single();

        if (convoError) { console.error('Standalone error:', convoError); continue; }
        conversationsCreated++;

        const { error: msgError } = await supabase.from('messages').insert({
          conversation_id: convo.id,
          actor_type: isSent ? 'human_agent' : 'customer',
          actor_name: email.from_name || email.from_email,
          direction: isSent ? 'outbound' : 'inbound',
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
        console.error('Standalone error:', err);
      }
    }

    console.log(`[hydrate-inbox] Done: ${conversationsCreated} convos, ${messagesCreated} msgs, ${customersCreated} customers`);

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
