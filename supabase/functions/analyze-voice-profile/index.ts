import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// ENHANCED VOICE PROFILE ANALYZER
// Uses matched email pairs to extract communication patterns
// per category for accurate AI clone generation
// ============================================

function buildStyleAnalysisPrompt(pairs: any[], categories: string[]): string {
  const categoryExamples = categories.map(cat => {
    const catPairs = pairs.filter(p => p.category === cat);
    return `
=== ${cat.toUpperCase()} (${catPairs.length} examples) ===
${catPairs.slice(0, 15).map(p => `
INBOUND: ${(p.inbound_body || "").substring(0, 250)}
RESPONSE: ${(p.outbound_body || "").substring(0, 350)}
RESPONSE TIME: ${p.response_time_minutes} minutes
`).join('\n')}`;
  }).join('\n');

  return `You are analyzing email responses from a business owner to understand their EXACT communication style.
These responses have been categorized. Analyze patterns WITHIN and ACROSS categories.

CATEGORIZED EMAIL PAIRS:
${categoryExamples}

Extract the following in JSON format:

{
  "voice_profile": {
    "overall_tone": "friendly" | "professional" | "casual" | "formal",
    "formality_level": 1-10 (1=very casual, 10=very formal),
    "warmth_level": 1-10 (1=cold/distant, 10=very warm/personal),
    "directness_level": 1-10 (1=verbose, 10=blunt),
    
    "greeting_patterns": [
      {"text": "Hi {name},", "frequency": 0.6},
      {"text": "Hiya", "frequency": 0.3}
    ],
    "signoff_patterns": [
      {"text": "Cheers, Michael", "frequency": 0.7},
      {"text": "Thanks", "frequency": 0.2}
    ],
    "common_phrases": [
      {"phrase": "no worries", "frequency": 0.4},
      {"phrase": "pop me a message", "frequency": 0.2}
    ],
    "avoided_words": ["unfortunately", "sorry but"],
    
    "avg_response_length": 45,
    "avg_sentences": 4,
    "emoji_frequency": "never" | "rare" | "sometimes" | "often",
    "common_emojis": [],
    "uses_exclamation_marks": true,
    "exclamation_frequency": 0.3,
    
    "price_mention_style": "direct" | "soft" | "range",
    "objection_handling_style": "brief description of how they handle pushback"
  },
  
  "response_patterns": {
    "quote_request": {
      "avg_length": 45,
      "typical_structure": ["greeting", "price", "availability", "cta", "signoff"],
      "always_includes": ["specific_price", "next_steps"],
      "tone_variation": "slightly_more_sales",
      "example_phrases": ["Happy to help!", "Our price would be..."]
    },
    "complaint": {
      "avg_length": 78,
      "typical_structure": ["greeting", "empathy", "apology", "solution", "signoff"],
      "always_includes": ["acknowledgment", "resolution"],
      "tone_variation": "more_formal",
      "example_phrases": ["I'm sorry to hear that", "Let me sort this"]
    },
    "general_inquiry": {
      "avg_length": 40,
      "typical_structure": ["greeting", "answer", "question_back", "signoff"],
      "always_includes": ["direct_answer"],
      "tone_variation": "standard",
      "example_phrases": []
    }
  },
  
  "ignore_patterns": {
    "domains": ["newsletter.com", "marketing.io"],
    "subject_contains": ["unsubscribe", "weekly digest"],
    "from_contains": ["noreply", "no-reply"]
  },
  
  "style_confidence": 0.85
}

Return ONLY the JSON object, no markdown or explanations.`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { workspace_id } = await req.json();
    console.log('[VoiceProfile] Starting enhanced analysis for workspace:', workspace_id);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Update progress
    await supabase.from('onboarding_progress').update({
      style_analysis_status: 'running',
    }).eq('workspace_id', workspace_id);

    await supabase.from('email_provider_configs').update({
      sync_stage: 'analyzing_style',
      voice_profile_status: 'analyzing',
    }).eq('workspace_id', workspace_id);

    if (!ANTHROPIC_API_KEY) {
      console.log('[VoiceProfile] No ANTHROPIC_API_KEY, skipping analysis');
      await supabase.from('voice_profiles').upsert({
        workspace_id,
        analysis_status: 'skipped',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });
      
      // Skip to few-shot library
      supabase.functions.invoke('build-few-shot-library', {
        body: { workspace_id }
      }).catch(err => console.error('Few-shot build failed:', err));
      
      return new Response(JSON.stringify({ skipped: true, reason: 'No API key' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // First, try to use email_pairs (new enhanced path)
    const { data: emailPairs, error: pairsError } = await supabase
      .from('email_pairs')
      .select('id, inbound_body, outbound_body, category, response_time_minutes, led_to_booking, quality_score')
      .eq('workspace_id', workspace_id)
      .not('category', 'is', null)
      .limit(300);

    let analysisData: any = null;

    if (emailPairs && emailPairs.length >= 10) {
      // Enhanced path: Use categorized email pairs
      console.log('[VoiceProfile] Using enhanced analysis with', emailPairs.length, 'categorized pairs');
      
      const categories = [...new Set(emailPairs.map(p => p.category).filter(Boolean))];
      console.log('[VoiceProfile] Categories found:', categories);
      
      const prompt = buildStyleAnalysisPrompt(emailPairs, categories);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`);
      }

      const result = await response.json();
      const analysisText = result.content?.[0]?.text || '{}';
      
      // Extract JSON
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisData = JSON.parse(jsonMatch[0]);
      }
    } else {
      // Fallback: Use direct outbound messages (legacy path)
      console.log('[VoiceProfile] Falling back to legacy analysis (no categorized pairs)');
      
      const { data: outboundMessages } = await supabase
        .from('messages')
        .select(`
          id, body, created_at, conversation_id,
          conversations!inner (workspace_id, category, led_to_booking)
        `)
        .eq('direction', 'outbound')
        .eq('actor_type', 'human_agent')
        .eq('conversations.workspace_id', workspace_id)
        .order('created_at', { ascending: false })
        .limit(500);

      if (!outboundMessages || outboundMessages.length < 5) {
        console.log('[VoiceProfile] Not enough data for analysis');
        await supabase.from('voice_profiles').upsert({
          workspace_id,
          analysis_status: 'insufficient_data',
          emails_analyzed: outboundMessages?.length || 0,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id' });

        await supabase.from('onboarding_progress').update({
          style_analysis_status: 'completed',
          few_shot_status: 'skipped',
          completed_at: new Date().toISOString(),
        }).eq('workspace_id', workspace_id);

        await supabase.from('email_provider_configs').update({
          sync_stage: 'complete',
          voice_profile_status: 'insufficient_data',
        }).eq('workspace_id', workspace_id);

        return new Response(JSON.stringify({
          success: false,
          reason: 'insufficient_data',
          emails_found: outboundMessages?.length || 0
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Legacy analysis prompt
      const sampleEmails = outboundMessages.slice(0, 50).map(m => m.body?.substring(0, 500) || '');
      const legacyPrompt = `Analyze these email replies to extract communication style:

${sampleEmails.map((e, i) => `--- Email ${i + 1} ---\n${e}`).join('\n\n')}

Return JSON with:
{
  "voice_profile": {
    "overall_tone": "friendly",
    "formality_level": 5,
    "warmth_level": 7,
    "directness_level": 6,
    "greeting_patterns": [{"text": "Hi", "frequency": 0.5}],
    "signoff_patterns": [{"text": "Thanks", "frequency": 0.5}],
    "common_phrases": [{"phrase": "no worries", "frequency": 0.3}],
    "avg_response_length": 50,
    "emoji_frequency": "never",
    "uses_exclamation_marks": true
  },
  "response_patterns": {},
  "style_confidence": 0.6
}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{ role: 'user', content: legacyPrompt }]
        })
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`);
      }

      const result = await response.json();
      const analysisText = result.content?.[0]?.text || '{}';
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisData = JSON.parse(jsonMatch[0]);
      }
    }

    // Get onboarding insights for response rate
    const { data: progress } = await supabase
      .from('onboarding_progress')
      .select('response_rate_percent, avg_response_time_hours, pairs_matched')
      .eq('workspace_id', workspace_id)
      .single();

    // Save voice profile with all new fields
    const voiceProfile = analysisData?.voice_profile || {};
    const responsePatterns = analysisData?.response_patterns || {};
    const ignorePatterns = analysisData?.ignore_patterns || {};
    const styleConfidence = analysisData?.style_confidence || 0.5;

    const { error: upsertError } = await supabase
      .from('voice_profiles')
      .upsert({
        workspace_id,
        // Core style metrics
        formality_score: voiceProfile.formality_level ? voiceProfile.formality_level * 10 : 50,
        warmth_level: voiceProfile.warmth_level || 5,
        directness_level: voiceProfile.directness_level || 5,
        
        // Patterns
        greeting_patterns: voiceProfile.greeting_patterns || [],
        signoff_patterns: voiceProfile.signoff_patterns || [],
        common_phrases: voiceProfile.common_phrases || [],
        avoided_words: voiceProfile.avoided_words || [],
        
        // Writing stats
        avg_response_length: voiceProfile.avg_response_length || 50,
        avg_sentences: voiceProfile.avg_sentences || 4,
        avg_words_per_sentence: voiceProfile.avg_words_per_sentence || 12,
        
        // Emoji/punctuation
        uses_emojis: voiceProfile.emoji_frequency !== 'never',
        emoji_frequency: voiceProfile.emoji_frequency || 'never',
        uses_exclamations: voiceProfile.uses_exclamation_marks || false,
        exclamation_frequency: voiceProfile.exclamation_frequency || 0.1,
        
        // Tone descriptors
        tone_descriptors: voiceProfile.overall_tone ? [voiceProfile.overall_tone] : ['professional'],
        
        // Category-specific patterns
        response_patterns: responsePatterns,
        ignore_patterns: ignorePatterns,
        
        // Business-specific
        price_mention_style: voiceProfile.price_mention_style || 'direct',
        objection_handling_style: voiceProfile.objection_handling_style || null,
        
        // Metrics
        total_pairs_analyzed: emailPairs?.length || 0,
        response_rate_percent: progress?.response_rate_percent || null,
        avg_response_time_minutes: progress?.avg_response_time_hours 
          ? Math.round(progress.avg_response_time_hours * 60) 
          : null,
        style_confidence: styleConfidence,
        
        // Status
        analysis_status: 'complete',
        emails_analyzed: emailPairs?.length || 0,
        last_analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

    if (upsertError) {
      console.error('[VoiceProfile] Error saving profile:', upsertError);
      throw upsertError;
    }

    // Update progress
    await supabase.from('onboarding_progress').update({
      style_analysis_status: 'completed',
      few_shot_status: 'running',
    }).eq('workspace_id', workspace_id);

    // Trigger few-shot library build
    console.log('[VoiceProfile] Starting few-shot library build...');
    supabase.functions.invoke('build-few-shot-library', {
      body: { workspace_id }
    }).catch(err => console.error('Few-shot build failed:', err));

    const processingTime = Date.now() - startTime;
    console.log('[VoiceProfile] Analysis complete in', processingTime, 'ms');

    return new Response(JSON.stringify({
      success: true,
      pairs_analyzed: emailPairs?.length || 0,
      categories: Object.keys(responsePatterns),
      style_confidence: styleConfidence,
      processing_time_ms: processingTime
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[VoiceProfile] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
