import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// SIMPLIFIED LEARN FROM INBOX
// Does everything in ONE call:
// 1. Sample 75 outbound emails
// 2. ONE AI call to analyze voice profile
// 3. Save results
// 4. Done in ~15 seconds
// ============================================

const SAMPLE_SIZE = 75;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { workspace_id } = await req.json();
    
    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[LearnFromInbox] Starting simplified learning for workspace:', workspace_id);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 1: Get total counts for display
    const { count: totalConversations } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id);

    const { count: totalOutbound } = await supabase
      .from('messages')
      .select('*, conversations!inner(workspace_id)', { count: 'exact', head: true })
      .eq('direction', 'outbound')
      .eq('actor_type', 'human_agent')
      .eq('conversations.workspace_id', workspace_id);

    console.log(`[LearnFromInbox] Found ${totalConversations} conversations, ${totalOutbound} outbound messages`);

    // Step 2: Sample outbound emails for voice analysis
    const { data: outboundEmails, error: emailError } = await supabase
      .from('messages')
      .select(`
        id, body, created_at,
        conversations!inner (workspace_id, email_classification, led_to_booking)
      `)
      .eq('direction', 'outbound')
      .eq('actor_type', 'human_agent')
      .eq('conversations.workspace_id', workspace_id)
      .not('body', 'is', null)
      .order('created_at', { ascending: false })
      .limit(SAMPLE_SIZE * 2);

    if (emailError) {
      console.error('[LearnFromInbox] Error fetching emails:', emailError);
      throw emailError;
    }

    // Filter to quality emails (not too short, not too long)
    const qualityEmails = (outboundEmails || [])
      .filter(e => e.body && e.body.length > 50 && e.body.length < 5000)
      .slice(0, SAMPLE_SIZE);

    console.log(`[LearnFromInbox] Sampled ${qualityEmails.length} quality outbound emails`);

    if (qualityEmails.length < 5) {
      console.log('[LearnFromInbox] Not enough emails for analysis');
      return new Response(JSON.stringify({
        success: true,
        emailsAnalyzed: qualityEmails.length,
        message: 'Not enough outbound emails for voice analysis',
        profile: null,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 3: Build prompt for voice analysis
    const emailSamples = qualityEmails.map((e, i) => 
      `--- EMAIL ${i + 1} ---\n${e.body.substring(0, 600)}\n`
    ).join('\n');

    const prompt = `Analyze these ${qualityEmails.length} emails from a business owner to learn their communication style.

${emailSamples}

Create a voice profile. Return ONLY valid JSON:

{
  "tone": "friendly" | "professional" | "casual" | "formal",
  "tone_description": "2-3 sentence description of their writing style",
  "greeting_style": "How they typically start emails (e.g., 'Hi [name],' or 'Hello,')",
  "sign_off_style": "How they typically end emails (e.g., 'Cheers, [name]' or 'Thanks')",
  "common_phrases": ["up to 5 phrases", "they use often"],
  "avg_response_length": "brief" | "moderate" | "detailed",
  "uses_emojis": true | false,
  "uses_exclamations": true | false,
  "formality_level": 1-10,
  "how_they_handle_pricing": "How they discuss prices based on examples",
  "how_they_handle_scheduling": "How they arrange appointments",
  "how_they_handle_complaints": "How they respond to issues (if examples exist)",
  "how_they_decline_requests": "How they say no politely (if examples exist)",
  "example_responses": [
    {"scenario": "Confirming appointment", "response": "actual example from their emails"},
    {"scenario": "Responding to price inquiry", "response": "actual example"}
  ],
  "confidence_score": 0.0-1.0
}`;

    // Step 4: ONE AI call using Lovable AI gateway
    console.log('[LearnFromInbox] Making AI call for voice analysis...');
    
    let profile: any = null;
    
    if (LOVABLE_API_KEY) {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: 'You are an expert at analyzing communication styles. Return only valid JSON.' },
            { role: 'user', content: prompt }
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[LearnFromInbox] AI API error:', response.status, errorText);
        throw new Error(`AI API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      // Parse JSON from response
      try {
        let jsonText = content.trim();
        // Handle markdown code blocks
        if (jsonText.includes('```')) {
          jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
        }
        // Find JSON object
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          profile = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error('[LearnFromInbox] Failed to parse AI response:', parseError);
        console.log('[LearnFromInbox] Raw response:', content.substring(0, 500));
      }
    } else {
      console.log('[LearnFromInbox] No LOVABLE_API_KEY, using basic analysis');
      // Basic fallback analysis without AI
      profile = {
        tone: 'professional',
        tone_description: 'Professional communication style based on email samples.',
        greeting_style: 'Hi,',
        sign_off_style: 'Thanks',
        common_phrases: [],
        avg_response_length: 'moderate',
        uses_emojis: false,
        uses_exclamations: false,
        formality_level: 5,
        confidence_score: 0.3,
      };
    }

    // Step 5: Save voice profile
    if (profile) {
      console.log('[LearnFromInbox] Saving voice profile...');
      
      const { error: upsertError } = await supabase
        .from('voice_profiles')
        .upsert({
          workspace_id,
          // Core profile
          tone_descriptors: profile.tone ? [profile.tone] : ['professional'],
          formality_score: (profile.formality_level || 5) * 10,
          
          // Patterns
          greeting_patterns: profile.greeting_style ? [{ text: profile.greeting_style, frequency: 0.8 }] : [],
          signoff_patterns: profile.sign_off_style ? [{ text: profile.sign_off_style, frequency: 0.8 }] : [],
          common_phrases: (profile.common_phrases || []).map((p: string) => ({ phrase: p, frequency: 0.5 })),
          
          // Writing stats
          avg_response_length: profile.avg_response_length === 'brief' ? 30 : 
                               profile.avg_response_length === 'detailed' ? 100 : 50,
          uses_emojis: profile.uses_emojis || false,
          uses_exclamations: profile.uses_exclamations || false,
          
          // Category-specific handling
          response_patterns: {
            pricing: profile.how_they_handle_pricing || null,
            scheduling: profile.how_they_handle_scheduling || null,
            complaints: profile.how_they_handle_complaints || null,
            declining: profile.how_they_decline_requests || null,
          },
          
          // Example responses for few-shot prompting
          example_responses: profile.example_responses || [],
          
          // Metrics
          emails_analyzed: qualityEmails.length,
          style_confidence: profile.confidence_score || 0.7,
          analysis_status: 'complete',
          last_analyzed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id' });

      if (upsertError) {
        console.error('[LearnFromInbox] Error saving profile:', upsertError);
      }
    }

    // Step 6: Quick pattern analysis from conversations
    const { data: categoryData } = await supabase
      .from('conversations')
      .select('email_classification')
      .eq('workspace_id', workspace_id)
      .limit(500);

    const emailsByCategory: Record<string, number> = {};
    for (const conv of categoryData || []) {
      const cat = conv.email_classification || 'uncategorized';
      emailsByCategory[cat] = (emailsByCategory[cat] || 0) + 1;
    }

    const topCategories = Object.entries(emailsByCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    // Save insights
    await supabase
      .from('inbox_insights')
      .upsert({
        workspace_id,
        total_emails_analyzed: totalConversations || 0,
        emails_by_category: emailsByCategory,
        common_inquiry_types: topCategories,
        patterns_learned: qualityEmails.length,
        learning_phases_completed: { 
          voice_profile: true, 
          patterns: true,
          single_call: true 
        },
        analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

    const processingTime = Date.now() - startTime;
    console.log(`[LearnFromInbox] Complete in ${processingTime}ms`);

    return new Response(JSON.stringify({
      success: true,
      emailsAnalyzed: qualityEmails.length,
      totalConversations: totalConversations || 0,
      totalOutbound: totalOutbound || 0,
      topCategories,
      profile: profile ? {
        tone: profile.tone,
        tone_description: profile.tone_description,
        formality_level: profile.formality_level,
      } : null,
      processingTimeMs: processingTime,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[LearnFromInbox] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
