import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { 
      workspace_id, 
      email_id, 
      original_category, 
      corrected_category,
      corrected_requires_reply,
      source_table = 'raw_emails' // 'raw_emails' or 'email_import_queue'
    } = await req.json()
    
    if (!workspace_id || !email_id || !corrected_category) {
      return new Response(JSON.stringify({
        success: false,
        error: 'workspace_id, email_id, and corrected_category are required'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    console.log('[save-classification-correction] Processing:', {
      workspace_id, email_id, original_category, corrected_category, source_table
    })

    // Get the email text for the correction record
    let emailData: any = null;
    let fromEmail: string | null = null;

    if (source_table === 'email_import_queue') {
      const { data, error } = await supabase
        .from('email_import_queue')
        .select('subject, body, category, from_email')
        .eq('id', email_id)
        .single()
      if (error) throw new Error(`Failed to fetch email: ${error.message}`)
      emailData = data
      fromEmail = data?.from_email
    } else {
      const { data, error } = await supabase
        .from('raw_emails')
        .select('subject, body_text, category, from_email')
        .eq('id', email_id)
        .single()
      if (error) throw new Error(`Failed to fetch email: ${error.message}`)
      emailData = data
      fromEmail = data?.from_email
    }

    const actualOriginalCategory = original_category || emailData?.category
    const originalText = `${emailData?.subject || ''} ${(emailData?.body || emailData?.body_text || '').substring(0, 200)}`

    // Save the correction for learning
    const { error: insertError } = await supabase.from('classification_corrections').insert({
      workspace_id,
      email_id,
      original_text: originalText,
      original_category: actualOriginalCategory,
      corrected_category,
      corrected_requires_reply: corrected_requires_reply ?? true
    })

    if (insertError) {
      console.error('[save-classification-correction] Insert error:', insertError)
    }

    // Update the email with the corrected classification
    const updateData: any = {
      category: corrected_category,
      requires_reply: corrected_requires_reply ?? true,
      classified_at: new Date().toISOString(),
    }

    if (source_table === 'email_import_queue') {
      updateData.confidence = 1.0
      updateData.needs_review = false
      updateData.status = 'processed'
      updateData.processed_at = new Date().toISOString()
    } else {
      updateData.classified_by = 'user_correction'
      updateData.status = 'classified'
    }

    const { error: updateError } = await supabase
      .from(source_table)
      .update(updateData)
      .eq('id', email_id)

    if (updateError) {
      throw new Error(`Failed to update email: ${updateError.message}`)
    }

    // =========================================================================
    // AUTO-LEARNING: Check if we should create a sender rule
    // =========================================================================
    let ruleCreated = false
    let siblingsUpdated = 0
    const senderDomain = fromEmail?.split('@')[1]

    if (senderDomain) {
      // Count corrections for this domain with the same corrected category
      const { count: domainCorrectionCount } = await supabase
        .from('classification_corrections')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace_id)
        .ilike('original_text', `%@${senderDomain}%`)

      // Also count by checking from_email in email_import_queue corrections
      const { count: directCount } = await supabase
        .from('classification_corrections')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace_id)
        .eq('corrected_category', corrected_category)

      // Check if a rule already exists for this domain
      const { data: existingRule } = await supabase
        .from('sender_rules')
        .select('id')
        .eq('workspace_id', workspace_id)
        .eq('sender_pattern', `@${senderDomain}`)
        .maybeSingle()

      // Create rule if 2+ corrections from same domain and no existing rule
      if (!existingRule && (domainCorrectionCount || 0) >= 2) {
        const { error: ruleError } = await supabase.from('sender_rules').insert({
          workspace_id,
          sender_pattern: `@${senderDomain}`,
          default_classification: corrected_category,
          default_requires_reply: corrected_requires_reply ?? true,
          skip_llm: true,
          is_active: true,
          created_from_correction: email_id,
        })

        if (!ruleError) {
          ruleCreated = true
          console.log(`[save-classification-correction] Auto-created sender rule for @${senderDomain} -> ${corrected_category}`)
        } else {
          console.error('[save-classification-correction] Failed to create rule:', ruleError)
        }
      }

      // =========================================================================
      // RE-CLASSIFY SIBLINGS: Fix other emails from same sender with wrong category
      // =========================================================================
      if (source_table === 'email_import_queue' && actualOriginalCategory) {
        const { data: siblings, error: siblingError } = await supabase
          .from('email_import_queue')
          .select('id')
          .eq('workspace_id', workspace_id)
          .ilike('from_email', `%@${senderDomain}`)
          .eq('category', actualOriginalCategory)
          .neq('id', email_id)
          .limit(100)

        if (!siblingError && siblings && siblings.length > 0) {
          const siblingIds = siblings.map(s => s.id)
          const { error: bulkError, count } = await supabase
            .from('email_import_queue')
            .update({
              category: corrected_category,
              requires_reply: corrected_requires_reply ?? true,
              confidence: 0.95,
              needs_review: false,
              classified_at: new Date().toISOString(),
              status: 'processed',
              processed_at: new Date().toISOString(),
            })
            .in('id', siblingIds)

          if (!bulkError) {
            siblingsUpdated = count || siblingIds.length
            console.log(`[save-classification-correction] Re-classified ${siblingsUpdated} sibling emails from @${senderDomain}`)
          }
        }
      }
    }

    console.log('[save-classification-correction] Correction saved successfully', {
      ruleCreated, siblingsUpdated
    })

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Correction saved and email updated',
      rule_created: ruleCreated,
      siblings_updated: siblingsUpdated,
      sender_domain: senderDomain,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('[save-classification-correction] Error:', error.message)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
