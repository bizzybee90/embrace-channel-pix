import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Message {
  id: string;
  body: string;
  direction: 'inbound' | 'outbound';
  from_email: string;
  created_at: string;
}

interface VoiceDna {
  openers?: Array<{ phrase: string; frequency: number }>;
  closers?: Array<{ phrase: string; frequency: number }>;
  tics?: string[];
  tone_keywords?: string[];
  formatting_rules?: string[];
  avg_response_length?: number;
  emoji_usage?: string;
}

interface ExampleResponse {
  id: string;
  category: string;
  inbound_text: string;
  outbound_text: string;
  similarity: number;
}

interface FAQ {
  question: string;
  answer: string;
  similarity?: number;
  source?: string;
  priority?: number;
}

const OPENAI_API = 'https://api.openai.com/v1/embeddings';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'ai-draft';
  let currentStep = 'initializing';

  try {
    // Auth validation
    const { validateAuth, AuthError, authErrorResponse } = await import('../_shared/auth.ts');
    let body: any;
    try {
      body = await req.clone().json();
    } catch { body = {}; }
    try {
      await validateAuth(req, body.workspace_id);
    } catch (authErr: any) {
      if (authErr instanceof AuthError) return authErrorResponse(authErr);
      throw authErr;
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const openaiKey = Deno.env.get('OPENAI_API_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured');
    }
    if (!anthropicKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse and validate input
    currentStep = 'validating_input';
    const body = await req.json();
    
    if (!body.conversation_id) {
      throw new Error('conversation_id is required');
    }
    if (!body.workspace_id) {
      throw new Error('workspace_id is required');
    }

    const { conversation_id, workspace_id } = body;
    console.log(`[${functionName}] Starting:`, { conversation_id, workspace_id });

    // Step 1: Get conversation with customer
    currentStep = 'fetching_conversation';
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        title,
        category,
        customer:customers(id, name, email)
      `)
      .eq('id', conversation_id)
      .eq('workspace_id', workspace_id)
      .single();

    if (convError) {
      throw new Error(`Failed to fetch conversation: ${convError.message}`);
    }
    if (!conversation) {
      throw new Error(`Conversation ${conversation_id} not found`);
    }

    const customer = Array.isArray(conversation.customer) ? conversation.customer[0] : conversation.customer;

    // Step 2: Get all messages in thread
    currentStep = 'fetching_messages';
    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select('id, body, direction, from_email, created_at')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: true });

    if (msgError || !messages || messages.length === 0) {
      throw new Error('No messages found in conversation');
    }

    const lastInboundMessage = messages.filter((m: Message) => m.direction === 'inbound').pop();
    if (!lastInboundMessage) {
      throw new Error('No inbound message to reply to');
    }

    console.log(`[${functionName}] Found ${messages.length} messages`);

    // Step 3: Get voice profile with new voice_dna and playbook
    currentStep = 'fetching_voice_profile';
    const { data: voiceProfile } = await supabase
      .from('voice_profiles')
      .select('voice_dna, playbook, greeting_style, signoff_style, tone, examples_stored')
      .eq('workspace_id', workspace_id)
      .single();

    const voiceDna: VoiceDna = voiceProfile?.voice_dna || {};
    const hasVoiceProfile = !!voiceProfile && (voiceProfile.voice_dna || voiceProfile.tone);
    console.log(`[${functionName}] Voice profile:`, hasVoiceProfile ? 'found' : 'not found');

    // Step 4: Generate embedding for incoming message and retrieve similar examples
    currentStep = 'generating_embedding';
    let queryEmbedding: number[] | null = null;
    let similarExamples: ExampleResponse[] = [];

    try {
      const embeddingResponse = await fetch(OPENAI_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: lastInboundMessage.body.slice(0, 1000)
        })
      });

      if (embeddingResponse.ok) {
        const embeddingData = await embeddingResponse.json();
        queryEmbedding = embeddingData.data?.[0]?.embedding;
        console.log(`[${functionName}] Embedding generated`);
      }
    } catch (e) {
      console.log(`[${functionName}] Embedding failed:`, e);
    }

    // Step 5: Retrieve similar examples using RAG
    currentStep = 'retrieving_examples';
    if (queryEmbedding && voiceProfile?.examples_stored > 0) {
      try {
        const { data: examples, error: examplesError } = await supabase.rpc('match_examples', {
          query_embedding: queryEmbedding,
          match_workspace: workspace_id,
          match_count: 3
        });

        if (!examplesError && examples?.length > 0) {
          similarExamples = examples;
          console.log(`[${functionName}] Found ${examples.length} similar examples`);
        }
      } catch (e) {
        console.log(`[${functionName}] match_examples failed:`, e);
      }
    }

    // Step 6: Get relevant FAQs
    currentStep = 'fetching_faqs';
    let relevantFaqs: FAQ[] = [];

    if (queryEmbedding) {
      // Try semantic FAQ search
      try {
        const { data: matchedFaqs } = await supabase.rpc('match_faqs', {
          query_embedding: queryEmbedding,
          match_workspace_id: workspace_id,
          match_threshold: 0.4,
          match_count: 5
        });

        if (matchedFaqs?.length > 0) {
          relevantFaqs = matchedFaqs;
        }
      } catch (e) {
        console.log(`[${functionName}] FAQ semantic search failed:`, e);
      }
    }

    // Fallback to priority-based FAQs
    if (relevantFaqs.length === 0) {
      const { data: fallbackFaqs } = await supabase
        .from('faqs')
        .select('question, answer')
        .eq('workspace_id', workspace_id)
        .order('priority', { ascending: false })
        .limit(5);

      if (fallbackFaqs) {
        relevantFaqs = fallbackFaqs;
      }
    }

    // Step 7: Get business profile
    currentStep = 'fetching_business';
    const { data: businessProfile } = await supabase
      .from('business_profile')
      .select('business_name, services, service_area, phone')
      .eq('workspace_id', workspace_id)
      .single();

    // Step 8: Build the RAG-enhanced prompt
    currentStep = 'building_prompt';
    const prompt = buildRagPrompt(
      conversation,
      messages as Message[],
      voiceDna,
      voiceProfile,
      similarExamples,
      relevantFaqs,
      businessProfile,
      customer
    );

    // Step 9: Generate draft with Claude
    currentStep = 'generating_draft';
    console.log(`[${functionName}] Calling Claude API...`);

    const claudeResponse = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      throw new Error(`Claude API error ${claudeResponse.status}: ${errorText}`);
    }

    const claudeData = await claudeResponse.json();
    const draft = claudeData.content?.[0]?.text?.trim() || '';

    if (!draft) {
      throw new Error('Claude returned empty response');
    }

    // Calculate confidence
    const confidence = calculateConfidence(
      hasVoiceProfile,
      similarExamples.length,
      relevantFaqs.length,
      messages.length
    );

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms:`, {
      draft_length: draft.length,
      confidence,
      examples_used: similarExamples.length,
      faqs_used: relevantFaqs.length
    });

    return new Response(
      JSON.stringify({
        success: true,
        draft,
        confidence,
        examples_used: similarExamples.length,
        faqs_used: relevantFaqs.map(f => f.question),
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[${functionName}] Error at step "${currentStep}":`, error.message);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: functionName,
        step: currentStep,
        duration_ms: duration
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function buildRagPrompt(
  conversation: any,
  messages: Message[],
  voiceDna: VoiceDna,
  voiceProfile: any,
  examples: ExampleResponse[],
  faqs: FAQ[],
  businessProfile: any,
  customer: any
): string {
  // Format conversation history (last 5 messages for context)
  const recentMessages = messages.slice(-5);
  const conversationHistory = recentMessages.map(m => {
    const sender = m.direction === 'inbound' ? 'Customer' : 'You';
    return `${sender}: ${m.body}`;
  }).join('\n\n');

  // Build voice DNA section
  let voiceSection = '';
  if (voiceDna && Object.keys(voiceDna).length > 0) {
    voiceSection = `
VOICE DNA (Match this EXACTLY):
- Greetings: ${JSON.stringify(voiceDna.openers || [])}
- Sign-offs: ${JSON.stringify(voiceDna.closers || [])}
- Verbal tics: ${JSON.stringify(voiceDna.tics || [])}
- Tone: ${JSON.stringify(voiceDna.tone_keywords || [])}
- Formatting: ${JSON.stringify(voiceDna.formatting_rules || [])}
- Typical length: ${voiceDna.avg_response_length || 80} words
- Emoji usage: ${voiceDna.emoji_usage || 'rarely'}`;
  } else if (voiceProfile?.greeting_style || voiceProfile?.tone) {
    // Fallback to legacy profile
    voiceSection = `
VOICE PROFILE:
- Greeting: ${voiceProfile.greeting_style || 'Hi'}
- Sign-off: ${voiceProfile.signoff_style || 'Thanks'}
- Tone: ${voiceProfile.tone || 'friendly'}`;
  }

  // Build examples section (most important for RAG!)
  let examplesSection = '';
  if (examples.length > 0) {
    examplesSection = `

REFERENCE EXAMPLES (Mimic these EXACTLY - this is how you actually write):
${examples.map((ex, i) => 
  `EXAMPLE ${i + 1}:
Customer wrote: "${ex.inbound_text?.slice(0, 300)}"
You replied: "${ex.outbound_text?.slice(0, 300)}"`
).join('\n\n')}`;
  }

  // Build FAQ section
  let faqSection = '';
  if (faqs.length > 0) {
    faqSection = `

RELEVANT KNOWLEDGE:
${faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}`;
  }

  // Build business info
  let businessSection = '';
  if (businessProfile) {
    businessSection = `

BUSINESS INFO:
- Name: ${businessProfile.business_name || 'Not specified'}
- Services: ${JSON.stringify(businessProfile.services || [])}
- Area: ${businessProfile.service_area || 'Not specified'}
- Phone: ${businessProfile.phone || 'Not provided'}`;
  }

  const customerName = customer?.name || 'there';

  return `You are drafting an email reply for a UK service business. Your goal is to sound EXACTLY like the business owner.
${voiceSection}
${examplesSection}
${faqSection}
${businessSection}

CONVERSATION:
${conversationHistory}

INSTRUCTIONS:
1. ${examples.length > 0 ? 'Match the tone, length, and structure of the reference examples above' : 'Use a friendly, professional tone'}
2. Use the same greeting and sign-off style shown in voice DNA or examples
3. If the examples show short, direct replies - be short and direct
4. If the examples show warmth - include that warmth
5. Include relevant FAQ information naturally
6. DO NOT sound corporate or formal unless the examples do
7. DO NOT use placeholders like [Name] - use "${customerName}" or generic greetings
8. Keep your response under ${voiceDna?.avg_response_length || 100} words
9. Do NOT include a subject line - just the email body

Write the reply now:`;
}

function calculateConfidence(
  hasVoiceProfile: boolean,
  exampleCount: number,
  faqCount: number,
  messageCount: number
): number {
  let confidence = 0.4; // Base confidence

  // Voice profile adds confidence
  if (hasVoiceProfile) confidence += 0.15;

  // Similar examples are MOST valuable (RAG quality)
  if (exampleCount > 0) {
    confidence += Math.min(exampleCount * 0.12, 0.30); // Up to 30% boost
  }

  // FAQs help with accuracy
  if (faqCount > 0) {
    confidence += Math.min(faqCount * 0.04, 0.12);
  }

  // More context from messages
  if (messageCount > 1) confidence += 0.03;
  if (messageCount > 3) confidence += 0.03;

  return Math.min(confidence, 0.95);
}
