import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================================
// CONSTANTS
// =============================================================================

const FUNCTION_NAME = 'email-classify';
const BATCH_SIZE = 50; // Emails per Gemini call
const MAX_BODY_LENGTH = 200; // Truncate email bodies to save tokens

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

// =============================================================================
// TYPES
// =============================================================================

interface ClassifyRequest {
  workspace_id: string;
}

interface RawEmail {
  id: string;
  from_email: string;
  from_name: string | null;
  to_email: string;
  subject: string;
  body_text: string | null;
  folder: string;
  email_type: string | null;
}

interface GeminiClassification {
  index: number;
  category: string;
  confidence: number;
  requires_reply: boolean;
  reasoning: string;
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const startTime = Date.now();

  try {
    // -------------------------------------------------------------------------
    // Validate Environment
    // -------------------------------------------------------------------------
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const googleApiKey = Deno.env.get('GOOGLE_API_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not configured');
    }
    if (!googleApiKey) {
      throw new Error('GOOGLE_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // -------------------------------------------------------------------------
    // Validate Input
    // -------------------------------------------------------------------------
    const body = await req.json() as ClassifyRequest;
    
    if (!body.workspace_id) {
      throw new Error('workspace_id is required');
    }

    console.log(`[${FUNCTION_NAME}] Starting classification for workspace: ${body.workspace_id}`);

    // -------------------------------------------------------------------------
    // Fetch Unclassified Emails
    // -------------------------------------------------------------------------
    const { data: emails, error: fetchError } = await supabase
      .from('raw_emails')
      .select('id, from_email, from_name, to_email, subject, body_text, folder, email_type')
      .eq('workspace_id', body.workspace_id)
      .is('classification_category', null)
      .order('received_at', { ascending: false })
      .limit(BATCH_SIZE);

    if (fetchError) throw fetchError;

    if (!emails || emails.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          classified: 0, 
          remaining: 0,
          has_more: false,
          message: 'No emails to classify' 
        }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[${FUNCTION_NAME}] Found ${emails.length} emails to classify`);

    // -------------------------------------------------------------------------
    // Prepare Emails for Gemini
    // -------------------------------------------------------------------------
    const emailSummaries = (emails as RawEmail[]).map((e, i) => 
      `[${i}] From: ${e.from_email} | Subject: ${e.subject || '(no subject)'} | Type: ${e.email_type || 'unknown'}\nBody preview: ${(e.body_text || '').substring(0, MAX_BODY_LENGTH)}...`
    ).join('\n\n---\n\n');

    // -------------------------------------------------------------------------
    // Call Gemini Flash for Bulk Classification
    // -------------------------------------------------------------------------
    const prompt = `You are an email classifier for a small business. Classify each email below.

CATEGORIES:
- inquiry: Customer asking questions about services/products
- booking: Request to schedule or book a service
- quote: Request for pricing/quote
- complaint: Customer complaint or issue
- follow_up: Follow-up to previous conversation
- spam: Spam, marketing, newsletters
- notification: Automated notifications (receipts, confirmations)
- personal: Personal/non-business emails

For each email, respond with a JSON array in this exact format:
[
  {"index": 0, "category": "inquiry", "confidence": 0.95, "requires_reply": true, "reasoning": "Customer asking about services"},
  {"index": 1, "category": "spam", "confidence": 0.99, "requires_reply": false, "reasoning": "Marketing newsletter"}
]

EMAILS TO CLASSIFY:

${emailSummaries}

Respond ONLY with the JSON array, no other text.`;

    const geminiResponse = await fetch(`${GEMINI_API}?key=${googleApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096
        }
      })
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      throw new Error(`Gemini API error: ${errorText}`);
    }

    const geminiData = await geminiResponse.json();
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // -------------------------------------------------------------------------
    // Parse Gemini Response
    // -------------------------------------------------------------------------
    let classifications: GeminiClassification[];
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found in response');
      classifications = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`[${FUNCTION_NAME}] Parse error:`, responseText.substring(0, 500));
      throw new Error('Failed to parse Gemini response as JSON');
    }

    console.log(`[${FUNCTION_NAME}] Gemini returned ${classifications.length} classifications`);

    // -------------------------------------------------------------------------
    // Update Emails with Classifications
    // -------------------------------------------------------------------------
    let updated = 0;
    for (const classification of classifications) {
      const email = (emails as RawEmail[])[classification.index];
      if (!email) {
        console.warn(`[${FUNCTION_NAME}] Invalid index ${classification.index}, skipping`);
        continue;
      }

      const { error: updateError } = await supabase
        .from('raw_emails')
        .update({
          classification_category: classification.category,
          classification_confidence: classification.confidence,
          classification_reasoning: classification.reasoning,
          requires_reply: classification.requires_reply,
          status: 'classified'
        })
        .eq('id', email.id);

      if (!updateError) {
        updated++;
      } else {
        console.warn(`[${FUNCTION_NAME}] Failed to update email ${email.id}:`, updateError.message);
      }
    }

    // -------------------------------------------------------------------------
    // Update Import Progress
    // -------------------------------------------------------------------------
    await supabase
      .from('email_import_progress')
      .update({
        emails_classified: updated,
        current_phase: 'classifying',
        updated_at: new Date().toISOString()
      })
      .eq('workspace_id', body.workspace_id);

    // -------------------------------------------------------------------------
    // Check for Remaining Emails
    // -------------------------------------------------------------------------
    const { count } = await supabase
      .from('raw_emails')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', body.workspace_id)
      .is('classification_category', null);

    const duration = Date.now() - startTime;
    const remaining = count || 0;

    console.log(`[${FUNCTION_NAME}] Completed in ${duration}ms: ${updated} classified, ${remaining} remaining`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        classified: updated, 
        remaining,
        has_more: remaining > 0,
        duration_ms: duration
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[${FUNCTION_NAME}] Error:`, error.message);

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        function: FUNCTION_NAME,
        duration_ms: duration
      }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
