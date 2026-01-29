import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * parse-email-body
 * 
 * Uses Gemini Flash Lite to extract only the NEW content from email bodies,
 * stripping quoted reply history. This ensures voice learning gets clean,
 * unambiguous text showing who wrote what.
 * 
 * Cost: ~$0.01 per 1000 emails
 * Speed: ~100-200ms per email (batched for efficiency)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const BATCH_SIZE = 20; // Process 20 emails per AI call for efficiency
const FUNCTION_NAME = 'parse-email-body';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const body = await req.json();
    const { workspace_id, limit = 100 } = body;

    if (!workspace_id) {
      throw new Error('workspace_id is required');
    }

    console.log(`[${FUNCTION_NAME}] Starting for workspace: ${workspace_id}, limit: ${limit}`);

    // Get emails that need parsing (have body but no body_clean)
    const { data: emails, error: fetchError } = await supabase
      .from('email_import_queue')
      .select('id, body, direction')
      .eq('workspace_id', workspace_id)
      .not('body', 'is', null)
      .is('body_clean', null)
      .limit(limit);

    if (fetchError) {
      throw new Error(`Failed to fetch emails: ${fetchError.message}`);
    }

    if (!emails || emails.length === 0) {
      console.log(`[${FUNCTION_NAME}] No emails need parsing`);
      return new Response(JSON.stringify({
        success: true,
        parsed: 0,
        message: 'No emails need parsing'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[${FUNCTION_NAME}] Found ${emails.length} emails to parse`);

    let totalParsed = 0;
    let totalErrors = 0;

    // Process in batches for efficiency
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      
      // Build the prompt for batch processing
      const emailsForPrompt = batch.map((email, idx) => {
        // Truncate very long emails to save tokens
        const bodyText = (email.body || '').slice(0, 2000);
        return `[EMAIL ${idx + 1}]\n${bodyText}\n[/EMAIL ${idx + 1}]`;
      }).join('\n\n');

      const prompt = `You are an email parsing assistant. For each email below, extract ONLY the NEW content - the actual message written by the sender. Remove all quoted reply content, email signatures, and forwarded message headers.

Quoted content typically appears after markers like:
- "On [date], [person] wrote:"
- "From: [email]"
- "Sent from my iPhone/Android"
- Lines starting with ">"
- "--- Original Message ---"

For each email, return ONLY the new content that was actually typed by the sender.

${emailsForPrompt}

Respond with a JSON array containing the extracted content for each email, in order:
[
  "extracted content for email 1",
  "extracted content for email 2",
  ...
]

If an email has no discernible new content (e.g., it's entirely a forward), return an empty string for that position.
Return ONLY the JSON array, no other text.`;

      try {
        const aiResponse = await fetch(LOVABLE_AI_GATEWAY, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LOVABLE_API_KEY}`
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash-lite',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1, // Low temperature for consistent extraction
          })
        });

        if (!aiResponse.ok) {
          if (aiResponse.status === 429) {
            console.log(`[${FUNCTION_NAME}] Rate limited, stopping batch processing`);
            break;
          }
          if (aiResponse.status === 402) {
            throw new Error('AI credits exhausted. Please add credits to your workspace.');
          }
          throw new Error(`AI Gateway error: ${aiResponse.status}`);
        }

        const aiData = await aiResponse.json();
        const responseText = aiData.choices?.[0]?.message?.content || '[]';

        // Parse the JSON array response
        let parsedContents: string[];
        try {
          // Handle potential markdown code blocks
          const cleanJson = responseText
            .replace(/```json\s*/g, '')
            .replace(/```\s*/g, '')
            .trim();
          parsedContents = JSON.parse(cleanJson);
        } catch (parseError) {
          console.error(`[${FUNCTION_NAME}] Failed to parse AI response:`, responseText.slice(0, 500));
          totalErrors += batch.length;
          continue;
        }

        // Update each email with its parsed content using individual updates
        // (upsert requires all non-null columns which we don't have)
        let batchUpdateSuccess = 0;
        for (let idx = 0; idx < batch.length; idx++) {
          const email = batch[idx];
          const cleanBody = parsedContents[idx] || email.body?.slice(0, 500) || '';
          
          const { error: updateError } = await supabase
            .from('email_import_queue')
            .update({ body_clean: cleanBody })
            .eq('id', email.id);
          
          if (!updateError) {
            batchUpdateSuccess++;
          }
        }
        totalParsed += batchUpdateSuccess;

        console.log(`[${FUNCTION_NAME}] Batch ${Math.floor(i / BATCH_SIZE) + 1}: parsed ${batch.length} emails`);

      } catch (batchError) {
        console.error(`[${FUNCTION_NAME}] Batch error:`, batchError);
        totalErrors += batch.length;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Completed in ${duration}ms: ${totalParsed} parsed, ${totalErrors} errors`);

    return new Response(JSON.stringify({
      success: true,
      parsed: totalParsed,
      errors: totalErrors,
      duration_ms: duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error(`[${FUNCTION_NAME}] Error:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
      duration_ms: Date.now() - startTime
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
