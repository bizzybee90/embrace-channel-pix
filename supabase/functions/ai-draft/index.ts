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
  similarity?: number;
  source?: string;
  priority?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'ai-draft';
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
      throw new Error(`Conversation ${conversation_id} not found in workspace ${workspace_id}`);
    }

    const customer = Array.isArray(conversation.customer) ? conversation.customer[0] : conversation.customer;

    console.log(`[${functionName}] Fetched conversation:`, { 
      title: conversation.title,
      customer_email: customer?.email
    });

    // Step 2: Get all messages in thread
    currentStep = 'fetching_messages';
    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select('id, body, direction, from_email, created_at')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: true });

    if (msgError) {
      throw new Error(`Failed to fetch messages: ${msgError.message}`);
    }
    if (!messages || messages.length === 0) {
      throw new Error('No messages found in conversation');
    }

    console.log(`[${functionName}] Fetched ${messages.length} messages`);

    // Step 3: Get voice profile
    currentStep = 'fetching_voice_profile';
    const { data: voiceProfile, error: voiceError } = await supabase
      .from('voice_profiles')
      .select('tone, greeting_style, signoff_style, common_phrases, average_length')
      .eq('workspace_id', workspace_id)
      .single();

    if (voiceError && voiceError.code !== 'PGRST116') {
      throw new Error(`Failed to fetch voice profile: ${voiceError.message}`);
    }

    const hasVoiceProfile = !!voiceProfile;
    console.log(`[${functionName}] Voice profile:`, hasVoiceProfile ? 'found' : 'not found, using defaults');

    // Step 4: Get relevant FAQs using semantic search
    currentStep = 'fetching_faqs';
    const lastInboundMessage = messages
      .filter((m: Message) => m.direction === 'inbound')
      .pop();

    let relevantFaqs: FAQ[] = [];
    let usedSemanticSearch = false;
    
    if (lastInboundMessage) {
      // Generate embedding for the customer's message for semantic search
      let questionEmbedding = null;
      try {
        console.log(`[${functionName}] Generating embedding for semantic FAQ search...`);
        const embeddingResponse = await fetch(
          `${supabaseUrl}/functions/v1/generate-embedding`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`
            },
            body: JSON.stringify({ text: lastInboundMessage.body })
          }
        );

        if (embeddingResponse.ok) {
          const embeddingData = await embeddingResponse.json();
          questionEmbedding = embeddingData.embedding;
          console.log(`[${functionName}] Embedding generated successfully`);
        } else {
          console.log(`[${functionName}] Embedding response not OK: ${embeddingResponse.status}`);
        }
      } catch (e) {
        console.log(`[${functionName}] Embedding generation failed, falling back to standard FAQs: ${e}`);
      }

      // Try semantic search first if we have an embedding
      if (questionEmbedding) {
        // Try match_faqs first (faqs table)
        try {
          const { data: matchedFaqs, error: matchError } = await supabase
            .rpc('match_faqs', {
              query_embedding: questionEmbedding,
              match_workspace_id: workspace_id,
              match_threshold: 0.4,  // Lower threshold for more results
              match_count: 7
            });

          if (!matchError && matchedFaqs?.length > 0) {
            relevantFaqs = matchedFaqs;
            usedSemanticSearch = true;
            const avgSimilarity = (matchedFaqs.reduce((sum: number, f: any) => sum + (f.similarity || 0), 0) / matchedFaqs.length * 100).toFixed(1);
            console.log(`[${functionName}] Found ${matchedFaqs.length} semantically relevant FAQs from faqs table (avg similarity: ${avgSimilarity}%)`);
          } else if (matchError) {
            console.log(`[${functionName}] match_faqs error: ${matchError.message}`);
          }
        } catch (e) {
          console.log(`[${functionName}] match_faqs failed: ${e}`);
        }

        // If no results from faqs, try faq_database table
        if (relevantFaqs.length === 0) {
          try {
            const { data: matchedFaqDb, error: matchDbError } = await supabase
              .rpc('match_faq_database', {
                query_embedding: questionEmbedding,
                match_workspace_id: workspace_id,
                match_threshold: 0.4,
                match_count: 7
              });

            if (!matchDbError && matchedFaqDb?.length > 0) {
              relevantFaqs = matchedFaqDb;
              usedSemanticSearch = true;
              const avgSimilarity = (matchedFaqDb.reduce((sum: number, f: any) => sum + (f.similarity || 0), 0) / matchedFaqDb.length * 100).toFixed(1);
              console.log(`[${functionName}] Found ${matchedFaqDb.length} semantically relevant FAQs from faq_database (avg similarity: ${avgSimilarity}%)`);
            } else if (matchDbError) {
              console.log(`[${functionName}] match_faq_database error: ${matchDbError.message}`);
            }
          } catch (e) {
            console.log(`[${functionName}] match_faq_database failed: ${e}`);
          }
        }
      }

      // Fallback: if no semantic matches, get highest priority FAQs from either table
      if (relevantFaqs.length === 0) {
        // Try faqs table first
        const { data: fallbackFaqs, error: faqError } = await supabase
          .from('faqs')
          .select('question, answer, source, priority')
          .eq('workspace_id', workspace_id)
          .order('priority', { ascending: false })
          .limit(7);

        if (!faqError && fallbackFaqs && fallbackFaqs.length > 0) {
          relevantFaqs = fallbackFaqs;
          console.log(`[${functionName}] Using ${fallbackFaqs.length} priority-based FAQs from faqs table`);
        } else {
          // Try faq_database table
          const { data: fallbackFaqDb } = await supabase
            .from('faq_database')
            .select('question, answer, source, priority')
            .eq('workspace_id', workspace_id)
            .order('priority', { ascending: false })
            .limit(7);

          if (fallbackFaqDb && fallbackFaqDb.length > 0) {
            relevantFaqs = fallbackFaqDb;
            console.log(`[${functionName}] Using ${fallbackFaqDb.length} priority-based FAQs from faq_database`);
          } else {
            console.log(`[${functionName}] No FAQs found in any table`);
          }
        }
      }
    }

    // Step 5: Build the prompt
    currentStep = 'building_prompt';
    const prompt = buildDraftPrompt(
      conversation,
      messages as Message[],
      voiceProfile as VoiceProfile | null,
      relevantFaqs
    );

    // Step 6: Generate draft with AI
    currentStep = 'generating_draft';
    console.log(`[${functionName}] Calling AI Gateway...`);

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`AI Gateway error ${aiResponse.status}: ${errorText}`);
    }

    const aiData = await aiResponse.json();
    
    if (!aiData.choices || !aiData.choices[0] || !aiData.choices[0].message) {
      throw new Error('AI Gateway returned unexpected format');
    }

    const draft = aiData.choices[0].message.content.trim();
    console.log(`[${functionName}] Generated draft (${draft.length} chars)`);

    // Calculate confidence based on available context (semantic search boosts confidence)
    const confidence = calculateConfidence(hasVoiceProfile, relevantFaqs.length, messages.length, usedSemanticSearch);

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms:`, {
      draft_length: draft.length,
      confidence,
      faqs_used: relevantFaqs.length,
      semantic_search: usedSemanticSearch,
      messages_in_thread: messages.length
    });

    return new Response(
      JSON.stringify({
        success: true,
        draft,
        confidence,
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

function buildDraftPrompt(
  conversation: any,
  messages: Message[],
  voiceProfile: VoiceProfile | null,
  faqs: FAQ[]
): string {
  // Format conversation history
  const conversationHistory = messages.map(m => {
    const sender = m.direction === 'inbound' ? 'Customer' : 'Business';
    return `[${sender}]: ${m.body}`;
  }).join('\n\n');

  // Format voice profile section
  let voiceSection: string;
  if (voiceProfile) {
    voiceSection = `
VOICE PROFILE (match this style exactly):
- Tone: ${voiceProfile.tone || 'professional and friendly'}
- Greeting style: ${voiceProfile.greeting_style || 'Hi [Name]'}
- Sign-off style: ${voiceProfile.signoff_style || 'Best regards'}
- Common phrases to use: ${voiceProfile.common_phrases?.join(', ') || 'none specified'}
- Target length: approximately ${voiceProfile.average_length || 100} words`;
  } else {
    voiceSection = `
VOICE PROFILE:
No specific voice profile learned yet. Use a professional, friendly, and helpful tone.
Keep the response concise but complete.`;
  }

  // Format FAQ section with relevance scores if available
  let faqSection = '';
  if (faqs.length > 0) {
    const faqContext = faqs.map(faq => {
      const relevance = faq.similarity 
        ? ` (${Math.round(faq.similarity * 100)}% relevant)` 
        : '';
      return `Q: ${faq.question}${relevance}\nA: ${faq.answer}`;
    }).join('\n\n');
    
    faqSection = `

RELEVANT KNOWLEDGE BASE:
${faqContext}

Use this information if relevant to the customer's question.`;
  }

  // Customer info
  const customer = Array.isArray(conversation.customer) ? conversation.customer[0] : conversation.customer;
  const customerName = customer?.name || 'there';
  const customerEmail = customer?.email || 'unknown';

  return `You are writing an email reply for a UK service business.

CUSTOMER INFORMATION:
- Name: ${customerName}
- Email: ${customerEmail}
- Topic: ${conversation.title || conversation.category || 'General inquiry'}
${voiceSection}

CONVERSATION HISTORY:
${conversationHistory}
${faqSection}

INSTRUCTIONS:
1. Write a helpful, complete reply to the customer's most recent message
2. Match the voice profile style exactly if provided
3. Address their specific question or concern
4. Use information from the knowledge base if relevant
5. Be warm but professional
6. Do NOT include a subject line - just the email body
7. Do NOT use placeholder text like [Your Name] - leave the sign-off incomplete if needed

Write the reply now:`;
}

function calculateConfidence(
  hasVoiceProfile: boolean,
  faqCount: number,
  messageCount: number,
  usedSemanticSearch: boolean = false
): number {
  let confidence = 0.5; // Base confidence

  // Voice profile adds significant confidence
  if (hasVoiceProfile) confidence += 0.2;

  // FAQs add confidence - semantic search FAQs are more valuable
  if (faqCount > 0) {
    const faqBoost = usedSemanticSearch 
      ? Math.min(faqCount * 0.07, 0.20)  // Semantic matches are more relevant
      : Math.min(faqCount * 0.05, 0.15);
    confidence += faqBoost;
  }

  // More context from messages helps
  if (messageCount > 1) confidence += 0.05;
  if (messageCount > 3) confidence += 0.05;

  return Math.min(confidence, 0.95); // Cap at 95%
}
