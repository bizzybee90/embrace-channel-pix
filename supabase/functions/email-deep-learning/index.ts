import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PAIRS_TO_ANALYZE = 100;

type DeepLearningResult = {
  voice_profile: {
    greeting_patterns?: string[];
    signoff_patterns?: string[];
    formality_score?: number;
    warmth_level?: number;
    directness_level?: number;
    uses_emojis?: boolean;
    uses_exclamations?: boolean;
    emoji_frequency?: string;
    exclamation_frequency?: number;
    avg_response_length?: number;
    avg_sentences?: number;
    avg_words_per_sentence?: number;
    common_phrases?: string[];
    avoided_words?: string[];
    tone_descriptors?: string[];
    response_patterns?: Record<string, unknown>;
    reply_triggers?: Record<string, unknown>;
    price_mention_style?: string;
    booking_confirmation_style?: string | null;
    objection_handling_style?: string | null;
    personality_traits?: Record<string, unknown>;
    example_responses?: unknown;
    style_confidence?: number;
  };
  response_playbook: Record<string, unknown>;
  decision_patterns?: Record<string, unknown>;
  timing_patterns?: Record<string, unknown>;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let workspaceId: string | undefined;

  try {
    const body = await req.json();
    workspaceId = body.workspaceId;
    console.log('[deep-learning] Starting Phase 3 for:', workspaceId);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    // Update progress
    await supabase.from('email_import_progress').update({
      current_phase: 'learning',
      phase3_status: 'running',
      updated_at: new Date().toISOString()
    }).eq('workspace_id', workspaceId);

    // =========================================================
    // STEP 1: Get best conversation pairs
    // =========================================================
    const { data: pairs } = await supabase
      .from('conversation_pairs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('analyzed_in_phase3', false)
      .gt('reply_length', 50)
      .order('received_at', { ascending: false })
      .limit(PAIRS_TO_ANALYZE);

    if (!pairs || pairs.length < 10) {
      console.log('[deep-learning] Not enough pairs to analyze:', pairs?.length || 0);
      await supabase.from('email_import_progress').update({
        current_phase: 'complete',
        phase3_status: 'complete',
        phase3_completed_at: new Date().toISOString(),
        last_error: pairs && pairs.length > 0 ? 'Not enough reply pairs to learn a voice yet' : null,
        updated_at: new Date().toISOString(),
      }).eq('workspace_id', workspaceId);

      return new Response(JSON.stringify({
        success: true,
        message: 'Not enough conversation pairs'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[deep-learning] Analyzing ${pairs.length} conversation pairs`);

    // =========================================================
    // STEP 2: Build prompt
    // =========================================================
    const conversationExamples = pairs.map((p: any, i: number) => `
CONVERSATION ${i + 1}:
[CUSTOMER EMAIL]
${String(p.inbound_body || '').substring(0, 600)}

[OWNER REPLY]
${String(p.outbound_body || '').substring(0, 800)}
`).join('\n---\n');

    const prompt = `You analyze a business owner's email replies to learn their communication style.

You will return ONLY valid JSON. No markdown.

INPUT CONVERSATIONS:
${conversationExamples}

Return JSON with this exact shape:
{
  "voice_profile": {
    "greeting_patterns": ["Hi John,"],
    "signoff_patterns": ["Thanks, Mike"],
    "formality_score": 0-100,
    "warmth_level": 1-10,
    "directness_level": 1-10,
    "uses_emojis": true|false,
    "uses_exclamations": true|false,
    "emoji_frequency": "never|rarely|sometimes|often",
    "exclamation_frequency": 0.0-1.0,
    "avg_response_length": integer,
    "avg_sentences": integer,
    "avg_words_per_sentence": number,
    "common_phrases": ["no problem", "happy to help"],
    "avoided_words": ["synergy"],
    "tone_descriptors": ["friendly", "professional"],
    "response_patterns": {"structure": "..."},
    "reply_triggers": {"always_reply_to": ["booking"], "sometimes_ignore": ["newsletter"]},
    "price_mention_style": "direct|soft|avoid",
    "booking_confirmation_style": "string or null",
    "objection_handling_style": "string or null",
    "personality_traits": {"traits": ["helpful", "calm"]},
    "example_responses": [],
    "style_confidence": 0.0-1.0
  },
  "response_playbook": {"booking_request": {"example_response": "..."}},
  "decision_patterns": {},
  "timing_patterns": {}
}

Constraints:
- Keep arrays short (max ~8 items each).
- Use conservative defaults if unsure.
- Make sure it is valid JSON.`;

    // =========================================================
    // STEP 3: Call Lovable AI
    // =========================================================
    const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      throw new Error(`Lovable AI failed: ${aiResp.status} ${t}`);
    }

    const aiJson = await aiResp.json();
    const contentText = aiJson?.choices?.[0]?.message?.content;
    if (!contentText) throw new Error('Lovable AI returned empty content');

    let parsed: DeepLearningResult;
    try {
      const cleaned = String(contentText).replace(/```json\n?/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('[deep-learning] JSON parse error:', e, 'content:', contentText);
      throw new Error('Failed to parse AI JSON');
    }

    // =========================================================
    // STEP 4: Persist results
    // =========================================================
    const vp = parsed.voice_profile || {};

    await supabase.from('voice_profiles').upsert({
      workspace_id: workspaceId,
      greeting_patterns: vp.greeting_patterns || [],
      signoff_patterns: vp.signoff_patterns || [],
      formality_score: vp.formality_score ?? 50,
      warmth_level: vp.warmth_level ?? 5,
      directness_level: vp.directness_level ?? 5,
      uses_emojis: vp.uses_emojis ?? false,
      uses_exclamations: vp.uses_exclamations ?? false,
      emoji_frequency: vp.emoji_frequency ?? 'never',
      exclamation_frequency: vp.exclamation_frequency ?? 0.1,
      avg_response_length: vp.avg_response_length ?? 0,
      avg_sentences: vp.avg_sentences ?? 0,
      avg_words_per_sentence: vp.avg_words_per_sentence ?? 0,
      common_phrases: vp.common_phrases || [],
      avoided_words: vp.avoided_words || [],
      tone_descriptors: vp.tone_descriptors || [],
      response_patterns: vp.response_patterns || {},
      reply_triggers: vp.reply_triggers || {},
      price_mention_style: vp.price_mention_style ?? 'direct',
      booking_confirmation_style: vp.booking_confirmation_style ?? null,
      objection_handling_style: vp.objection_handling_style ?? null,
      personality_traits: vp.personality_traits ?? null,
      example_responses: vp.example_responses ?? null,
      style_confidence: vp.style_confidence ?? 0,
      emails_analyzed: pairs.length,
      outbound_emails_found: pairs.length,
      total_pairs_analyzed: pairs.length,
      analysis_status: 'complete',
      last_analyzed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id' });

    await supabase.from('response_playbook').upsert({
      workspace_id: workspaceId,
      playbook: parsed.response_playbook || {},
      decision_patterns: parsed.decision_patterns || null,
      timing_patterns: parsed.timing_patterns || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id' });

    // Mark pairs as analyzed
    const pairIds = pairs.map((p: any) => p.id);
    await supabase.from('conversation_pairs')
      .update({ analyzed_in_phase3: true })
      .in('id', pairIds);

    // =========================================================
    // STEP 5: Complete!
    // =========================================================
    await supabase.from('email_import_progress').update({
      current_phase: 'complete',
      phase3_status: 'complete',
      phase3_completed_at: new Date().toISOString(),
      pairs_analyzed: pairs.length,
      voice_profile_complete: true,
      playbook_complete: true,
      last_error: null,
      updated_at: new Date().toISOString()
    }).eq('workspace_id', workspaceId);

    console.log('[deep-learning] Phase 3 complete!');

    return new Response(JSON.stringify({
      success: true,
      pairsAnalyzed: pairs.length,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[deep-learning] Error:', error);

    if (workspaceId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      await supabase.from('email_import_progress').update({
        current_phase: 'error',
        last_error: String(error),
        updated_at: new Date().toISOString(),
      }).eq('workspace_id', workspaceId);
    }

    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
