import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'voice-learn';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY');
    if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');

    const body = await req.json();
    console.log(`[${functionName}] Starting:`, { workspace_id: body.workspace_id });

    if (!body.workspace_id) throw new Error('workspace_id is required');

    // Get ALL sent emails (Gemini can handle massive context)
    const { data: emails, error: emailError } = await supabase
      .from('raw_emails')
      .select('from_name, to_email, to_name, subject, body_text, received_at')
      .eq('workspace_id', body.workspace_id)
      .eq('email_type', 'outbound')
      .order('received_at', { ascending: false })
      .limit(500);  // Gemini can handle this easily

    if (emailError) throw emailError;

    if (!emails || emails.length < 10) {
      throw new Error(`Need at least 10 sent emails for voice analysis. Found: ${emails?.length || 0}`);
    }

    console.log(`[${functionName}] Analyzing ${emails.length} sent emails`);

    // Format emails for Gemini
    const emailsText = emails.map((e: any, i: number) => 
      `--- EMAIL ${i + 1} ---
To: ${e.to_name || e.to_email}
Subject: ${e.subject}
Date: ${e.received_at}
Body:
${e.body_text || '[No text content]'}
`
    ).join('\n\n');

    const prompt = `You are a communication style analyst. Analyze these ${emails.length} sent emails from a business owner and create a comprehensive psychological style profile.

${emailsText}

Create a detailed profile that captures EXACTLY how this person writes. Focus on:

1. **TONE & PERSONALITY**
   - Overall tone (formal/casual/friendly/professional)
   - Warmth level (1-10)
   - Directness level (1-10)
   - Personality traits that come through

2. **GREETINGS**
   - Exact greeting phrases used (e.g., "Hi there,", "Hello,", "Hey")
   - When they use different greetings (new vs returning customers)
   - Frequency of each greeting style

3. **SIGN-OFFS**
   - Exact sign-off phrases (e.g., "Cheers,", "Best,", "Thanks,")
   - Their name format (first name only, full name, etc.)
   - When they use different sign-offs

4. **SENTENCE STRUCTURE**
   - Average sentence length
   - Use of short punchy sentences vs longer explanations
   - Paragraph length preferences
   - Use of bullet points or lists

5. **VOCABULARY & QUIRKS**
   - Repeated phrases they use
   - Industry jargon they use or avoid
   - British vs American spelling
   - Use of contractions (don't vs do not)
   - Emoji usage (never/sometimes/often)
   - Exclamation mark frequency

6. **RESPONSE PATTERNS**
   - How they handle pricing questions
   - How they handle complaints
   - How they confirm bookings
   - How they follow up
   - What they NEVER do

7. **THINGS TO AVOID**
   - Phrases they never use
   - Styles that would feel "off" for them

Respond with ONLY a JSON object:
{
  "summary": "One paragraph summary of their communication style",
  "tone": {
    "overall": "friendly professional",
    "warmth": 7,
    "directness": 8,
    "formality": 5
  },
  "greetings": {
    "primary": "Hi there,",
    "alternatives": ["Hello,", "Hi"],
    "for_new_customers": "Hi there,",
    "for_returning": "Hi [name],"
  },
  "signoffs": {
    "primary": "Cheers,",
    "alternatives": ["Thanks,", "Best,"],
    "name_format": "John"
  },
  "structure": {
    "avg_sentence_length": "medium",
    "avg_paragraph_length": "2-3 sentences",
    "uses_bullet_points": false,
    "response_length": "concise"
  },
  "vocabulary": {
    "common_phrases": ["happy to help", "no problem at all", "just to confirm"],
    "contractions": true,
    "spelling": "British",
    "emoji_usage": "never",
    "exclamation_frequency": "occasional"
  },
  "patterns": {
    "pricing_style": "Direct and clear, e.g., 'That would be £X for...'",
    "complaint_handling": "Apologetic but solution-focused",
    "booking_confirmation": "Always confirms date, time, and price",
    "follow_up_style": "Friendly check-in after service"
  },
  "never_do": [
    "Use corporate jargon",
    "Start with 'I hope this email finds you well'",
    "Use multiple exclamation marks"
  ],
  "example_responses": {
    "pricing_inquiry": "Example of how they respond to price questions",
    "booking_request": "Example of how they confirm bookings",
    "complaint": "Example of how they handle complaints"
  }
}`;

    const geminiResponse = await fetch(`${GEMINI_API}?key=${GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8192
        }
      })
    });

    if (!geminiResponse.ok) {
      throw new Error(`Gemini API error: ${await geminiResponse.text()}`);
    }

    const geminiData = await geminiResponse.json();
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse the profile
    let profile;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      profile = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Parse error:', responseText.substring(0, 1000));
      throw new Error('Failed to parse voice profile');
    }

    // Save to voice_profiles
    await supabase
      .from('voice_profiles')
      .upsert({
        workspace_id: body.workspace_id,
        tone: profile.tone?.overall,
        greeting_style: profile.greetings?.primary,
        signoff_style: profile.signoffs?.primary,
        greeting_patterns: profile.greetings,
        signoff_patterns: profile.signoffs,
        common_phrases: profile.vocabulary?.common_phrases || [],
        formality_score: Math.round((profile.tone?.formality || 5) * 10),
        warmth_level: profile.tone?.warmth || 5,
        directness_level: profile.tone?.directness || 5,
        uses_emojis: profile.vocabulary?.emoji_usage !== 'never',
        uses_exclamations: profile.vocabulary?.exclamation_frequency !== 'never',
        avoided_words: profile.never_do || [],
        response_patterns: profile.patterns || {},
        psychological_profile: profile,  // Store full profile
        emails_analyzed: emails.length,
        style_confidence: 0.9,
        analysis_status: 'complete',
        last_analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'workspace_id' });

    // Update email provider config
    await supabase
      .from('email_provider_configs')
      .update({
        voice_profile_status: 'complete',
        updated_at: new Date().toISOString()
      })
      .eq('workspace_id', body.workspace_id);

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        profile_summary: profile.summary,
        emails_analyzed: emails.length,
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
