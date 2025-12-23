import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RetriagedResult {
  id: string;
  title: string;
  originalBucket: string;
  newBucket: string;
  originalClassification: string;
  newClassification: string;
  originalConfidence: number;
  newConfidence: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { 
      workspaceId, 
      limit = 20, 
      dryRun = false, 
      confidenceThreshold = 0.85,
      targetBucket = 'auto_handled' // Focus on auto-handled by default
    } = await req.json();

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[bulk-retriage] Starting workspace=${workspaceId} limit=${limit} dryRun=${dryRun} threshold=${confidenceThreshold} targetBucket=${targetBucket}`);

    // Find conversations that were auto-handled with low confidence
    // These are the ones most likely to be misclassified
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        title,
        decision_bucket,
        email_classification,
        triage_confidence,
        requires_reply,
        why_this_needs_you,
        summary_for_human,
        customer:customers(email, name),
        messages(body, direction, raw_payload)
      `)
      .eq('workspace_id', workspaceId)
      .eq('decision_bucket', targetBucket)
      .or(`triage_confidence.lt.${confidenceThreshold},triage_confidence.is.null`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (convError) {
      console.error('[bulk-retriage] Error fetching conversations:', convError);
      throw convError;
    }

    console.log(`[bulk-retriage] Found ${conversations?.length || 0} low-confidence ${targetBucket} conversations`);

    if (!conversations || conversations.length === 0) {
      return new Response(JSON.stringify({
        processed: 0,
        changed: 0,
        dryRun,
        message: `No low-confidence ${targetBucket} conversations found`,
        results: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: RetriagedResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const conv of conversations) {
      try {
        const customerEmail = conv.customer?.[0]?.email as string | undefined;
        const customerName = conv.customer?.[0]?.name as string | undefined;
        
        // Get the first inbound message
        const inboundMessage = conv.messages?.find((m: any) => 
          String(m.direction || '').toLowerCase() === 'inbound'
        ) ?? conv.messages?.[0];
        
        if (!inboundMessage) {
          console.log(`[bulk-retriage] Skipping conv=${conv.id} - no messages`);
          continue;
        }

        const messageBody = (inboundMessage.body || '').toString();
        const subject = (conv.title || '').toString();
        
        // Extract to_email from raw_payload if available
        const rawPayload = inboundMessage.raw_payload as any;
        const toEmail = rawPayload?.to_email || rawPayload?.to?.[0]?.email || '';

        if (!messageBody.trim()) {
          console.log(`[bulk-retriage] Skipping conv=${conv.id} - empty body`);
          continue;
        }

        console.log(`[bulk-retriage] Re-triaging conv=${conv.id} subject="${subject.slice(0, 50)}"`);

        // Call the email-triage-agent for full re-classification
        const triageResponse = await supabase.functions.invoke('email-triage-agent', {
          body: {
            email: {
              from_email: customerEmail || 'unknown@unknown.com',
              from_name: customerName || 'Unknown',
              subject: subject,
              body: messageBody,
              to_email: toEmail,
            },
            workspace_id: workspaceId,
          }
        });

        if (triageResponse.error) {
          console.error(`[bulk-retriage] Triage error for conv=${conv.id}:`, triageResponse.error);
          errorCount++;
          continue;
        }

        const triageResult = triageResponse.data;
        const newBucket = triageResult?.decision?.bucket;
        const newClassification = triageResult?.classification?.category;
        const newConfidence = triageResult?.decision?.confidence;
        const newRequiresReply = triageResult?.classification?.requires_reply;
        const newWhyThisNeedsYou = triageResult?.decision?.why_this_needs_you;

        // Check if classification changed
        const bucketChanged = newBucket && newBucket !== conv.decision_bucket;
        const classificationChanged = newClassification && newClassification !== conv.email_classification;

        if (bucketChanged || classificationChanged) {
          results.push({
            id: conv.id,
            title: conv.title || 'Untitled',
            originalBucket: conv.decision_bucket || 'unknown',
            newBucket: newBucket || 'unknown',
            originalClassification: conv.email_classification || 'unknown',
            newClassification: newClassification || 'unknown',
            originalConfidence: conv.triage_confidence || 0,
            newConfidence: newConfidence || 0,
          });

          if (!dryRun) {
            const { error: updateError } = await supabase
              .from('conversations')
              .update({
                decision_bucket: newBucket,
                email_classification: newClassification,
                requires_reply: newRequiresReply,
                triage_confidence: newConfidence,
                why_this_needs_you: newWhyThisNeedsYou,
                triage_reasoning: triageResult?.reasoning || null,
                urgency: triageResult?.priority?.urgency || null,
                urgency_reason: triageResult?.priority?.urgency_reason || null,
                risk_level: triageResult?.risk?.level || null,
                cognitive_load: triageResult?.risk?.cognitive_load || null,
                ai_sentiment: triageResult?.sentiment?.tone || null,
                summary_for_human: triageResult?.summary?.one_line || conv.summary_for_human,
                updated_at: new Date().toISOString(),
              })
              .eq('id', conv.id);

            if (updateError) {
              console.error(`[bulk-retriage] Update failed conv=${conv.id}:`, updateError);
              errorCount++;
            } else {
              successCount++;
              console.log(`[bulk-retriage] Updated conv=${conv.id}: ${conv.decision_bucket} → ${newBucket}, ${conv.email_classification} → ${newClassification}`);
            }
          } else {
            successCount++;
          }
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (e) {
        console.error(`[bulk-retriage] Error processing conv=${conv.id}:`, e);
        errorCount++;
      }
    }

    const summary = {
      processed: conversations.length,
      changed: results.length,
      success: successCount,
      errors: errorCount,
      dryRun,
      confidenceThreshold,
      targetBucket,
      results,
    };

    console.log(`[bulk-retriage] Complete: processed=${summary.processed} changed=${summary.changed} success=${successCount} errors=${errorCount}`);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[bulk-retriage] Error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
