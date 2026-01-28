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
      corrected_requires_reply 
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
      workspace_id,
      email_id,
      original_category,
      corrected_category
    })

    // Get the email text for the correction record
    const { data: email, error: emailError } = await supabase
      .from('raw_emails')
      .select('subject, body_text, category')
      .eq('id', email_id)
      .single()

    if (emailError) {
      throw new Error(`Failed to fetch email: ${emailError.message}`)
    }

    // Use existing category if original_category not provided
    const actualOriginalCategory = original_category || email?.category

    // Save the correction for learning
    const { error: insertError } = await supabase.from('classification_corrections').insert({
      workspace_id,
      email_id,
      original_text: `${email?.subject || ''} ${email?.body_text?.substring(0, 200) || ''}`,
      original_category: actualOriginalCategory,
      corrected_category,
      corrected_requires_reply: corrected_requires_reply ?? true
    })

    if (insertError) {
      console.error('[save-classification-correction] Insert error:', insertError)
      // Continue anyway - we still want to update the email
    }

    // Update the email with the corrected classification
    const { error: updateError } = await supabase
      .from('raw_emails')
      .update({
        category: corrected_category,
        requires_reply: corrected_requires_reply ?? true,
        classified_by: 'user_correction',
        classified_at: new Date().toISOString(),
        status: 'classified'
      })
      .eq('id', email_id)

    if (updateError) {
      throw new Error(`Failed to update email: ${updateError.message}`)
    }

    console.log('[save-classification-correction] Correction saved successfully')

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Correction saved and email updated'
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
