import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VerificationIssue {
  type: 'hallucination' | 'factual_error' | 'policy_violation' | 'tone_mismatch' | 'missing_info';
  severity: 'critical' | 'warning' | 'info';
  description: string;
  suggestion?: string;
}

interface VerificationResult {
  status: 'passed' | 'failed' | 'needs_review';
  issues: VerificationIssue[];
  correctedDraft?: string;
  confidenceScore: number;
  notes: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'draft-verify';
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
    if (!body.draft) {
      throw new Error('draft is required');
    }

    const { conversation_id, workspace_id, draft } = body;
    console.log(`[${functionName}] Starting verification:`, { conversation_id, workspace_id });

    // Step 1: Fetch conversation context
    currentStep = 'fetching_context';
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        title,
        email_classification,
        urgency,
        customer:customers(id, name, email)
      `)
      .eq('id', conversation_id)
      .eq('workspace_id', workspace_id)
      .single();

    if (convError) {
      throw new Error(`Failed to fetch conversation: ${convError.message}`);
    }

    // Step 2: Fetch original customer message
    const { data: messages } = await supabase
      .from('messages')
      .select('body, direction')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: false })
      .limit(5);

    const customerMessage = messages?.find(m => m.direction === 'inbound')?.body || '';

    // Step 3: Fetch knowledge base for fact-checking
    currentStep = 'fetching_knowledge';
    const { data: faqs } = await supabase
      .from('faq_database')
      .select('question, answer')
      .eq('workspace_id', workspace_id)
      .order('priority', { ascending: false })
      .limit(10);

    const { data: businessFacts } = await supabase
      .from('business_facts')
      .select('fact_key, fact_value, category')
      .eq('workspace_id', workspace_id)
      .limit(20);

    // Step 4: Build verification prompt
    currentStep = 'building_prompt';
    const knowledgeBase = [
      ...(faqs || []).map(f => `Q: ${f.question}\nA: ${f.answer}`),
      ...(businessFacts || []).map(f => `${f.category}: ${f.fact_key} = ${f.fact_value}`)
    ].join('\n\n');

    const verificationPrompt = `You are a draft verification assistant. Your job is to check AI-generated email responses for issues before they are sent to customers.

CUSTOMER QUESTION:
${customerMessage}

AI-GENERATED DRAFT:
${draft}

KNOWLEDGE BASE (source of truth):
${knowledgeBase || 'No knowledge base available - be extra careful about factual claims.'}

VERIFICATION TASKS:
1. Check for HALLUCINATIONS - claims not supported by the knowledge base
2. Check for FACTUAL ERRORS - incorrect information about products, services, pricing, etc.
3. Check for POLICY VIOLATIONS - promises that shouldn't be made, discounts not authorized, etc.
4. Check for TONE MISMATCH - inappropriate formality, too casual, or off-brand language
5. Check for MISSING INFO - important details the customer asked about that weren't addressed

RESPOND IN JSON FORMAT ONLY:
{
  "status": "passed" | "failed" | "needs_review",
  "issues": [
    {
      "type": "hallucination" | "factual_error" | "policy_violation" | "tone_mismatch" | "missing_info",
      "severity": "critical" | "warning" | "info",
      "description": "What's wrong",
      "suggestion": "How to fix it"
    }
  ],
  "correctedDraft": "If status is 'failed', provide a corrected version here. Otherwise null.",
  "confidenceScore": 0.0-1.0,
  "notes": "Brief summary of verification"
}

RULES:
- status="passed" means the draft is safe to send
- status="failed" means there are critical issues that MUST be fixed
- status="needs_review" means there are warnings a human should check
- Only flag REAL issues, not stylistic preferences
- If no knowledge base, flag any specific claims about pricing, availability, or policies as "needs_review"`;

    // Step 5: Call AI for verification
    currentStep = 'verifying_draft';
    console.log(`[${functionName}] Calling AI Gateway for verification...`);

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [{ role: 'user', content: verificationPrompt }],
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      })
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      if (aiResponse.status === 402) {
        throw new Error('AI credits exhausted. Please add credits to your workspace.');
      }
      const errorText = await aiResponse.text();
      throw new Error(`AI Gateway error ${aiResponse.status}: ${errorText}`);
    }

    const aiData = await aiResponse.json();
    
    if (!aiData.choices || !aiData.choices[0] || !aiData.choices[0].message) {
      throw new Error('AI Gateway returned unexpected format');
    }

    // Parse the verification result
    currentStep = 'parsing_result';
    let verificationResult: VerificationResult;
    try {
      const content = aiData.choices[0].message.content.trim();
      // Handle potential markdown code blocks
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      verificationResult = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error(`[${functionName}] Failed to parse AI response:`, parseError);
      // Default to needs_review if parsing fails
      verificationResult = {
        status: 'needs_review',
        issues: [{
          type: 'hallucination',
          severity: 'warning',
          description: 'Could not automatically verify draft - manual review recommended'
        }],
        confidenceScore: 0.5,
        notes: 'Verification parsing failed, defaulting to manual review'
      };
    }

    // Step 6: Save verification result to database
    currentStep = 'saving_result';
    const { data: verification, error: saveError } = await supabase
      .from('draft_verifications')
      .insert({
        workspace_id,
        conversation_id,
        original_draft: draft,
        verification_status: verificationResult.status,
        issues_found: verificationResult.issues,
        corrected_draft: verificationResult.correctedDraft || null,
        confidence_score: verificationResult.confidenceScore,
        verification_notes: verificationResult.notes
      })
      .select()
      .single();

    if (saveError) {
      console.error(`[${functionName}] Failed to save verification:`, saveError);
      // Continue anyway - verification result is still useful
    }

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms:`, {
      status: verificationResult.status,
      issues_count: verificationResult.issues.length,
      confidence: verificationResult.confidenceScore
    });

    return new Response(
      JSON.stringify({
        success: true,
        verification_id: verification?.id || null,
        status: verificationResult.status,
        issues: verificationResult.issues,
        corrected_draft: verificationResult.correctedDraft,
        confidence_score: verificationResult.confidenceScore,
        notes: verificationResult.notes,
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
