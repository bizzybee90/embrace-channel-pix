import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'test-conversation';

  try {
    // Auth validation
    const { validateAuth, AuthError, authErrorResponse } = await import('../_shared/auth.ts');
    let bodyRaw: any;
    try {
      bodyRaw = await req.clone().json();
    } catch { bodyRaw = {}; }
    try {
      await validateAuth(req, bodyRaw.workspace_id);
    } catch (authErr: any) {
      if (authErr instanceof AuthError) return authErrorResponse(authErr);
      throw authErr;
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    const body = bodyRaw;
    console.log(`[${functionName}] Starting:`, { workspace_id: body.workspace_id });

    if (!body.workspace_id) throw new Error('workspace_id is required');

    // Get voice profile
    const { data: voiceProfile } = await supabase
      .from('voice_profiles')
      .select('*')
      .eq('workspace_id', body.workspace_id)
      .single();

    if (!voiceProfile?.psychological_profile) {
      throw new Error('Voice profile not found. Please complete voice learning first.');
    }

    // Get business profile
    const { data: businessProfile } = await supabase
      .from('business_profile')
      .select('*')
      .eq('workspace_id', body.workspace_id)
      .single();

    // Get some FAQs for context
    const { data: faqs } = await supabase
      .from('faqs')
      .select('question, answer')
      .eq('workspace_id', body.workspace_id)
      .order('priority', { ascending: false })
      .limit(15);

    // Sample customer inquiry
    const testInquiry = body.test_message || 
      "Hi, I'm looking for someone to clean the windows on my 3-bedroom house. How much would that cost and when could you fit me in?";

    const profile = voiceProfile.psychological_profile;

    const systemPrompt = `You are writing an email response AS ${businessProfile?.business_name || 'this business owner'}.

CRITICAL: You must write EXACTLY like this person. Here is their communication style:

${profile.summary || 'Professional and friendly communication style.'}

TONE:
- Overall: ${profile.tone?.overall || 'professional'}
- Warmth: ${profile.tone?.warmth || 5}/10
- Directness: ${profile.tone?.directness || 5}/10  
- Formality: ${profile.tone?.formality || 5}/10

GREETING: Always start with "${profile.greetings?.primary || 'Hi,'}"
SIGN-OFF: Always end with "${profile.signoffs?.primary || 'Thanks,'}" then "${profile.signoffs?.name_format || 'The Team'}"

COMMON PHRASES TO USE: ${(profile.vocabulary?.common_phrases || []).join(', ') || 'None specified'}

SENTENCE STRUCTURE:
- Length: ${profile.structure?.avg_sentence_length || 'medium'}
- Paragraphs: ${profile.structure?.avg_paragraph_length || '2-3 sentences'}
- Bullet points: ${profile.structure?.uses_bullet_points ? 'Yes' : 'No'}

VOCABULARY:
- Spelling: ${profile.vocabulary?.spelling || 'British'}
- Contractions: ${profile.vocabulary?.contractions ? 'Yes' : 'No'}
- Emojis: ${profile.vocabulary?.emoji_usage || 'never'}
- Exclamation marks: ${profile.vocabulary?.exclamation_frequency || 'occasional'}

RESPONSE PATTERNS:
- Pricing: ${profile.patterns?.pricing_style || 'Provide general guidance'}
- Complaints: ${profile.patterns?.complaint_handling || 'Be helpful and apologetic'}
- Bookings: ${profile.patterns?.booking_confirmation || 'Confirm details'}

THINGS TO NEVER DO:
${(profile.never_do || []).map((n: string) => `- ${n}`).join('\n') || '- Be overly formal or robotic'}

BUSINESS INFO:
${businessProfile ? `
- Business: ${businessProfile.business_name}
- Services: ${JSON.stringify(businessProfile.services || [])}
- Area: ${businessProfile.service_area || businessProfile.formatted_address || 'Not specified'}
- Phone: ${businessProfile.phone || 'Not provided'}
` : 'Use general helpful responses'}

FAQS FOR REFERENCE (use to inform your answer):
${(faqs || []).map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n') || 'No FAQs available yet.'}

INSTRUCTIONS:
1. Write a response to the customer inquiry below
2. Match the voice profile EXACTLY - this is the most important thing
3. Use information from FAQs if relevant
4. Keep it concise and natural
5. Do not be overly formal or robotic
6. Sound like a real person, not an AI`;

    console.log(`[${functionName}] Calling Claude API...`);

    const claudeResponse = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          { role: 'user', content: `Customer inquiry:\n\n${testInquiry}` }
        ]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error(`[${functionName}] Claude API error:`, errorText);
      throw new Error(`Claude API error: ${claudeResponse.status}`);
    }

    const claudeData = await claudeResponse.json();
    const draft = claudeData.content?.[0]?.text || '';

    if (!draft) {
      throw new Error('Claude returned empty response');
    }

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms, draft length: ${draft.length}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        inquiry: testInquiry,
        draft,
        voice_summary: profile.summary || 'Voice profile loaded',
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[${functionName}] Error:`, error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        function: functionName,
        duration_ms: Date.now() - startTime
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
