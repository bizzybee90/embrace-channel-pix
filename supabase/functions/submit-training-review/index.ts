import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { validateAuth, AuthError, authErrorResponse } = await import('../_shared/auth.ts');
    let body: {
      conversation_id?: string;
      workspace_id?: string;
      corrected_category?: string;
    };
    try {
      body = await req.clone().json();
    } catch {
      body = {};
    }
    try {
      await validateAuth(req, body.workspace_id);
    } catch (authErr: unknown) {
      if (authErr instanceof AuthError) return authErrorResponse(authErr);
      throw authErr;
    }

    const conversationId = body.conversation_id;
    const workspaceId = body.workspace_id;
    const correctedCategory = body.corrected_category?.trim() || null;

    if (!conversationId) throw new Error('conversation_id is required');
    if (!workspaceId) throw new Error('workspace_id is required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the conversation to get current classification
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, category, email_classification, title, customer:customers(email)')
      .eq('id', conversationId)
      .eq('workspace_id', workspaceId)
      .single();

    if (convError || !conversation) {
      throw new Error(`Conversation not found: ${convError?.message || conversationId}`);
    }

    // Mark as reviewed
    await supabase
      .from('conversations')
      .update({ training_reviewed: true, updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    // If a corrected category was provided and it differs, insert a correction
    const originalCategory = conversation.category || conversation.email_classification || 'unknown';
    if (correctedCategory && correctedCategory !== originalCategory) {
      const customer = Array.isArray(conversation.customer) ? conversation.customer[0] : conversation.customer;

      const { error: correctionError } = await supabase
        .from('classification_corrections')
        .insert({
          workspace_id: workspaceId,
          conversation_id: conversationId,
          original_category: originalCategory,
          corrected_category: correctedCategory,
          sender_email: customer?.email || null,
          subject: conversation.title || null,
        });

      if (correctionError) {
        console.error('[submit-training-review] correction insert failed:', correctionError.message);
      }

      // Also update the conversation's category to the corrected value
      await supabase
        .from('conversations')
        .update({
          category: correctedCategory,
          email_classification: correctedCategory,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);
    }

    return new Response(JSON.stringify({
      success: true,
      reviewed: true,
      correction: correctedCategory && correctedCategory !== originalCategory
        ? { from: originalCategory, to: correctedCategory }
        : null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[submit-training-review] Error:', errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
