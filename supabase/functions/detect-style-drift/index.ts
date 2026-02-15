import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DRIFT_THRESHOLD = 0.3
const SAMPLE_SIZE = 20

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { workspace_id } = await req.json()
    if (!workspace_id) throw new Error('workspace_id is required')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured')

    console.log('[detect-style-drift] Starting for workspace:', workspace_id)

    // 1. Get the existing voice profile
    const { data: profile, error: profileErr } = await supabase
      .from('voice_profiles')
      .select('voice_dna, updated_at, emails_analyzed')
      .eq('workspace_id', workspace_id)
      .single()

    if (profileErr || !profile?.voice_dna) {
      return new Response(JSON.stringify({
        success: false,
        reason: 'no_voice_profile',
        message: 'No voice profile exists to compare against.'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 2. Sample recent outbound emails (written after the profile was last updated)
    const { data: recentEmails, error: emailErr } = await supabase
      .from('email_import_queue')
      .select('body, body_clean, subject')
      .eq('workspace_id', workspace_id)
      .eq('direction', 'outbound')
      .eq('is_noise', false)
      .not('body', 'is', null)
      .gt('received_at', profile.updated_at || '2000-01-01')
      .order('received_at', { ascending: false })
      .limit(SAMPLE_SIZE)

    if (emailErr) throw emailErr

    if (!recentEmails || recentEmails.length < 5) {
      // Not enough new emails to compare
      const logEntry = {
        workspace_id,
        drift_score: 0,
        traits_changed: [],
        refresh_triggered: false,
        emails_sampled: recentEmails?.length || 0,
        status: 'insufficient_data',
      }
      await supabase.from('voice_drift_log').insert(logEntry)

      return new Response(JSON.stringify({
        success: true,
        drift_score: 0,
        message: `Only ${recentEmails?.length || 0} new emails since last profile update. Need at least 5.`,
        refresh_triggered: false,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 3. Build comparison prompt
    const voiceDna = profile.voice_dna as any
    const currentTraits = JSON.stringify({
      openers: voiceDna.openers || [],
      closers: voiceDna.closers || [],
      tics: voiceDna.tics || [],
      tone_keywords: voiceDna.tone_keywords || [],
      formatting_rules: voiceDna.formatting_rules || [],
      avg_response_length: voiceDna.avg_response_length || null,
      emoji_usage: voiceDna.emoji_usage || 'unknown',
    }, null, 2)

    const emailSamples = recentEmails.map((e, i) => {
      const text = (e.body_clean || e.body || '').slice(0, 300).trim()
      return `--- EMAIL ${i + 1} ---\n${text}`
    }).join('\n\n')

    const driftPrompt = `You are a forensic linguist comparing a person's stored writing profile against their recent emails to detect style drift.

STORED VOICE PROFILE:
${currentTraits}

RECENT EMAILS (${recentEmails.length} samples):
${emailSamples}

Analyze whether the person's writing style has changed. Compare:
1. Opening greetings (do they still use the same openers?)
2. Sign-offs/closers (same closers?)
3. Tone (more formal/informal than before?)
4. Sentence length (shorter/longer?)
5. Writing tics (new habits? old ones dropped?)
6. Emoji usage (changed?)

Return a JSON object:
{
  "drift_score": 0.0-1.0,
  "traits_changed": [
    {"trait": "openers", "old": "Hiya", "new": "Hey there", "severity": 0.4},
    {"trait": "tone", "old": "casual", "new": "more formal", "severity": 0.3}
  ],
  "summary": "Brief 1-2 sentence summary of what changed (or 'No significant drift detected')"
}

Rules:
- drift_score 0.0 = identical style, 1.0 = completely different person
- Only include traits_changed entries for traits with actual changes (severity > 0.1)
- Be conservative: minor variation is normal, only flag genuine shifts
- Output ONLY valid JSON`

    // 4. Call AI for drift analysis
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: driftPrompt }],
      }),
    })

    if (!aiResponse.ok) {
      const errText = await aiResponse.text()
      console.error('[detect-style-drift] AI error:', errText)
      throw new Error(`AI gateway error: ${aiResponse.status}`)
    }

    const aiData = await aiResponse.json()
    const responseText = aiData.choices?.[0]?.message?.content || ''

    // Parse response
    let driftResult: any
    try {
      const cleanJson = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim()
      driftResult = JSON.parse(cleanJson)
    } catch {
      console.error('[detect-style-drift] Failed to parse:', responseText.slice(0, 500))
      throw new Error('Failed to parse drift analysis')
    }

    const driftScore = Math.min(1, Math.max(0, driftResult.drift_score || 0))
    const traitsChanged = driftResult.traits_changed || []
    const shouldRefresh = driftScore >= DRIFT_THRESHOLD

    console.log(`[detect-style-drift] Score: ${driftScore}, refresh: ${shouldRefresh}, traits: ${traitsChanged.length}`)

    // 5. Log the result
    await supabase.from('voice_drift_log').insert({
      workspace_id,
      drift_score: driftScore,
      traits_changed: traitsChanged,
      refresh_triggered: shouldRefresh,
      emails_sampled: recentEmails.length,
      status: shouldRefresh ? 'refresh_triggered' : 'checked',
    })

    // 6. If drift is significant, trigger voice profile refresh
    if (shouldRefresh) {
      console.log('[detect-style-drift] Drift threshold exceeded, triggering voice-learning refresh')

      const refreshUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/voice-learning`
      try {
        const refreshResp = await fetch(refreshUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ workspace_id, force_refresh: true }),
        })
        const refreshResult = await refreshResp.json()
        console.log('[detect-style-drift] Voice refresh result:', refreshResult.success ? 'success' : refreshResult.reason)
      } catch (refreshErr) {
        console.error('[detect-style-drift] Voice refresh failed:', refreshErr)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      drift_score: driftScore,
      traits_changed: traitsChanged,
      summary: driftResult.summary || '',
      refresh_triggered: shouldRefresh,
      emails_sampled: recentEmails.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('[detect-style-drift] Error:', error.message)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
