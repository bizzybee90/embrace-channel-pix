import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// EMAIL DRAFT AGENT (PASS 2)
// Only called when reply_needed = yes
// Focuses purely on generating high-quality drafts
// ============================================

const DEFAULT_DRAFT_PROMPT = `You are a professional email assistant for a home services business (window cleaning, gutter cleaning, etc.).

Your ONLY job is to draft a reply to the customer email below.

## Style Guide
- Warm, professional tone - like a friendly small business owner
- Brief and to the point - 2-4 sentences typically
- Always address the customer by name if known
- Never invent prices, dates, or commitments
- If you need information to respond, ask ONE clear question
- Sign off with the business name or "Kind regards"

## What NOT to do
- Don't repeat the customer's entire message back
- Don't use formal/corporate language ("As per your request...")
- Don't make up availability, pricing, or details
- Don't include a typed signature (HTML signature will be added)

## Decision Context
You'll receive context about why this email landed in its bucket (act_now, quick_win, wait).
Use this to calibrate your response:
- ACT_NOW: Be careful, empathetic, prioritize de-escalation if upset customer
- QUICK_WIN: Be efficient, template-like responses work well
- WAIT: Usually no draft needed, but if requested, keep it brief

Output ONLY the draft reply text. No explanations, no headers, just the reply.`;

interface DraftRequest {
  email: {
    from_email: string;
    from_name: string;
    subject: string;
    body: string;
    to_email?: string;
  };
  customer?: {
    name?: string;
    tier?: string;
    notes?: string;
    next_appointment?: string;
    frequency?: string;
    price?: number;
  };
  decision_context?: {
    bucket: string;
    why_this_needs_you: string;
    classification: string;
    sentiment?: string;
    risk_level?: string;
  };
  workspace_id: string;
}

interface VoiceProfile {
  greeting_patterns: string[];
  signoff_patterns: string[];
  formality_score: number;
  avg_response_length: number;
  uses_emojis: boolean;
  uses_exclamations: boolean;
  common_phrases: string[];
  tone_descriptors: string[];
  sample_responses: Array<{
    category: string;
    response: string;
    led_to_booking?: boolean;
  }>;
}

async function getVoiceProfile(supabase: any, workspaceId: string): Promise<VoiceProfile | null> {
  try {
    const { data, error } = await supabase
      .from('voice_profiles')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('analysis_status', 'complete')
      .single();

    if (error || !data) {
      console.log('[DraftAgent] No voice profile found for workspace');
      return null;
    }

    console.log('[DraftAgent] Found voice profile, formality:', data.formality_score);
    return {
      greeting_patterns: data.greeting_patterns || [],
      signoff_patterns: data.signoff_patterns || [],
      formality_score: data.formality_score || 50,
      avg_response_length: data.avg_response_length || 0,
      uses_emojis: data.uses_emojis || false,
      uses_exclamations: data.uses_exclamations || false,
      common_phrases: data.common_phrases || [],
      tone_descriptors: data.tone_descriptors || [],
      sample_responses: data.sample_responses || [],
    };
  } catch (error) {
    console.error('[DraftAgent] Error fetching voice profile:', error);
    return null;
  }
}

async function getDraftPrompt(supabase: any, workspaceId?: string): Promise<{ prompt: string; model: string }> {
  try {
    if (workspaceId) {
      const { data: wsPrompt } = await supabase
        .from('system_prompts')
        .select('prompt, model')
        .eq('agent_type', 'draft')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true)
        .eq('is_default', true)
        .single();
      
      if (wsPrompt?.prompt) {
        console.log('[DraftAgent] Using workspace-specific draft prompt');
        return { prompt: wsPrompt.prompt, model: wsPrompt.model || 'claude-sonnet-4-20250514' };
      }
    }

    const { data: globalPrompt } = await supabase
      .from('system_prompts')
      .select('prompt, model')
      .eq('agent_type', 'draft')
      .is('workspace_id', null)
      .eq('is_active', true)
      .eq('is_default', true)
      .single();

    if (globalPrompt?.prompt) {
      console.log('[DraftAgent] Using global draft prompt');
      return { prompt: globalPrompt.prompt, model: globalPrompt.model || 'claude-sonnet-4-20250514' };
    }
  } catch (error) {
    console.error('[DraftAgent] Error fetching prompt:', error);
  }

  console.log('[DraftAgent] Using default draft prompt');
  return { prompt: DEFAULT_DRAFT_PROMPT, model: 'claude-sonnet-4-20250514' };
}

function buildVoiceInstructions(profile: VoiceProfile): string {
  let instructions = '\n\n## Your Writing Style (IMPORTANT - Match This)\n';
  
  // Greetings
  if (profile.greeting_patterns.length > 0) {
    instructions += `\n### Greetings you typically use:\n`;
    profile.greeting_patterns.slice(0, 3).forEach(g => {
      instructions += `- "${g}"\n`;
    });
  }
  
  // Sign-offs
  if (profile.signoff_patterns.length > 0) {
    instructions += `\n### Sign-offs you typically use:\n`;
    profile.signoff_patterns.slice(0, 3).forEach(s => {
      instructions += `- "${s}"\n`;
    });
  }
  
  // Tone
  if (profile.tone_descriptors.length > 0) {
    instructions += `\n### Your tone is: ${profile.tone_descriptors.join(', ')}\n`;
  }
  
  // Formality
  if (profile.formality_score < 40) {
    instructions += `\n### Formality: Casual and friendly. Use contractions, keep it conversational.\n`;
  } else if (profile.formality_score > 70) {
    instructions += `\n### Formality: Professional and polished. Maintain a business-appropriate tone.\n`;
  } else {
    instructions += `\n### Formality: Balanced - professional but approachable.\n`;
  }
  
  // Common phrases
  if (profile.common_phrases.length > 0) {
    instructions += `\n### Phrases you often use (incorporate naturally):\n`;
    profile.common_phrases.slice(0, 5).forEach(p => {
      instructions += `- "${p}"\n`;
    });
  }
  
  // Response length
  if (profile.avg_response_length > 0) {
    if (profile.avg_response_length < 100) {
      instructions += `\n### Length: Keep responses brief and to the point (you typically write short replies).\n`;
    } else if (profile.avg_response_length > 300) {
      instructions += `\n### Length: You tend to write detailed, thorough responses.\n`;
    }
  }
  
  // Emojis/exclamations
  if (profile.uses_emojis) {
    instructions += `\n### You sometimes use emojis - use sparingly where appropriate.\n`;
  }
  if (profile.uses_exclamations) {
    instructions += `\n### You use exclamation marks to convey enthusiasm - use naturally.\n`;
  }
  
  return instructions;
}

function selectExamples(profile: VoiceProfile, emailCategory?: string): string {
  if (!profile.sample_responses || profile.sample_responses.length === 0) {
    return '';
  }
  
  let examples = '\n\n## Example Replies (Match This Style)\n';
  
  // Prioritize successful outcomes and matching category
  const sorted = [...profile.sample_responses].sort((a, b) => {
    // Prioritize led_to_booking
    if (a.led_to_booking && !b.led_to_booking) return -1;
    if (!a.led_to_booking && b.led_to_booking) return 1;
    // Then prioritize matching category
    if (emailCategory) {
      if (a.category === emailCategory && b.category !== emailCategory) return -1;
      if (a.category !== emailCategory && b.category === emailCategory) return 1;
    }
    return 0;
  });
  
  // Take top 2-3 examples
  const selected = sorted.slice(0, 3);
  
  selected.forEach((ex, i) => {
    examples += `\n### Example ${i + 1} (${ex.category}):\n`;
    examples += `${ex.response}\n`;
  });
  
  return examples;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const request: DraftRequest & { email_provider_id?: string } = await req.json();
    const { email, customer, decision_context, workspace_id, email_provider_id } = request;

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Check automation level for this email account
    let automationLevel = 'draft_only'; // Default
    if (email_provider_id) {
      const { data: providerConfig } = await supabase
        .from('email_provider_configs')
        .select('automation_level')
        .eq('id', email_provider_id)
        .single();
      
      if (providerConfig?.automation_level) {
        automationLevel = providerConfig.automation_level;
      }
    } else if (workspace_id) {
      // Fallback to workspace channel config
      const { data: channelConfig } = await supabase
        .from('workspace_channels')
        .select('automation_level')
        .eq('workspace_id', workspace_id)
        .eq('channel', 'email')
        .single();
      
      if (channelConfig?.automation_level) {
        automationLevel = channelConfig.automation_level;
      }
    }

    console.log('[DraftAgent] Automation level:', automationLevel);

    // If automation is disabled, skip draft generation
    if (automationLevel === 'disabled') {
      console.log('[DraftAgent] Automation disabled for this channel, skipping draft');
      return new Response(JSON.stringify({
        draft: null,
        skipped: true,
        reason: 'automation_disabled',
        processing_time_ms: Date.now() - startTime
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[DraftAgent] Generating draft for:', email.from_email, 'subject:', email.subject);

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const { prompt: draftPrompt, model: draftModel } = await getDraftPrompt(supabase, workspace_id);
    
    // Fetch voice profile for this workspace
    const voiceProfile = await getVoiceProfile(supabase, workspace_id);

    // Build context for the draft
    let contextBlock = '';
    
    // Add voice profile instructions if available
    if (voiceProfile) {
      contextBlock += buildVoiceInstructions(voiceProfile);
      contextBlock += selectExamples(voiceProfile, decision_context?.classification);
    }
    
    if (customer?.name || customer?.tier) {
      contextBlock += '\n\n## Customer Info\n';
      if (customer.name) contextBlock += `- Name: ${customer.name}\n`;
      if (customer.tier) contextBlock += `- Tier: ${customer.tier}\n`;
      if (customer.frequency) contextBlock += `- Service frequency: ${customer.frequency}\n`;
      if (customer.next_appointment) contextBlock += `- Next appointment: ${customer.next_appointment}\n`;
      if (customer.notes) contextBlock += `- Notes: ${customer.notes}\n`;
    }

    if (decision_context) {
      contextBlock += '\n\n## Decision Context\n';
      contextBlock += `- Bucket: ${decision_context.bucket}\n`;
      contextBlock += `- Why: ${decision_context.why_this_needs_you}\n`;
      if (decision_context.sentiment) contextBlock += `- Sentiment: ${decision_context.sentiment}\n`;
      if (decision_context.risk_level) contextBlock += `- Risk: ${decision_context.risk_level}\n`;
    }

    const emailContent = `
## Original Email

FROM: ${email.from_name} <${email.from_email}>
SUBJECT: ${email.subject}

${email.body.substring(0, 4000)}
`;

    console.log('[DraftAgent] Calling Claude for draft generation...');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: draftModel,
        max_tokens: 1024,
        system: draftPrompt + contextBlock,
        messages: [
          {
            role: 'user',
            content: `Please draft a reply to this email:\n${emailContent}`
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[DraftAgent] Claude API error:', response.status, errorText);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const result = await response.json();
    const draftText = result.content?.[0]?.text || '';

    const processingTime = Date.now() - startTime;

    console.log('[DraftAgent] Draft generated successfully, length:', draftText.length);

    // Include automation level info for the caller to decide next steps
    return new Response(JSON.stringify({
      draft: draftText,
      model_used: draftModel,
      processing_time_ms: processingTime,
      automation_level: automationLevel,
      should_auto_send: automationLevel === 'automatic',
      needs_review: automationLevel === 'review_required'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[DraftAgent] Error:', error);
    return new Response(JSON.stringify({ 
      error: errorMessage,
      draft: null 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
