import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RetriageRequest {
  conversationId: string;
  workspaceId?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { conversationId, workspaceId }: RetriageRequest = await req.json();

    if (!conversationId) {
      return new Response(JSON.stringify({ error: 'conversationId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[retriage-conversation] Starting retriage for conversation: ${conversationId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        workspace_id,
        title,
        email_classification,
        decision_bucket,
        triage_confidence,
        requires_reply,
        customer:customers(email, name)
      `)
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      console.error('[retriage-conversation] Conversation not found:', convError);
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const effectiveWorkspaceId = workspaceId || conversation.workspace_id;

    // Fetch the earliest inbound message for this conversation
    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select('body, actor_name, raw_payload, created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: true })
      .limit(1);

    if (msgError || !messages?.length) {
      console.error('[retriage-conversation] No inbound messages found:', msgError);
      return new Response(JSON.stringify({ error: 'No inbound messages to triage' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const message = messages[0];
    const rawPayload = message.raw_payload as Record<string, any> | null;

    // Helper to safely extract email string from various formats
    const extractEmailString = (emailValue: unknown): string => {
      if (typeof emailValue === 'string') {
        return emailValue;
      }
      if (emailValue && typeof emailValue === 'object') {
        const obj = emailValue as Record<string, unknown>;
        return String(obj.email || obj.address || obj.value || 'unknown@unknown.com');
      }
      return 'unknown@unknown.com';
    };

    // Extract email details - handle both string and object formats
    const fromEmail = extractEmailString(
      rawPayload?.from_email 
        || rawPayload?.from 
        || (conversation.customer as any)?.email
    );
    const fromName = message.actor_name 
      || rawPayload?.from_name 
      || (conversation.customer as any)?.name 
      || 'Unknown';
    const subject = conversation.title || rawPayload?.subject || 'No Subject';
    const body = message.body || '';
    const toEmail = extractEmailString(rawPayload?.to_email || rawPayload?.to);

    console.log(`[retriage-conversation] Triaging email from ${fromName} <${fromEmail}>, subject: ${subject}`);

    // Store original values for comparison
    const original = {
      classification: conversation.email_classification,
      bucket: conversation.decision_bucket,
      confidence: conversation.triage_confidence,
      requires_reply: conversation.requires_reply,
    };

    // Call the email-triage-agent
    const triagePayload = {
      email: {
        from_email: fromEmail,
        from_name: fromName,
        subject: subject,
        body: body,
        to_email: toEmail,
      },
      workspace_id: effectiveWorkspaceId,
    };

    console.log('[retriage-conversation] Calling email-triage-agent...');

    const { data: triageResult, error: triageError } = await supabase.functions.invoke(
      'email-triage-agent',
      { body: triagePayload }
    );

    if (triageError) {
      console.error('[retriage-conversation] Triage agent error:', triageError);
      return new Response(JSON.stringify({ error: 'Triage agent failed', details: triageError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[retriage-conversation] Triage result:', {
      bucket: triageResult?.decision?.bucket,
      classification: triageResult?.classification?.category,
      confidence: triageResult?.decision?.confidence,
    });

    // Validate and extract results with strict type checking
    const newBucket = validateBucket(triageResult?.decision?.bucket);
    const newClassification = validateClassification(triageResult?.classification?.category);
    const newConfidence = typeof triageResult?.decision?.confidence === 'number' 
      ? triageResult.decision.confidence 
      : 0.5;
    const newRequiresReply = typeof triageResult?.classification?.requires_reply === 'boolean'
      ? triageResult.classification.requires_reply
      : true;
    const whyThisNeedsYou = typeof triageResult?.decision?.why_this_needs_you === 'string'
      ? triageResult.decision.why_this_needs_you
      : 'Re-triaged - needs review';
    const summary = typeof triageResult?.summary?.one_line === 'string'
      ? triageResult.summary.one_line
      : subject;
    const riskLevel = validateRiskLevel(triageResult?.risk?.level);
    const cognitiveLoad = triageResult?.risk?.cognitive_load === 'high' ? 'high' : 'low';
    const urgency = validateUrgency(triageResult?.priority?.urgency);

    // Update the conversation
    const { error: updateError } = await supabase
      .from('conversations')
      .update({
        decision_bucket: newBucket,
        email_classification: newClassification,
        triage_confidence: newConfidence,
        requires_reply: newRequiresReply,
        why_this_needs_you: whyThisNeedsYou,
        summary_for_human: summary,
        risk_level: riskLevel,
        cognitive_load: cognitiveLoad,
        urgency: urgency,
        needs_review: triageResult?.needs_review ?? false,
        status: newRequiresReply ? 'open' : 'resolved',
        resolved_at: newRequiresReply ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    if (updateError) {
      console.error('[retriage-conversation] Update error:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to update conversation', details: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const changed = 
      original.classification !== newClassification ||
      original.bucket !== newBucket;

    const result = {
      success: true,
      conversationId,
      title: conversation.title,
      changed,
      original: {
        classification: original.classification,
        bucket: original.bucket,
        confidence: original.confidence,
      },
      updated: {
        classification: newClassification,
        bucket: newBucket,
        confidence: newConfidence,
        requires_reply: newRequiresReply,
        why_this_needs_you: whyThisNeedsYou,
      },
      processingTimeMs: Date.now() - startTime,
    };

    console.log('[retriage-conversation] Complete:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[retriage-conversation] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Validation helpers with strict fallbacks
function validateBucket(bucket: unknown): string {
  const validBuckets = ['act_now', 'quick_win', 'auto_handled', 'wait'];
  if (typeof bucket === 'string' && validBuckets.includes(bucket)) {
    return bucket;
  }
  console.warn(`[retriage-conversation] Invalid bucket "${bucket}", defaulting to quick_win`);
  return 'quick_win';
}

function validateClassification(category: unknown): string {
  const validCategories = [
    'customer_inquiry', 'customer_complaint', 'customer_feedback',
    'lead_new', 'lead_followup', 'supplier_invoice', 'supplier_urgent', 'partner_request',
    'automated_notification', 'receipt_confirmation', 'payment_confirmation', 'payment_promise', 'marketing_newsletter',
    'spam_phishing', 'recruitment_hr', 'internal_system', 'informational_only',
    'booking_request', 'quote_request', 'cancellation_request', 'reschedule_request',
    'misdirected'
  ];
  if (typeof category === 'string' && validCategories.includes(category)) {
    return category;
  }
  console.warn(`[retriage-conversation] Invalid classification "${category}", defaulting to customer_inquiry`);
  return 'customer_inquiry';
}

function validateRiskLevel(level: unknown): string {
  const validLevels = ['financial', 'retention', 'reputation', 'legal', 'none'];
  if (typeof level === 'string' && validLevels.includes(level)) {
    return level;
  }
  return 'none';
}

function validateUrgency(urgency: unknown): string {
  const validUrgencies = ['high', 'medium', 'low'];
  if (typeof urgency === 'string' && validUrgencies.includes(urgency)) {
    return urgency;
  }
  return 'medium';
}
