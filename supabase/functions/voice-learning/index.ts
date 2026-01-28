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
    const { workspace_id, force_refresh } = await req.json()
    
    if (!workspace_id) {
      throw new Error('workspace_id is required')
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
    
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured')

    console.log('[voice-learning] Starting for workspace:', workspace_id)

    // Check if we already have a recent profile (unless force refresh)
    if (!force_refresh) {
      const { data: existingProfile } = await supabase
        .from('voice_profiles')
        .select('updated_at, examples_stored')
        .eq('workspace_id', workspace_id)
        .single()
      
      if (existingProfile?.updated_at) {
        const hoursSinceUpdate = (Date.now() - new Date(existingProfile.updated_at).getTime()) / (1000 * 60 * 60)
        if (hoursSinceUpdate < 24 && existingProfile.examples_stored > 0) {
          return new Response(JSON.stringify({
            success: true,
            skipped: true,
            reason: 'Profile updated within last 24 hours. Use force_refresh to override.'
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
      }
    }

    // =========================================
    // STEP 1: Fetch conversation pairs
    // =========================================
    
    const { data: pairs, error: pairsError } = await supabase
      .from('training_pairs')
      .select('*')
      .eq('workspace_id', workspace_id)
      .limit(100)
    
    console.log('[voice-learning] Found pairs:', pairs?.length || 0)
    
    if (pairsError) {
      console.error('[voice-learning] Error fetching pairs:', pairsError)
    }
    
    if (!pairs || pairs.length < 5) {
      // Not enough data - return cold start indicator
      return new Response(JSON.stringify({
        success: false,
        reason: 'insufficient_data',
        pairs_found: pairs?.length || 0,
        message: 'Need at least 5 conversation pairs for voice learning. Connect your email to import your sent messages.'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // =========================================
    // STEP 2: Format pairs for Claude
    // =========================================
    
    const formattedPairs = pairs.map((p, i) => 
      `--- EXCHANGE ${i + 1} ---
CUSTOMER: ${p.customer_text?.slice(0, 500) || '[empty]'}
OWNER REPLIED: ${p.owner_text?.slice(0, 500) || '[empty]'}
RESPONSE TIME: ${p.response_hours?.toFixed(1) || 'unknown'} hours`
    ).join('\n\n')

    // =========================================
    // STEP 3: Extract voice profile (ONE Claude call)
    // =========================================
    
    const extractionPrompt = `You are a Forensic Linguist analyzing a business owner's email archive. Your goal is to extract a "Digital Clone" profile.

Here are ${pairs.length} recent email exchanges:

<data>
${formattedPairs}
</data>

Analyze these to produce a JSON object with this EXACT schema:

{
  "voice_dna": {
    "openers": [
      {"phrase": "Hiya", "frequency": 0.6},
      {"phrase": "Hi [Name]", "frequency": 0.3}
    ],
    "closers": [
      {"phrase": "Cheers", "frequency": 0.5},
      {"phrase": "Thanks", "frequency": 0.3}
    ],
    "tics": ["uses & instead of and", "lowercase thanks", "short paragraphs"],
    "tone_keywords": ["friendly", "direct", "helpful"],
    "formatting_rules": ["Never uses bullet points", "Keeps responses under 100 words"],
    "avg_response_length": 85,
    "emoji_usage": "never"
  },
  "playbook": [
    {
      "category": "quote_request",
      "frequency": 0.35,
      "required_info": ["postcode", "property type"],
      "pricing_logic": "Gives base price immediately, asks for postcode to confirm coverage",
      "typical_structure": "Greeting → Price → Ask postcode → Sign off",
      "golden_example": {
        "customer": "How much for a 3 bed semi?",
        "owner": "Hiya! 3-bed semi is £18 for us. What's your postcode and I'll check we cover your area? Cheers"
      }
    },
    {
      "category": "booking_request",
      "frequency": 0.25,
      "required_info": ["preferred date", "address"],
      "typical_structure": "Acknowledge → Check availability → Confirm or offer alternative",
      "golden_example": {
        "customer": "Can you come this week?",
        "owner": "Hi! Got availability Thursday afternoon - would that work? Just need your address and I'll get you booked in"
      }
    }
  ],
  "summary": "A brief 2-3 sentence summary of how this person communicates"
}

IMPORTANT:
- Extract REAL phrases from the data, don't invent generic ones
- Frequencies should roughly match what you observe
- golden_examples should be VERBATIM from the data (or very close)
- Include ALL categories you find (quote, booking, complaint, general inquiry, etc.)
- The summary should capture the overall communication style

Output ONLY valid JSON, nothing else.`

    console.log('[voice-learning] Calling Claude for profile extraction...')

    const claudeResponse = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: extractionPrompt }]
      })
    })

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text()
      console.error('[voice-learning] Claude API error:', errorText)
      throw new Error(`Claude API error: ${claudeResponse.status}`)
    }

    const claudeData = await claudeResponse.json()
    const responseText = claudeData.content?.[0]?.text || ''
    
    // Parse JSON (handle markdown code blocks)
    let profile
    try {
      const cleanJson = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim()
      profile = JSON.parse(cleanJson)
    } catch (e) {
      console.error('[voice-learning] Failed to parse Claude response:', responseText.slice(0, 500))
      throw new Error('Failed to parse voice profile JSON')
    }

    console.log('[voice-learning] Profile extracted successfully')

    // =========================================
    // STEP 4: Store voice profile
    // =========================================
    
    const { error: upsertError } = await supabase.from('voice_profiles').upsert({
      workspace_id: workspace_id,
      voice_dna: profile.voice_dna,
      playbook: profile.playbook,
      emails_analyzed: pairs.length,
      updated_at: new Date().toISOString(),
      // Also update legacy fields for backwards compatibility
      tone: profile.voice_dna?.tone_keywords?.[0] || 'friendly',
      greeting_style: profile.voice_dna?.openers?.[0]?.phrase || 'Hi',
      signoff_style: profile.voice_dna?.closers?.[0]?.phrase || 'Thanks',
      tone_descriptors: profile.voice_dna?.tone_keywords || []
    }, { onConflict: 'workspace_id' })

    if (upsertError) {
      console.error('[voice-learning] Error upserting profile:', upsertError)
    }

    // =========================================
    // STEP 5: Store real examples with embeddings
    // =========================================
    
    // Clear old examples first
    await supabase
      .from('example_responses')
      .delete()
      .eq('workspace_id', workspace_id)
    
    // Take top 50 pairs for vector memory
    const examplePairs = pairs.slice(0, 50)
    let storedCount = 0
    
    for (const pair of examplePairs) {
      if (!pair.customer_text || !pair.owner_text) continue
      
      try {
        // Generate embedding for customer's email
        const embeddingResponse = await fetch(OPENAI_API, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: pair.customer_text.slice(0, 1000)
          })
        })
        
        if (!embeddingResponse.ok) {
          console.error('[voice-learning] Embedding error for pair')
          continue
        }
        
        const embeddingData = await embeddingResponse.json()
        const embedding = embeddingData.data?.[0]?.embedding
        
        if (!embedding) continue
        
        // Determine category based on content (simple heuristic)
        let category = 'general'
        const text = pair.customer_text.toLowerCase()
        if (text.includes('price') || text.includes('cost') || text.includes('how much') || text.includes('quote')) {
          category = 'quote_request'
        } else if (text.includes('book') || text.includes('appointment') || text.includes('available') || text.includes('come')) {
          category = 'booking_request'
        } else if (text.includes('cancel') || text.includes('stop') || text.includes('end')) {
          category = 'cancellation'
        } else if (text.includes('sorry') || text.includes('missed') || text.includes('wrong') || text.includes('complaint') || text.includes('unhappy')) {
          category = 'complaint'
        } else if (text.includes('thank') || text.includes('great') || text.includes('happy') || text.includes('pleased')) {
          category = 'positive_feedback'
        }
        
        const { error: insertError } = await supabase.from('example_responses').insert({
          workspace_id: workspace_id,
          category,
          inbound_text: pair.customer_text,
          outbound_text: pair.owner_text,
          inbound_embedding: embedding,
          response_time_hours: pair.response_hours
        })
        
        if (!insertError) {
          storedCount++
        }
      } catch (e) {
        console.error('[voice-learning] Failed to store example:', e)
        // Continue with other examples
      }
    }

    console.log('[voice-learning] Stored examples:', storedCount)

    // Update count
    await supabase.from('voice_profiles')
      .update({ examples_stored: storedCount })
      .eq('workspace_id', workspace_id)

    // =========================================
    // DONE
    // =========================================
    
    const duration = Date.now() - startTime
    console.log(`[voice-learning] Completed in ${duration}ms`)

    return new Response(JSON.stringify({
      success: true,
      pairs_analyzed: pairs.length,
      examples_stored: storedCount,
      voice_dna: profile.voice_dna,
      playbook_categories: profile.playbook?.length || 0,
      profile_summary: profile.summary || profile.voice_dna?.tone_keywords?.join(', ') || 'Profile created',
      duration_ms: duration
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('[voice-learning] Error:', error)
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
