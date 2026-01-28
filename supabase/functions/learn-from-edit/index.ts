import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENAI_API = 'https://api.openai.com/v1/embeddings'

// Simple word overlap similarity
function calculateSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length
  const union = new Set([...wordsA, ...wordsB]).size
  return intersection / union
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { workspace_id, original_draft, final_sent, inbound_message, conversation_id } = await req.json()
    
    if (!workspace_id || !final_sent || !inbound_message) {
      return new Response(JSON.stringify({
        success: false,
        error: 'workspace_id, final_sent, and inbound_message are required'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured')

    console.log('[learn-from-edit] Processing edit for workspace:', workspace_id)

    // Calculate similarity between original draft and final sent
    const similarity = calculateSimilarity(original_draft || '', final_sent)
    
    console.log('[learn-from-edit] Similarity:', similarity)
    
    // Only learn if user made significant changes (less than 80% similar)
    if (similarity >= 0.8) {
      console.log('[learn-from-edit] Minor edit, skipping learning')
      return new Response(JSON.stringify({
        success: true,
        learned: false,
        reason: 'Edit was minor (>80% similar), no learning needed'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // User changed it significantly - this is a learning opportunity
    console.log('[learn-from-edit] Significant edit detected, storing as example')
    
    // Generate embedding for the inbound message
    const embeddingResponse = await fetch(OPENAI_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: inbound_message.slice(0, 1000)
      })
    })
    
    if (!embeddingResponse.ok) {
      throw new Error('Failed to generate embedding')
    }
    
    const embeddingData = await embeddingResponse.json()
    const embedding = embeddingData.data?.[0]?.embedding
    
    if (!embedding) {
      throw new Error('No embedding returned')
    }

    // Determine category based on content
    let category = 'learned_from_edit'
    const text = inbound_message.toLowerCase()
    if (text.includes('price') || text.includes('cost') || text.includes('how much') || text.includes('quote')) {
      category = 'quote_request_corrected'
    } else if (text.includes('book') || text.includes('appointment') || text.includes('available')) {
      category = 'booking_request_corrected'
    } else if (text.includes('complaint') || text.includes('unhappy') || text.includes('wrong')) {
      category = 'complaint_corrected'
    }

    // Store the corrected example
    const { error: insertError } = await supabase.from('example_responses').insert({
      workspace_id: workspace_id,
      category,
      inbound_text: inbound_message,
      outbound_text: final_sent,  // Store what user ACTUALLY sent
      inbound_embedding: embedding
    })

    if (insertError) {
      console.error('[learn-from-edit] Insert error:', insertError)
      throw new Error('Failed to store example')
    }

    // Update examples count - using try/catch instead of .catch()
    try {
      const { data: currentProfile } = await supabase
        .from('voice_profiles')
        .select('examples_stored')
        .eq('workspace_id', workspace_id)
        .single()
      
      if (currentProfile) {
        await supabase
          .from('voice_profiles')
          .update({ examples_stored: (currentProfile.examples_stored || 0) + 1 })
          .eq('workspace_id', workspace_id)
      }
    } catch {
      console.log('[learn-from-edit] Could not update examples count')
    }

    // Also store in correction_examples for analysis
    try {
      await supabase.from('correction_examples').insert({
        workspace_id,
        conversation_id,
        original_draft: original_draft || '',
        edited_draft: final_sent,
        learnings: {
          similarity,
          category,
          learned_at: new Date().toISOString()
        }
      })
    } catch {
      console.log('[learn-from-edit] Could not store in correction_examples')
    }

    console.log('[learn-from-edit] Successfully stored corrected example')

    return new Response(JSON.stringify({
      success: true,
      learned: true,
      similarity,
      category,
      message: 'Learned from your edit! Future responses will be more accurate.'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('[learn-from-edit] Error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
