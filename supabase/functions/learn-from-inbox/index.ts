import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// LEARN FROM INBOX
// Comprehensive email learning during onboarding:
// 1. Categorize ALL emails (no limit)
// 2. Build voice profile from outbound messages
// 3. Analyze email patterns
// 4. Extract response patterns
// ============================================

interface LearningProgress {
  phase: 'categorizing' | 'voice_profile' | 'patterns' | 'responses' | 'complete';
  current: number;
  total: number;
  message: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { workspace_id, phase } = await req.json();
    
    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[LearnFromInbox] Starting phase:', phase, 'for workspace:', workspace_id);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Phase 1: Get total counts for progress tracking
    if (phase === 'init') {
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

      return new Response(JSON.stringify({
        success: true,
        phase: 'init',
        totals: {
          conversations: totalConversations || 0,
          outbound: totalOutbound || 0,
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Phase 2: Categorize emails in batches (no 500 limit!)
    if (phase === 'categorize') {
      const batchSize = 100;
      const offset = 0;
      let processed = 0;
      let categorized = 0;

      // Get conversations that need categorization
      const { data: conversations, error: convError } = await supabase
        .from('conversations')
        .select('id, decision_bucket, email_classification, triage_confidence')
        .eq('workspace_id', workspace_id)
        .or('triage_confidence.is.null,triage_confidence.lt.0.5')
        .limit(batchSize);

      if (convError) throw convError;

      // Use pre-triage rules for fast categorization
      for (const conv of conversations || []) {
        try {
          const { error: triageError } = await supabase.functions.invoke('pre-triage-rules', {
            body: { conversationId: conv.id, workspaceId: workspace_id }
          });
          
          if (!triageError) categorized++;
          processed++;
        } catch (e) {
          console.error('[LearnFromInbox] Error categorizing:', conv.id, e);
          processed++;
        }
      }

      const hasMore = (conversations?.length || 0) >= batchSize;

      return new Response(JSON.stringify({
        success: true,
        phase: 'categorize',
        processed,
        categorized,
        hasMore,
        batchSize,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Phase 3: Build voice profile (increased limit)
    if (phase === 'voice_profile') {
      console.log('[LearnFromInbox] Triggering voice profile analysis...');
      
      const { data, error } = await supabase.functions.invoke('analyze-voice-profile', {
        body: { workspace_id }
      });

      if (error) {
        console.error('[LearnFromInbox] Voice profile error:', error);
        throw error;
      }

      return new Response(JSON.stringify({
        success: true,
        phase: 'voice_profile',
        result: data,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Phase 4: Analyze email patterns
    if (phase === 'patterns') {
      console.log('[LearnFromInbox] Analyzing email patterns...');

      // Get category distribution
      const { data: categoryData } = await supabase
        .from('conversations')
        .select('email_classification')
        .eq('workspace_id', workspace_id);

      const emailsByCategory: Record<string, number> = {};
      for (const conv of categoryData || []) {
        const cat = conv.email_classification || 'uncategorized';
        emailsByCategory[cat] = (emailsByCategory[cat] || 0) + 1;
      }

      // Get sender domain distribution
      const { data: customerData } = await supabase
        .from('customers')
        .select('email')
        .eq('workspace_id', workspace_id);

      const emailsBySenderDomain: Record<string, number> = {};
      for (const cust of customerData || []) {
        if (cust.email) {
          const domain = cust.email.split('@')[1] || 'unknown';
          emailsBySenderDomain[domain] = (emailsBySenderDomain[domain] || 0) + 1;
        }
      }

      // Get response time stats
      const { data: responseData } = await supabase
        .from('conversations')
        .select('first_response_time_minutes')
        .eq('workspace_id', workspace_id)
        .not('first_response_time_minutes', 'is', null);

      let avgResponseTime = null;
      if (responseData && responseData.length > 0) {
        const totalMinutes = responseData.reduce((sum, r) => sum + (r.first_response_time_minutes || 0), 0);
        avgResponseTime = (totalMinutes / responseData.length) / 60; // Convert to hours
      }

      // Count top inquiry types
      const sortedCategories = Object.entries(emailsByCategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([category, count]) => ({ category, count }));

      // Save insights
      const { error: upsertError } = await supabase
        .from('inbox_insights')
        .upsert({
          workspace_id,
          total_emails_analyzed: categoryData?.length || 0,
          emails_by_category: emailsByCategory,
          emails_by_sender_domain: Object.fromEntries(
            Object.entries(emailsBySenderDomain).sort((a, b) => b[1] - a[1]).slice(0, 20)
          ),
          common_inquiry_types: sortedCategories,
          avg_response_time_hours: avgResponseTime,
          learning_phases_completed: { patterns: true },
          analyzed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id' });

      if (upsertError) {
        console.error('[LearnFromInbox] Error saving insights:', upsertError);
      }

      return new Response(JSON.stringify({
        success: true,
        phase: 'patterns',
        insights: {
          totalEmails: categoryData?.length || 0,
          categories: sortedCategories,
          avgResponseTimeHours: avgResponseTime,
          topDomains: Object.entries(emailsBySenderDomain)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5),
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Phase 5: Extract response patterns
    if (phase === 'responses') {
      console.log('[LearnFromInbox] Extracting response patterns...');

      // Find successful response patterns (emails that led to bookings or positive outcomes)
      const { data: successfulConvs } = await supabase
        .from('conversations')
        .select(`
          id,
          email_classification,
          led_to_booking,
          messages(body, direction, actor_type)
        `)
        .eq('workspace_id', workspace_id)
        .eq('led_to_booking', true)
        .limit(50);

      // Group by category and extract patterns
      const patternsByCategory: Record<string, string[]> = {};
      let patternsLearned = 0;

      for (const conv of successfulConvs || []) {
        const category = conv.email_classification || 'general';
        const outboundMessages = conv.messages?.filter(
          (m: any) => m.direction === 'outbound' && m.actor_type === 'human_agent'
        ) || [];

        for (const msg of outboundMessages) {
          if (msg.body && msg.body.length > 50) {
            if (!patternsByCategory[category]) {
              patternsByCategory[category] = [];
            }
            if (patternsByCategory[category].length < 3) {
              patternsByCategory[category].push(msg.body.substring(0, 500));
              patternsLearned++;
            }
          }
        }
      }

      // Save learned responses
      for (const [category, examples] of Object.entries(patternsByCategory)) {
        for (const example of examples) {
          const { error } = await supabase
            .from('learned_responses')
            .insert({
              workspace_id,
              email_category: category,
              example_response: example,
              success_indicators: { led_to_booking: true },
            });
          
          if (error) {
            console.error('[LearnFromInbox] Error saving learned response:', error);
          }
        }
      }

      // Update insights with patterns count
      await supabase
        .from('inbox_insights')
        .update({
          patterns_learned: patternsLearned,
          learning_phases_completed: { patterns: true, responses: true },
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspace_id);

      return new Response(JSON.stringify({
        success: true,
        phase: 'responses',
        patternsLearned,
        categoriesWithPatterns: Object.keys(patternsByCategory),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get final summary
    if (phase === 'summary') {
      const { data: insights } = await supabase
        .from('inbox_insights')
        .select('*')
        .eq('workspace_id', workspace_id)
        .single();

      const { data: voiceProfile } = await supabase
        .from('voice_profiles')
        .select('tone_descriptors, formality_score, emails_analyzed')
        .eq('workspace_id', workspace_id)
        .single();

      const { count: learnedResponsesCount } = await supabase
        .from('learned_responses')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspace_id);

      return new Response(JSON.stringify({
        success: true,
        phase: 'summary',
        summary: {
          totalEmailsAnalyzed: insights?.total_emails_analyzed || 0,
          outboundAnalyzed: voiceProfile?.emails_analyzed || 0,
          patternsLearned: insights?.patterns_learned || 0,
          learnedResponses: learnedResponsesCount || 0,
          toneDescriptors: voiceProfile?.tone_descriptors || [],
          formalityScore: voiceProfile?.formality_score || 50,
          topCategories: insights?.common_inquiry_types || [],
          avgResponseTimeHours: insights?.avg_response_time_hours,
        },
        processingTimeMs: Date.now() - startTime,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown phase' }), {
      status: 400,
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
