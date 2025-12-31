import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// VOICE PROFILE ANALYZER
// Extracts communication patterns from outbound emails
// to make AI drafts match the user's writing style
// ============================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { workspace_id } = await req.json();
    console.log('[VoiceProfile] Starting analysis for workspace:', workspace_id);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Fetch ALL outbound messages from this workspace (increased limit for better learning)
    const { data: outboundMessages, error: msgError } = await supabase
      .from('messages')
      .select(`
        id,
        body,
        created_at,
        conversation_id,
        conversations!inner (
          workspace_id,
          customer_id,
          category,
          led_to_booking
        )
      `)
      .eq('direction', 'outbound')
      .eq('actor_type', 'human_agent')
      .eq('conversations.workspace_id', workspace_id)
      .order('created_at', { ascending: false })
      .limit(1000); // Increased from 200 to analyze more messages

    if (msgError) {
      console.error('[VoiceProfile] Error fetching messages:', msgError);
      throw msgError;
    }

    console.log('[VoiceProfile] Found', outboundMessages?.length || 0, 'outbound messages');

    if (!outboundMessages || outboundMessages.length < 5) {
      console.log('[VoiceProfile] Not enough outbound messages for analysis');
      
      // Update profile status
      await supabase
        .from('voice_profiles')
        .upsert({
          workspace_id,
          analysis_status: 'insufficient_data',
          emails_analyzed: outboundMessages?.length || 0,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id' });

      return new Response(JSON.stringify({ 
        success: false, 
        reason: 'insufficient_data',
        emails_found: outboundMessages?.length || 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Prepare sample emails for analysis
    const sampleEmails = outboundMessages.slice(0, 50).map(m => ({
      body: m.body?.substring(0, 500) || '',
      category: (m.conversations as any)?.category || 'unknown',
      led_to_booking: (m.conversations as any)?.led_to_booking || false,
    }));

    // Call Claude to analyze the writing style
    console.log('[VoiceProfile] Calling Claude for style analysis...');
    
    const analysisPrompt = `Analyze these email replies from a business to extract their unique communication style.

EMAILS TO ANALYZE:
${sampleEmails.map((e, i) => `--- Email ${i + 1} ---\n${e.body}`).join('\n\n')}

Extract the following patterns in JSON format:

{
  "greeting_patterns": ["array of greeting phrases used, e.g. 'Hi [name]', 'Hello', 'Good morning'"],
  "signoff_patterns": ["array of sign-off phrases, e.g. 'Cheers', 'Best regards', 'Thanks'"],
  "formality_score": 0-100 (0=very casual, 100=very formal),
  "avg_response_length": "short" | "medium" | "long",
  "uses_emojis": true/false,
  "uses_exclamations": true/false,
  "common_phrases": ["frequently used phrases or expressions unique to this person"],
  "tone_descriptors": ["3-5 adjectives describing the tone, e.g. 'friendly', 'professional', 'direct', 'warm'"],
  "style_notes": "2-3 sentence summary of what makes this person's writing style unique"
}

Respond ONLY with the JSON object, no markdown or explanations.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: analysisPrompt }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[VoiceProfile] Claude API error:', response.status, errorText);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const result = await response.json();
    const analysisText = result.content?.[0]?.text || '{}';
    
    console.log('[VoiceProfile] Raw analysis:', analysisText.substring(0, 200));

    // Parse the JSON response
    let analysis;
    try {
      analysis = JSON.parse(analysisText);
    } catch (e) {
      console.error('[VoiceProfile] Failed to parse analysis:', e);
      analysis = {
        greeting_patterns: [],
        signoff_patterns: [],
        formality_score: 50,
        uses_emojis: false,
        uses_exclamations: false,
        common_phrases: [],
        tone_descriptors: ['professional'],
      };
    }

    // Select best sample responses for few-shot learning
    // Prioritize emails that led to bookings
    const successfulEmails = sampleEmails
      .filter(e => e.led_to_booking && e.body.length > 50)
      .slice(0, 3);
    
    const regularEmails = sampleEmails
      .filter(e => !e.led_to_booking && e.body.length > 50)
      .slice(0, 5 - successfulEmails.length);

    const sampleResponses = [...successfulEmails, ...regularEmails].map(e => ({
      body: e.body,
      category: e.category,
      successful: e.led_to_booking,
    }));

    // Convert avg_response_length to integer
    let avgLength = 100;
    if (analysis.avg_response_length === 'short') avgLength = 50;
    else if (analysis.avg_response_length === 'long') avgLength = 200;

    // Save voice profile
    const { error: upsertError } = await supabase
      .from('voice_profiles')
      .upsert({
        workspace_id,
        greeting_patterns: analysis.greeting_patterns || [],
        signoff_patterns: analysis.signoff_patterns || [],
        formality_score: analysis.formality_score || 50,
        avg_response_length: avgLength,
        uses_emojis: analysis.uses_emojis || false,
        uses_exclamations: analysis.uses_exclamations || false,
        common_phrases: analysis.common_phrases || [],
        tone_descriptors: analysis.tone_descriptors || [],
        sample_responses: sampleResponses,
        analysis_status: 'complete',
        emails_analyzed: outboundMessages.length,
        outbound_emails_found: outboundMessages.length,
        last_analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

    if (upsertError) {
      console.error('[VoiceProfile] Error saving profile:', upsertError);
      throw upsertError;
    }

    // Update email config status
    await supabase
      .from('email_provider_configs')
      .update({ voice_profile_status: 'complete' })
      .eq('workspace_id', workspace_id);

    const processingTime = Date.now() - startTime;
    console.log('[VoiceProfile] Analysis complete in', processingTime, 'ms');

    return new Response(JSON.stringify({ 
      success: true,
      emails_analyzed: outboundMessages.length,
      tone: analysis.tone_descriptors,
      formality: analysis.formality_score,
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
