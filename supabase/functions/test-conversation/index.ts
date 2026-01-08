import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VoiceProfile {
  tone: string;
  greeting_style: string;
  signoff_style: string;
  common_phrases: string[];
  average_length: number;
}

interface FAQ {
  question: string;
  answer: string;
  category: string;
}

interface SampleEmail {
  from: string;
  subject: string;
  body: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'test-conversation';
  let currentStep = 'initializing';

  try {
    // Validate environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!supabaseUrl) throw new Error('SUPABASE_URL environment variable not configured');
    if (!supabaseKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable not configured');
    if (!lovableApiKey) throw new Error('LOVABLE_API_KEY environment variable not configured');

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse and validate input
    currentStep = 'validating_input';
    const body = await req.json();
    
    if (!body.workspace_id) {
      throw new Error('workspace_id is required');
    }

    const { workspace_id } = body;
    console.log(`[${functionName}] Starting:`, { workspace_id });

    // Get workspace details
    currentStep = 'fetching_workspace';
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('name')
      .eq('id', workspace_id)
      .single();

    if (workspaceError) {
      throw new Error(`Failed to fetch workspace: ${workspaceError.message}`);
    }

    const businessName = workspace?.name || 'Your Business';
    console.log(`[${functionName}] Workspace: ${businessName}`);

    // Get voice profile
    currentStep = 'fetching_voice_profile';
    const { data: voiceProfile, error: voiceError } = await supabase
      .from('voice_profiles')
      .select('tone, greeting_style, signoff_style, common_phrases, average_length')
      .eq('workspace_id', workspace_id)
      .single();

    if (voiceError && voiceError.code !== 'PGRST116') {
      throw new Error(`Failed to fetch voice profile: ${voiceError.message}`);
    }

    // Use defaults if no voice profile exists
    const voice: VoiceProfile = voiceProfile || {
      tone: 'friendly and professional',
      greeting_style: 'Hi there,',
      signoff_style: 'Best regards',
      common_phrases: [],
      average_length: 100
    };

    console.log(`[${functionName}] Voice profile loaded:`, { 
      tone: voice.tone, 
      hasProfile: !!voiceProfile 
    });

    // Get sample FAQs for context
    currentStep = 'fetching_faqs';
    const { data: faqs, error: faqError } = await supabase
      .from('faqs')
      .select('question, answer, category')
      .eq('workspace_id', workspace_id)
      .limit(5);

    if (faqError && faqError.code !== 'PGRST116') {
      throw new Error(`Failed to fetch FAQs: ${faqError.message}`);
    }

    const faqList: FAQ[] = faqs || [];
    console.log(`[${functionName}] FAQs loaded: ${faqList.length}`);

    // Build context for AI
    const faqContext = faqList.length > 0
      ? faqList.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')
      : 'No FAQs available yet.';

    // Generate sample incoming email with AI
    currentStep = 'generating_sample_email';
    const sampleEmailPrompt = `You are generating a realistic customer inquiry email for a UK service business called "${businessName}".

Generate a typical customer email asking about services, pricing, or availability. Make it:
- Realistic and natural (like a real customer would write)
- Appropriate length (3-5 sentences)
- Include a specific question or request
- Use British English spelling

${faqList.length > 0 ? `The business has these FAQs that might guide what customers ask about:\n${faqContext}` : ''}

Respond ONLY with valid JSON in this exact format:
{
  "from": "Customer Name",
  "subject": "Email subject line",
  "body": "The email body text"
}`;

    const sampleEmailResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: sampleEmailPrompt }]
      })
    });

    if (!sampleEmailResponse.ok) {
      const errorText = await sampleEmailResponse.text();
      throw new Error(`AI Gateway error generating sample email (${sampleEmailResponse.status}): ${errorText}`);
    }

    const sampleEmailData = await sampleEmailResponse.json();
    const sampleEmailContent = sampleEmailData.choices?.[0]?.message?.content;

    if (!sampleEmailContent) {
      throw new Error('AI Gateway returned empty response for sample email');
    }

    let sampleEmail: SampleEmail;
    try {
      // Clean potential markdown code blocks
      const cleanedContent = sampleEmailContent
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      sampleEmail = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.error(`[${functionName}] Failed to parse sample email:`, sampleEmailContent);
      throw new Error('Failed to parse AI-generated sample email');
    }

    if (!sampleEmail.from || !sampleEmail.subject || !sampleEmail.body) {
      throw new Error('AI-generated sample email missing required fields');
    }

    console.log(`[${functionName}] Sample email generated:`, { subject: sampleEmail.subject });

    // Generate AI reply using voice profile
    currentStep = 'generating_ai_reply';
    const replyPrompt = `You are writing an email reply for "${businessName}", a UK service business.

VOICE PROFILE:
- Tone: ${voice.tone}
- Greeting style: ${voice.greeting_style}
- Sign-off style: ${voice.signoff_style}
- Common phrases they use: ${voice.common_phrases?.length > 0 ? voice.common_phrases.join(', ') : 'None specified'}
- Typical response length: approximately ${voice.average_length} words

CUSTOMER EMAIL:
From: ${sampleEmail.from}
Subject: ${sampleEmail.subject}

${sampleEmail.body}

${faqList.length > 0 ? `RELEVANT KNOWLEDGE BASE:\n${faqContext}` : ''}

Write a reply that:
1. Matches the voice profile EXACTLY (tone, greeting, sign-off)
2. Addresses the customer's question helpfully
3. Uses British English spelling
4. Is approximately ${voice.average_length} words
5. Sounds natural and human, not robotic

Respond with ONLY the email body text (no subject line, no JSON, just the reply text).`;

    const replyResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: replyPrompt }]
      })
    });

    if (!replyResponse.ok) {
      const errorText = await replyResponse.text();
      throw new Error(`AI Gateway error generating reply (${replyResponse.status}): ${errorText}`);
    }

    const replyData = await replyResponse.json();
    const aiReply = replyData.choices?.[0]?.message?.content?.trim();

    if (!aiReply) {
      throw new Error('AI Gateway returned empty response for reply');
    }

    console.log(`[${functionName}] AI reply generated:`, { 
      length: aiReply.length,
      wordCount: aiReply.split(/\s+/).length
    });

    // Calculate confidence score based on available data
    currentStep = 'calculating_confidence';
    let confidence = 0.5; // Base confidence

    // Boost confidence based on available context
    if (voiceProfile) confidence += 0.2; // Has learned voice
    if (faqList.length > 0) confidence += 0.1; // Has knowledge base
    if (faqList.length >= 3) confidence += 0.1; // Has substantial knowledge base
    if (voice.common_phrases?.length > 0) confidence += 0.1; // Has learned phrases

    // Cap at 0.95 (never claim 100% confidence)
    confidence = Math.min(confidence, 0.95);

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms:`, {
      hasVoiceProfile: !!voiceProfile,
      faqCount: faqList.length,
      confidence: confidence.toFixed(2)
    });

    return new Response(
      JSON.stringify({
        success: true,
        sample_email: {
          from: sampleEmail.from,
          subject: sampleEmail.subject,
          body: sampleEmail.body
        },
        ai_reply: aiReply,
        confidence: parseFloat(confidence.toFixed(2)),
        context: {
          has_voice_profile: !!voiceProfile,
          faq_count: faqList.length,
          business_name: businessName
        },
        duration_ms: duration
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[${functionName}] Error at step '${currentStep}':`, error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: functionName,
        step: currentStep,
        duration_ms: duration
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
