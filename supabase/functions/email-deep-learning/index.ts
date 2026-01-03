import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PAIRS_TO_ANALYZE = 100;  // Use best 100 conversation pairs

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

    const anthropic = new Anthropic({ 
      apiKey: Deno.env.get('ANTHROPIC_API_KEY')! 
    });

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
      .gt('reply_length', 50)              // Skip very short replies
      .order('received_at', { ascending: false })
      .limit(PAIRS_TO_ANALYZE);

    if (!pairs || pairs.length < 10) {
      console.log('[deep-learning] Not enough pairs to analyze:', pairs?.length || 0);
      await supabase.from('email_import_progress').update({
        current_phase: 'complete',
        phase3_status: 'complete',
        phase3_completed_at: new Date().toISOString()
      }).eq('workspace_id', workspaceId);
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Not enough conversation pairs' 
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[deep-learning] Analyzing ${pairs.length} conversation pairs`);

    // =========================================================
    // STEP 2: Build the prompt with real conversations
    // =========================================================
    const conversationExamples = pairs.map((p, i) => `
CONVERSATION ${i + 1}:
[CUSTOMER EMAIL]
${(p.inbound_body || '').substring(0, 600)}

[OWNER REPLY] (sent ${Math.round((p.reply_time_hours || 0) * 10) / 10} hours later)
${(p.outbound_body || '').substring(0, 600)}
`).join('\n---\n');

    const analysisPrompt = `You are analyzing real email conversations from a business owner to learn how they communicate.

Here are ${pairs.length} real conversations where a customer emailed and the owner replied:

${conversationExamples}

Based on these real examples, create a comprehensive profile. Return ONLY valid JSON:

{
  "voice_profile": {
    "tone": "friendly|professional|casual|formal",
    "tone_description": "2-3 sentence description of their overall style",
    "greeting_style": "How they typically start emails",
    "sign_off_style": "How they typically end emails",
    "common_phrases": ["phrases", "they", "use", "frequently"],
    "uses_emojis": true|false,
    "uses_exclamations": true|false,
    "formality_level": 1-10,
    "avg_response_length": "brief|moderate|detailed",
    "personality_traits": ["helpful", "direct", "warm", etc]
  },
  
  "response_playbook": {
    "quote_request": {
      "typical_response_pattern": "How they typically handle quote requests",
      "key_elements": ["what they always include"],
      "example_response": "A synthesized example based on real responses"
    },
    "complaint": {
      "typical_response_pattern": "How they handle complaints",
      "key_elements": ["what they always include"],
      "example_response": "A synthesized example"
    },
    "booking_request": {
      "typical_response_pattern": "How they handle bookings",
      "key_elements": ["what they always include"],
      "example_response": "A synthesized example"
    },
    "general_question": {
      "typical_response_pattern": "How they handle questions",
      "key_elements": ["what they always include"],
      "example_response": "A synthesized example"
    },
    "thank_you": {
      "typical_response_pattern": "How they respond to thanks",
      "key_elements": ["what they always include"],
      "example_response": "A synthesized example"
    },
    "cancellation": {
      "typical_response_pattern": "How they handle cancellations",
      "key_elements": ["what they always include"],
      "example_response": "A synthesized example"
    }
  },
  
  "decision_patterns": {
    "always_responds_to": ["types of emails they always reply to"],
    "sometimes_ignores": ["types they might not reply to"],
    "escalates_to_phone_when": ["situations where they call instead"],
    "offers_discount_when": ["situations where they offer deals"],
    "says_no_when": ["situations where they decline"]
  },
  
  "timing_patterns": {
    "urgent_types": ["email types they reply to within 1 hour"],
    "same_day_types": ["email types they reply to same day"],
    "can_wait_types": ["email types that can wait longer"]
  },
  
  "real_examples": [
    {
      "scenario": "quote_request",
      "customer_said": "Brief summary of what customer asked",
      "owner_replied": "The actual reply they sent"
    },
    {
      "scenario": "complaint",
      "customer_said": "Brief summary",
      "owner_replied": "The actual reply"
    },
    {
      "scenario": "booking",
      "customer_said": "Brief summary",
      "owner_replied": "The actual reply"
    }
  ],
  
  "confidence_score": 0.0-1.0
}`;

    // =========================================================
    // STEP 3: Call Claude Sonnet for deep analysis
    // =========================================================
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [{ role: 'user', content: analysisPrompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    let analysis;
    try {
      let text = content.text.trim();
      text = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      analysis = JSON.parse(text);
    } catch (e) {
      console.error('[deep-learning] JSON parse error:', e);
      throw new Error('Failed to parse Claude response');
    }

    // =========================================================
    // STEP 4: Store the learned profile and playbook
    // =========================================================
    
    // Store voice profile
    await supabase.from('voice_profiles').upsert({
      workspace_id: workspaceId,
      tone: analysis.voice_profile.tone,
      tone_description: analysis.voice_profile.tone_description,
      greeting_style: analysis.voice_profile.greeting_style,
      sign_off_style: analysis.voice_profile.sign_off_style,
      common_phrases: analysis.voice_profile.common_phrases,
      uses_emojis: analysis.voice_profile.uses_emojis,
      uses_exclamations: analysis.voice_profile.uses_exclamations,
      formality_level: analysis.voice_profile.formality_level,
      avg_response_length: analysis.voice_profile.avg_response_length,
      personality_traits: analysis.voice_profile.personality_traits,
      example_responses: analysis.real_examples,
      emails_analyzed: pairs.length,
      confidence_score: analysis.confidence_score,
      last_analyzed_at: new Date().toISOString()
    }, { onConflict: 'workspace_id' });

    // Store response playbook
    await supabase.from('response_playbook').upsert({
      workspace_id: workspaceId,
      playbook: analysis.response_playbook,
      decision_patterns: analysis.decision_patterns,
      timing_patterns: analysis.timing_patterns,
      updated_at: new Date().toISOString()
    }, { onConflict: 'workspace_id' });

    // Mark pairs as analyzed
    const pairIds = pairs.map(p => p.id);
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
      updated_at: new Date().toISOString()
    }).eq('workspace_id', workspaceId);

    console.log('[deep-learning] Phase 3 complete!');

    return new Response(JSON.stringify({
      success: true,
      pairsAnalyzed: pairs.length,
      voiceProfile: analysis.voice_profile,
      playbookScenarios: Object.keys(analysis.response_playbook).length
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[deep-learning] Error:', error);
    
    // Update progress with error
    if (workspaceId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      await supabase.from('email_import_progress').update({
        current_phase: 'error',
        last_error: String(error)
      }).eq('workspace_id', workspaceId);
    }

    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
