import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const OPENAI_API = 'https://api.openai.com/v1/embeddings'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    const { workspace_id, conversation_id, incoming_message } = await req.json()
    
    if (!workspace_id || !incoming_message) {
      throw new Error('workspace_id and incoming_message are required')
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
    
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured')

    console.log('[generate-response] Starting for workspace:', workspace_id)

    // =========================================
    // STEP 1: Get voice profile
    // =========================================
    
    const { data: voiceProfile } = await supabase
      .from('voice_profiles')
      .select('voice_dna, playbook, examples_stored')
      .eq('workspace_id', workspace_id)
      .single()

    if (!voiceProfile?.voice_dna) {
      console.log('[generate-response] No voice profile found')
      return new Response(JSON.stringify({
        success: false,
        error: 'No voice profile found. Please complete voice learning first.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // =========================================
    // STEP 2: Embed incoming message
    // =========================================
    
    const embeddingResponse = await fetch(OPENAI_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: incoming_message.slice(0, 1000)
      })
    })
    
    if (!embeddingResponse.ok) {
      throw new Error('Failed to generate embedding')
    }
    
    const embeddingData = await embeddingResponse.json()
    const queryEmbedding = embeddingData.data?.[0]?.embedding

    // =========================================
    // STEP 3: Retrieve 3 similar past emails
    // =========================================
    
    let similarExamples: any[] = []
    
    if (queryEmbedding) {
      const { data: examples, error: examplesError } = await supabase.rpc('match_examples', {
        query_embedding: queryEmbedding,
        match_workspace: workspace_id,
        match_count: 3
      })
      
      if (!examplesError && examples) {
        similarExamples = examples
      }
      console.log('[generate-response] Found similar examples:', similarExamples.length)
    }

    // =========================================
    // STEP 4: Search relevant FAQs
    // =========================================
    
    let relevantFaqs: any[] = []
    
    // Try to find FAQs by keyword match (simple approach)
    const keywords = incoming_message.toLowerCase().split(/\s+/).slice(0, 5)
    const { data: faqs } = await supabase
      .from('faqs')
      .select('question, answer')
      .eq('workspace_id', workspace_id)
      .limit(5)
    
    if (faqs) {
      relevantFaqs = faqs
    }

    // =========================================
    // STEP 5: Get business profile
    // =========================================
    
    const { data: businessProfile } = await supabase
      .from('business_profile')
      .select('business_name, services, service_area, phone, pricing_model')
      .eq('workspace_id', workspace_id)
      .single()

    // =========================================
    // STEP 6: Generate response with RAG
    // =========================================
    
    const voiceDna = voiceProfile.voice_dna
    
    const examplesText = similarExamples.length > 0
      ? similarExamples.map((ex, i) => 
          `EXAMPLE ${i + 1}:
Customer wrote: "${ex.inbound_text?.slice(0, 300)}"
You replied: "${ex.outbound_text?.slice(0, 300)}"`
        ).join('\n\n')
      : 'No similar examples found - follow the voice DNA closely.'

    const faqsText = relevantFaqs.length > 0
      ? relevantFaqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')
      : ''

    const businessInfo = businessProfile
      ? `
BUSINESS INFO:
- Name: ${businessProfile.business_name || 'Not specified'}
- Services: ${JSON.stringify(businessProfile.services || [])}
- Area: ${businessProfile.service_area || 'Not specified'}
- Phone: ${businessProfile.phone || 'Not provided'}
- Pricing: ${businessProfile.pricing_model || 'Not specified'}`
      : ''

    const generationPrompt = `You are drafting a reply as the business owner. Your goal is to sound EXACTLY like them.

VOICE DNA:
- Greetings: ${JSON.stringify(voiceDna.openers || [])}
- Sign-offs: ${JSON.stringify(voiceDna.closers || [])}
- Verbal tics: ${JSON.stringify(voiceDna.tics || [])}
- Tone: ${JSON.stringify(voiceDna.tone_keywords || [])}
- Formatting: ${JSON.stringify(voiceDna.formatting_rules || [])}
- Typical length: ${voiceDna.avg_response_length || 80} words
- Emoji usage: ${voiceDna.emoji_usage || 'rarely'}

REFERENCE EXAMPLES (Mimic these EXACTLY):
${examplesText}

${faqsText ? `RELEVANT KNOWLEDGE:\n${faqsText}` : ''}

${businessInfo}

INCOMING MESSAGE:
"${incoming_message}"

INSTRUCTIONS:
1. Match the tone, length, and structure of the examples above
2. Use the same greeting and sign-off style
3. If the examples show short, direct replies - be short and direct
4. If the examples show warmth - include that warmth
5. Include any relevant FAQ information naturally
6. DO NOT sound corporate or formal unless the examples do
7. DO NOT use placeholders like [Name] - use generic greetings if no name is known
8. Keep your response under ${voiceDna.avg_response_length || 100} words

Draft your reply:`

    console.log('[generate-response] Calling Claude for draft...')

    const claudeResponse = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: generationPrompt }]
      })
    })

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text()
      console.error('[generate-response] Claude API error:', errorText)
      throw new Error(`Claude API error: ${claudeResponse.status}`)
    }

    const claudeData = await claudeResponse.json()
    const draftResponse = claudeData.content?.[0]?.text?.trim() || ''

    const duration = Date.now() - startTime
    console.log(`[generate-response] Completed in ${duration}ms`)

    return new Response(JSON.stringify({
      success: true,
      draft: draftResponse,
      examples_used: similarExamples.length,
      faqs_used: relevantFaqs.length,
      duration_ms: duration
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('[generate-response] Error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      duration_ms: Date.now() - startTime
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
