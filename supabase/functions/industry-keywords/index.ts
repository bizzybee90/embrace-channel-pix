import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'industry-keywords';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const body = await req.json();
    console.log(`[${functionName}] Starting:`, { workspace_id: body.workspace_id, action: body.action });

    if (!body.workspace_id) throw new Error('workspace_id is required');

    // Handle different actions
    if (body.action === 'save') {
      // Just save the provided keywords
      if (!body.keywords || !Array.isArray(body.keywords)) {
        throw new Error('keywords array is required for save action');
      }

      await supabase
        .from('business_profile')
        .update({
          search_keywords: body.keywords,
          updated_at: new Date().toISOString()
        })
        .eq('workspace_id', body.workspace_id);

      return new Response(
        JSON.stringify({ success: true, keywords: body.keywords }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default action: Generate keywords from FAQs and business profile
    
    // Get business profile
    const { data: profile } = await supabase
      .from('business_profile')
      .select('*')
      .eq('workspace_id', body.workspace_id)
      .single();

    // Get FAQs
    const { data: faqs } = await supabase
      .from('faq_database')
      .select('question, answer, category')
      .eq('workspace_id', body.workspace_id)
      .limit(50);

    const context = `
Business Name: ${profile?.business_name || 'Unknown'}
Industry: ${profile?.industry || 'Unknown'}
Services: ${JSON.stringify(profile?.services || [])}
Service Area: ${profile?.service_area || 'Unknown'}

FAQs:
${(faqs || []).map((f: any) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')}
`;

    const prompt = `Based on this business information, generate a list of search keywords that would find similar/competing businesses on Google.

${context}

Generate 5-10 keywords that:
1. Describe the core services (e.g., "window cleaning", "gutter cleaning")
2. Include location-based terms if relevant (e.g., "window cleaners Luton")
3. Are terms customers would search for

Respond with ONLY a JSON array of strings:
["window cleaning", "residential window cleaners", "commercial window cleaning", "gutter cleaning", "pressure washing"]`;

    console.log(`[${functionName}] Calling Lovable AI Gateway...`);

    const aiResponse = await fetch(LOVABLE_AI_GATEWAY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      if (aiResponse.status === 402) {
        throw new Error('AI credits exhausted. Please add credits to your workspace.');
      }
      throw new Error(`AI Gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const responseText = aiData.choices?.[0]?.message?.content || '';

    // Parse keywords
    let keywords: string[];
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found');
      keywords = JSON.parse(jsonMatch[0]);
    } catch {
      // Fallback: extract any quoted strings
      keywords = (responseText.match(/"([^"]+)"/g) || []).map((s: string) => s.replace(/"/g, ''));
    }

    // Save to business profile
    await supabase
      .from('business_profile')
      .update({
        search_keywords: keywords,
        updated_at: new Date().toISOString()
      })
      .eq('workspace_id', body.workspace_id);

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms: ${keywords.length} keywords`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        keywords,
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
