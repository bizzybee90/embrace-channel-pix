import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EmailPair {
  incoming_subject: string;
  incoming_body: string;
  reply_body: string;
}

interface VoiceProfile {
  tone: string;
  greeting_style: string;
  signoff_style: string;
  common_phrases: string[];
  average_length: number;
  examples: EmailPair[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'voice-learn';
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

    // Step 1: Get SENT emails
    currentStep = 'fetching_sent_emails';
    const { data: sentEmails, error: sentError } = await supabase
      .from('raw_emails')
      .select('id, thread_id, subject, body_text, received_at')
      .eq('workspace_id', workspace_id)
      .eq('folder', 'SENT')
      .not('body_text', 'is', null)
      .order('received_at', { ascending: false })
      .limit(200);

    if (sentError) {
      throw new Error(`Failed to fetch sent emails: ${sentError.message}`);
    }

    if (!sentEmails || sentEmails.length === 0) {
      console.log(`[${functionName}] No sent emails found for workspace`);
      return new Response(
        JSON.stringify({
          success: true,
          emails_analyzed: 0,
          pairs_found: 0,
          message: 'No sent emails found to analyze'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[${functionName}] Found ${sentEmails.length} sent emails`);

    // Step 2: Get matching INBOX emails by thread_id to form pairs
    currentStep = 'finding_email_pairs';
    const threadIds = [...new Set(sentEmails.map(e => e.thread_id).filter(Boolean))];
    
    let inboxEmails: any[] = [];
    if (threadIds.length > 0) {
      const { data: inbox, error: inboxError } = await supabase
        .from('raw_emails')
        .select('id, thread_id, subject, body_text, received_at')
        .eq('workspace_id', workspace_id)
        .eq('folder', 'INBOX')
        .in('thread_id', threadIds)
        .not('body_text', 'is', null);

      if (inboxError) {
        throw new Error(`Failed to fetch inbox emails: ${inboxError.message}`);
      }
      inboxEmails = inbox || [];
    }

    console.log(`[${functionName}] Found ${inboxEmails.length} matching inbox emails`);

    // Step 3: Create email pairs (incoming → reply)
    currentStep = 'creating_pairs';
    const inboxByThread = new Map<string, any[]>();
    for (const email of inboxEmails) {
      if (!email.thread_id) continue;
      if (!inboxByThread.has(email.thread_id)) {
        inboxByThread.set(email.thread_id, []);
      }
      inboxByThread.get(email.thread_id)!.push(email);
    }

    const emailPairs: EmailPair[] = [];
    for (const sent of sentEmails) {
      if (!sent.thread_id) continue;
      const threadInbox = inboxByThread.get(sent.thread_id);
      if (!threadInbox || threadInbox.length === 0) continue;

      // Find the most recent inbox email before this sent email
      const sentTime = new Date(sent.received_at).getTime();
      const priorInbox = threadInbox
        .filter(inbox => new Date(inbox.received_at).getTime() < sentTime)
        .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())[0];

      if (priorInbox) {
        emailPairs.push({
          incoming_subject: priorInbox.subject || '',
          incoming_body: truncateText(priorInbox.body_text, 1000),
          reply_body: truncateText(sent.body_text, 1000)
        });
      }
    }

    console.log(`[${functionName}] Created ${emailPairs.length} email pairs`);

    // If no pairs found, analyze sent emails alone
    const samplesToAnalyze = emailPairs.length > 0 
      ? emailPairs.slice(0, 20)
      : sentEmails.slice(0, 20).map(e => ({
          incoming_subject: '',
          incoming_body: '',
          reply_body: truncateText(e.body_text, 1000)
        }));

    if (samplesToAnalyze.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          emails_analyzed: 0,
          pairs_found: 0,
          message: 'No suitable emails found for voice analysis'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 4: Analyze with AI
    currentStep = 'analyzing_with_ai';
    const prompt = buildAnalysisPrompt(samplesToAnalyze);

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
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

    console.log(`[${functionName}] AI analysis complete`);

    // Step 5: Parse AI response
    currentStep = 'parsing_ai_response';
    const voiceProfile = parseVoiceProfile(aiContent, samplesToAnalyze.slice(0, 5));

    // Step 6: Save voice profile (adapted to existing schema)
    currentStep = 'saving_voice_profile';
    const { error: upsertError } = await supabase
      .from('voice_profiles')
      .upsert({
        workspace_id,
        greeting_patterns: [voiceProfile.greeting_style],
        signoff_patterns: [voiceProfile.signoff_style],
        common_phrases: voiceProfile.common_phrases,
        tone_descriptors: [voiceProfile.tone],
        avg_response_length: voiceProfile.average_length,
        sample_responses: voiceProfile.examples.map(e => e.reply_body),
        analysis_status: 'completed',
        emails_analyzed: samplesToAnalyze.length,
        last_analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'workspace_id'
      });

    if (upsertError) {
      throw new Error(`Failed to save voice profile: ${upsertError.message}`);
    }

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms:`, {
      emails_analyzed: samplesToAnalyze.length,
      pairs_found: emailPairs.length,
      tone: voiceProfile.tone
    });

    return new Response(
      JSON.stringify({
        success: true,
        emails_analyzed: samplesToAnalyze.length,
        pairs_found: emailPairs.length,
        profile: {
          tone: voiceProfile.tone,
          greeting_style: voiceProfile.greeting_style,
          signoff_style: voiceProfile.signoff_style,
          common_phrases: voiceProfile.common_phrases,
          average_length: voiceProfile.average_length
        },
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[${functionName}] Error at step "${currentStep}":`, error);

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

function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function buildAnalysisPrompt(pairs: EmailPair[]): string {
  const pairsText = pairs.map((pair, i) => {
    if (pair.incoming_body) {
      return `--- Email Pair ${i + 1} ---
INCOMING EMAIL:
Subject: ${pair.incoming_subject}
Body: ${pair.incoming_body}

USER'S REPLY:
${pair.reply_body}`;
    } else {
      return `--- Sent Email ${i + 1} ---
${pair.reply_body}`;
    }
  }).join('\n\n');

  return `Analyze these emails written by a business owner to learn their unique writing style.

${pairsText}

Based on these emails, provide a JSON analysis of their writing style:

{
  "tone": "One word: formal, casual, friendly, professional, warm, or direct",
  "greeting_style": "How they typically start emails (exact phrases they use)",
  "signoff_style": "How they typically end emails (exact phrases they use)",
  "common_phrases": ["Array of 3-5 phrases or expressions they commonly use"],
  "average_length": "Estimated average word count of their replies as a number",
  "style_notes": "2-3 sentences describing unique aspects of their voice"
}

Return ONLY the JSON object, no other text.`;
}

function parseVoiceProfile(aiContent: string, examples: EmailPair[]): VoiceProfile {
  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = aiContent.trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(jsonStr);
    
    return {
      tone: parsed.tone || 'professional',
      greeting_style: parsed.greeting_style || 'Hi,',
      signoff_style: parsed.signoff_style || 'Best regards,',
      common_phrases: Array.isArray(parsed.common_phrases) ? parsed.common_phrases.slice(0, 10) : [],
      average_length: typeof parsed.average_length === 'number' ? parsed.average_length : 100,
      examples: examples
    };
  } catch (parseError) {
    console.error('Failed to parse AI response as JSON, using defaults:', parseError);
    
    // Return sensible defaults
    return {
      tone: 'professional',
      greeting_style: 'Hi,',
      signoff_style: 'Best regards,',
      common_phrases: [],
      average_length: 100,
      examples: examples
    };
  }
}
