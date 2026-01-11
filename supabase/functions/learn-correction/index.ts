import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CorrectionInput {
  workspace_id: string;
  conversation_id: string;
  original_draft: string;
  edited_draft: string;
}

interface LearningResult {
  success: boolean;
  learnings: string[];
  analysis?: string;
  function?: string;
  step?: string;
  duration_ms?: number;
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'learn-correction';
  let currentStep = 'initializing';

  try {
    // Validate environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured');
    }
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY environment variable not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse and validate input
    currentStep = 'validating_input';
    const body: CorrectionInput = await req.json();
    console.log(`[${functionName}] Starting:`, {
      workspace_id: body.workspace_id,
      conversation_id: body.conversation_id,
      original_length: body.original_draft?.length,
      edited_length: body.edited_draft?.length
    });

    if (!body.workspace_id) {
      throw new Error('workspace_id is required');
    }
    if (!body.conversation_id) {
      throw new Error('conversation_id is required');
    }
    if (!body.original_draft || body.original_draft.trim().length === 0) {
      throw new Error('original_draft is required and cannot be empty');
    }
    if (!body.edited_draft || body.edited_draft.trim().length === 0) {
      throw new Error('edited_draft is required and cannot be empty');
    }

    // Check if drafts are identical (no learning needed)
    if (body.original_draft.trim() === body.edited_draft.trim()) {
      console.log(`[${functionName}] No changes detected, skipping learning`);
      return new Response(
        JSON.stringify({
          success: true,
          learnings: [],
          analysis: 'No changes detected between original and edited draft',
          function: functionName,
          duration_ms: Date.now() - startTime
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify workspace exists (using service role, so no RLS issues)
    currentStep = 'verifying_workspace';
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('id, name')
      .eq('id', body.workspace_id)
      .maybeSingle();

    if (workspaceError) {
      console.error(`[${functionName}] Workspace query error:`, workspaceError);
      throw new Error(`Workspace query failed: ${workspaceError.message}`);
    }
    
    // If workspace not found, create a minimal check - the workspace might just not have all fields
    if (!workspace) {
      console.log(`[${functionName}] Workspace ${body.workspace_id} not found, but continuing with correction storage`);
    }

    // Get current voice profile for context
    currentStep = 'fetching_voice_profile';
    const { data: voiceProfile } = await supabase
      .from('voice_profiles')
      .select('tone, greeting_style, signoff_style, common_phrases, learnings')
      .eq('workspace_id', body.workspace_id)
      .single();

    // Analyze differences with AI
    currentStep = 'analyzing_with_ai';
    const analysisPrompt = buildAnalysisPrompt(
      body.original_draft,
      body.edited_draft,
      voiceProfile
    );

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: analysisPrompt }],
        max_tokens: 1000
      })
    });

    if (!aiResponse.ok) {
      const errorBody = await aiResponse.text();
      throw new Error(`AI Gateway error ${aiResponse.status}: ${errorBody}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content;

    if (!aiContent) {
      throw new Error('AI returned empty response');
    }

    // Parse AI response
    currentStep = 'parsing_ai_response';
    const { learnings, analysis } = parseAIResponse(aiContent);
    console.log(`[${functionName}] Extracted ${learnings.length} learnings`);

    // Store correction example
    currentStep = 'storing_correction';
    const { error: insertError } = await supabase
      .from('correction_examples')
      .insert({
        workspace_id: body.workspace_id,
        conversation_id: body.conversation_id,
        original_draft: body.original_draft,
        edited_draft: body.edited_draft,
        learnings: learnings,
        analysis: analysis
      });

    if (insertError) {
      console.error(`[${functionName}] Failed to store correction:`, insertError);
      // Continue anyway - we can still update voice profile
    }

    // Update voice profile with new learnings
    currentStep = 'updating_voice_profile';
    if (learnings.length > 0) {
      await updateVoiceProfile(supabase, body.workspace_id, learnings, functionName);
    }

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms:`, {
      learnings_count: learnings.length,
      learnings: learnings
    });

    const result: LearningResult = {
      success: true,
      learnings: learnings,
      analysis: analysis,
      function: functionName,
      duration_ms: duration
    };

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[${functionName}] Error at step \"${currentStep}\":`, error);

    const result: LearningResult = {
      success: false,
      learnings: [],
      error: error.message,
      function: functionName,
      step: currentStep,
      duration_ms: duration
    };

    return new Response(
      JSON.stringify(result),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function buildAnalysisPrompt(
  original: string,
  edited: string,
  voiceProfile: any
): string {
  const profileContext = voiceProfile
    ? `Current voice profile:
- Tone: ${voiceProfile.tone || 'not set'}
- Greeting style: ${voiceProfile.greeting_style || 'not set'}
- Sign-off style: ${voiceProfile.signoff_style || 'not set'}
- Common phrases: ${(voiceProfile.common_phrases || []).join(', ') || 'none'}
- Previous learnings: ${(voiceProfile.learnings || []).slice(-5).join('; ') || 'none'}`
    : 'No voice profile available yet.';

  return `Analyze how a user corrected an AI-generated email draft. Extract specific, actionable learnings to improve future drafts.

${profileContext}

ORIGINAL AI DRAFT:
"""
${original}
"""

USER'S EDITED VERSION:
"""
${edited}
"""

Analyze the changes and extract learnings. Focus on:
1. Tone adjustments (more/less formal, friendly, direct)
2. Phrase preferences (words added, removed, or substituted)
3. Structure changes (paragraph organization, length)
4. Greeting/sign-off modifications
5. Content additions or removals
6. Style preferences (punctuation, capitalization, emoji use)

Respond in this exact JSON format:
{
  "analysis": "Brief 2-3 sentence summary of what changed and why",
  "learnings": [
    "Specific learning 1 (e.g., 'Prefer \\"Hi\\" over \\"Hello\\" in greetings')",
    "Specific learning 2 (e.g., 'Keep paragraphs under 3 sentences')",
    "Specific learning 3 (e.g., 'Always include specific next steps')"
  ]
}

Rules for learnings:
- Each learning must be specific and actionable
- Maximum 5 learnings per correction
- Skip trivial changes (typo fixes, minor rewording)
- Focus on patterns that should apply to future emails
- If changes are minimal or unclear, return empty learnings array`;
}

function parseAIResponse(content: string): { learnings: string[]; analysis: string } {
  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('[learn-correction] No JSON found in AI response, using raw content');
      return { learnings: [], analysis: content };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const learnings = Array.isArray(parsed.learnings)
      ? parsed.learnings.filter((l: any) => typeof l === 'string' && l.length > 0)
      : [];
    const analysis = typeof parsed.analysis === 'string' ? parsed.analysis : '';

    return { learnings, analysis };
  } catch (e) {
    console.error('[learn-correction] Failed to parse AI response:', e);
    return { learnings: [], analysis: content };
  }
}

async function updateVoiceProfile(
  supabase: any,
  workspaceId: string,
  newLearnings: string[],
  functionName: string
): Promise<void> {
  // Get current learnings
  const { data: profile } = await supabase
    .from('voice_profiles')
    .select('learnings, examples_count')
    .eq('workspace_id', workspaceId)
    .single();

  const currentLearnings: string[] = profile?.learnings || [];
  const currentCount = profile?.examples_count || 0;

  // Merge learnings, keeping most recent 50
  const mergedLearnings = [...currentLearnings, ...newLearnings].slice(-50);

  // Upsert voice profile
  const { error } = await supabase
    .from('voice_profiles')
    .upsert({
      workspace_id: workspaceId,
      learnings: mergedLearnings,
      examples_count: currentCount + 1,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'workspace_id'
    });

  if (error) {
    console.error(`[${functionName}] Failed to update voice profile:`, error);
    throw new Error(`Failed to update voice profile: ${error.message}`);
  }

  console.log(`[${functionName}] Updated voice profile with ${newLearnings.length} new learnings`);
}
