import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'extract-website-faqs';
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

interface GroundTruth {
  prices: Array<{ service: string; price: string; unit?: string }>;
  services: string[];
  service_area: { cities?: string[]; counties?: string[]; radius_miles?: number; description?: string };
  policies: Array<{ type: string; description: string }>;
  guarantees: string[];
  certifications: string[];
  unique_selling_points: string[];
}

interface VoiceProfile {
  tone: 'formal' | 'casual' | 'friendly' | 'professional';
  greeting_style: string;
  sample_phrases: string[];
}

interface ExtractedData {
  business_info: {
    name?: string;
    services?: string[];
    service_area?: string;
    phone?: string;
    email?: string;
    opening_hours?: string;
  };
  faqs: Array<{
    question: string;
    answer: string;
    category: string;
  }>;
  ground_truth: GroundTruth;
  voice_profile: VoiceProfile;
  search_keywords: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { job_id, workspace_id, website_url, combined_markdown, pages_count } = await req.json();
    
    if (!job_id) throw new Error('job_id is required');
    if (!workspace_id) throw new Error('workspace_id is required');
    if (!combined_markdown) throw new Error('combined_markdown is required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const googleApiKey = Deno.env.get('GOOGLE_API_KEY');

    if (!googleApiKey) throw new Error('GOOGLE_API_KEY not configured');

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[${FUNCTION_NAME}] Starting extraction for job:`, job_id, `(${pages_count} pages)`);

    // =========================================
    // STEP 1: Extract data with Gemini
    // =========================================
    
    const prompt = `You are analyzing a business website (${pages_count} pages). Extract comprehensive data for a knowledge base system.

WEBSITE CONTENT:
${combined_markdown.substring(0, 120000)}

Extract ALL of the following:

1. **Business Details**: Name, services, service area, contact info, opening hours
2. **FAQs**: Any explicit Q&A sections from any page
3. **Implicit FAQs**: Turn service descriptions, pricing info, policies into Q&A format
4. **Ground Truth Facts**: Specific factual claims about the business
5. **Voice Profile**: The tone and style of writing used on the website
6. **Search Keywords**: Keywords that describe what this business does (for finding competitors)

CRITICAL VOICE RULE FOR ALL FAQ ANSWERS:
- Write ALL answers in FIRST PERSON ("we", "our", "us") as if YOU ARE the business.
- NEVER refer to the business by name in the third person.
- Instead of "[Business Name] offers..." write "We offer..."
- Instead of "They provide..." write "We provide..."
- Instead of "The company uses..." write "We use..."

For FAQs, create questions customers would actually ask, with answers based on the website content.

CRITICAL: Return ONLY valid JSON. No markdown formatting, no code blocks, no explanation.

{
  "business_info": {
    "name": "Business Name",
    "services": ["Service 1", "Service 2"],
    "service_area": "Coverage area description",
    "phone": "Phone number if found",
    "email": "Email if found",
    "opening_hours": "Hours if found"
  },
  "faqs": [
    {
      "question": "What services do you offer?",
      "answer": "We offer...",
      "category": "Services"
    }
  ],
  "ground_truth": {
    "prices": [
      { "service": "Standard clean", "price": "£50", "unit": "per visit" }
    ],
    "services": ["Window cleaning", "Gutter cleaning"],
    "service_area": {
      "cities": ["London", "Bristol"],
      "counties": ["Greater London"],
      "radius_miles": 25,
      "description": "We cover the South East"
    },
    "policies": [
      { "type": "cancellation", "description": "24 hour notice required" }
    ],
    "guarantees": ["100% satisfaction guarantee"],
    "certifications": ["Fully insured", "DBS checked"],
    "unique_selling_points": ["Family-run since 1990"]
  },
  "voice_profile": {
    "tone": "friendly",
    "greeting_style": "Hi there!",
    "sample_phrases": ["We're here to help", "No job too small"]
  },
  "search_keywords": ["window cleaning", "gutter cleaning", "pressure washing"]
}

Generate 20-50 high-quality FAQs covering services, pricing, coverage, booking, policies, and company info.`;

    let extractedData: ExtractedData | null = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (!extractedData && retryCount < maxRetries) {
      try {
        const geminiResponse = await fetch(`${GEMINI_API}?key=${googleApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1, // Lower temperature for more consistent JSON
              maxOutputTokens: 16384
            }
          })
        });

        if (!geminiResponse.ok) {
          const errorText = await geminiResponse.text();
          console.error(`[${FUNCTION_NAME}] Gemini error:`, errorText);
          retryCount++;
          await new Promise(r => setTimeout(r, 1000 * retryCount));
          continue;
        }

        const geminiData = await geminiResponse.json();
        const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Clean and parse JSON
        let cleanJson = responseText
          .replace(/```json\s*/gi, '')
          .replace(/```\s*/gi, '')
          .trim();

        // Find JSON object
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.warn(`[${FUNCTION_NAME}] No JSON found in response, retry ${retryCount + 1}`);
          retryCount++;
          continue;
        }

        extractedData = JSON.parse(jsonMatch[0]);
        console.log(`[${FUNCTION_NAME}] Extracted ${extractedData?.faqs?.length || 0} FAQs`);

      } catch (parseError) {
        console.error(`[${FUNCTION_NAME}] Parse error, retry ${retryCount + 1}:`, parseError);
        retryCount++;
        await new Promise(r => setTimeout(r, 1000 * retryCount));
      }
    }

    if (!extractedData) {
      await supabase
        .from('website_scrape_jobs')
        .update({
          status: 'failed',
          error_message: 'Failed to extract data after multiple retries',
          retry_count: retryCount,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', job_id);

      throw new Error('Failed to extract data after multiple retries');
    }

    // Update progress
    await supabase
      .from('website_scrape_jobs')
      .update({
        pages_extracted: pages_count,
        updated_at: new Date().toISOString()
      })
      .eq('id', job_id);

    // =========================================
    // STEP 2: Save FAQs to knowledge_base_faqs
    // =========================================
    
    const faqsToInsert = (extractedData.faqs || []).map((faq) => ({
      workspace_id,
      question: faq.question.slice(0, 500),
      answer: faq.answer.slice(0, 2000),
      category: faq.category || 'General',
      source: 'user_website',
      source_url: website_url,
      priority: 10,  // Gold standard - highest priority
      is_validated: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    let faqsCreated = 0;
    if (faqsToInsert.length > 0) {
      // Delete existing website FAQs first
      await supabase
        .from('knowledge_base_faqs')
        .delete()
        .eq('workspace_id', workspace_id)
        .eq('source', 'user_website');

      const { data: insertedFaqs, error: insertError } = await supabase
        .from('knowledge_base_faqs')
        .insert(faqsToInsert)
        .select('id');

      if (insertError) {
        console.error(`[${FUNCTION_NAME}] FAQ insert error:`, insertError);
      } else {
        faqsCreated = insertedFaqs?.length || 0;
      }
    }

    console.log(`[${FUNCTION_NAME}] Saved ${faqsCreated} FAQs`);

    // Update progress
    await supabase
      .from('website_scrape_jobs')
      .update({
        faqs_extracted: faqsCreated,
        updated_at: new Date().toISOString()
      })
      .eq('id', job_id);

    // =========================================
    // STEP 3: Save Ground Truth Facts
    // =========================================
    
    let groundTruthCount = 0;
    const gt = extractedData.ground_truth;
    
    if (gt) {
      // Delete existing ground truth
      await supabase
        .from('ground_truth_facts')
        .delete()
        .eq('workspace_id', workspace_id);

      const groundTruthFacts: Array<{ workspace_id: string; fact_type: string; fact_key: string; fact_value: string; source_url: string }> = [];

      // Add prices
      if (gt.prices) {
        for (const price of gt.prices) {
          groundTruthFacts.push({
            workspace_id,
            fact_type: 'price',
            fact_key: price.service.toLowerCase().replace(/\s+/g, '_'),
            fact_value: `${price.price}${price.unit ? ` ${price.unit}` : ''}`,
            source_url: website_url
          });
        }
      }

      // Add services
      if (gt.services) {
        for (const service of gt.services) {
          groundTruthFacts.push({
            workspace_id,
            fact_type: 'service',
            fact_key: service.toLowerCase().replace(/\s+/g, '_'),
            fact_value: service,
            source_url: website_url
          });
        }
      }

      // Add service area
      if (gt.service_area) {
        if (gt.service_area.cities) {
          groundTruthFacts.push({
            workspace_id,
            fact_type: 'service_area',
            fact_key: 'cities',
            fact_value: gt.service_area.cities.join(', '),
            source_url: website_url
          });
        }
        if (gt.service_area.counties) {
          groundTruthFacts.push({
            workspace_id,
            fact_type: 'service_area',
            fact_key: 'counties',
            fact_value: gt.service_area.counties.join(', '),
            source_url: website_url
          });
        }
        if (gt.service_area.radius_miles) {
          groundTruthFacts.push({
            workspace_id,
            fact_type: 'service_area',
            fact_key: 'radius_miles',
            fact_value: String(gt.service_area.radius_miles),
            source_url: website_url
          });
        }
        if (gt.service_area.description) {
          groundTruthFacts.push({
            workspace_id,
            fact_type: 'service_area',
            fact_key: 'description',
            fact_value: gt.service_area.description,
            source_url: website_url
          });
        }
      }

      // Add policies
      if (gt.policies) {
        for (const policy of gt.policies) {
          groundTruthFacts.push({
            workspace_id,
            fact_type: 'policy',
            fact_key: policy.type.toLowerCase().replace(/\s+/g, '_'),
            fact_value: policy.description,
            source_url: website_url
          });
        }
      }

      // Add guarantees
      if (gt.guarantees) {
        for (let i = 0; i < gt.guarantees.length; i++) {
          groundTruthFacts.push({
            workspace_id,
            fact_type: 'guarantee',
            fact_key: `guarantee_${i + 1}`,
            fact_value: gt.guarantees[i],
            source_url: website_url
          });
        }
      }

      // Add certifications
      if (gt.certifications) {
        for (let i = 0; i < gt.certifications.length; i++) {
          groundTruthFacts.push({
            workspace_id,
            fact_type: 'certification',
            fact_key: `certification_${i + 1}`,
            fact_value: gt.certifications[i],
            source_url: website_url
          });
        }
      }

      // Add USPs
      if (gt.unique_selling_points) {
        for (let i = 0; i < gt.unique_selling_points.length; i++) {
          groundTruthFacts.push({
            workspace_id,
            fact_type: 'usp',
            fact_key: `usp_${i + 1}`,
            fact_value: gt.unique_selling_points[i],
            source_url: website_url
          });
        }
      }

      if (groundTruthFacts.length > 0) {
        const { data: gtData, error: gtError } = await supabase
          .from('ground_truth_facts')
          .insert(groundTruthFacts)
          .select('id');

        if (gtError) {
          console.error(`[${FUNCTION_NAME}] Ground truth insert error:`, gtError);
        } else {
          groundTruthCount = gtData?.length || 0;
        }
      }
    }

    console.log(`[${FUNCTION_NAME}] Saved ${groundTruthCount} ground truth facts`);

    // Update progress
    await supabase
      .from('website_scrape_jobs')
      .update({
        ground_truth_facts: groundTruthCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', job_id);

    // =========================================
    // STEP 4: Update business profile
    // =========================================
    
    if (extractedData.business_info || extractedData.search_keywords) {
      const bi = extractedData.business_info || {};
      await supabase
        .from('business_profile')
        .upsert({
          workspace_id,
          business_name: bi.name || 'My Business',
          services: bi.services || [],
          service_area: bi.service_area,
          phone: bi.phone,
          email: bi.email,
          website: website_url,
          search_keywords: extractedData.search_keywords || [],
          updated_at: new Date().toISOString()
        }, { onConflict: 'workspace_id' });
    }

    // =========================================
    // STEP 5: Save voice profile
    // =========================================
    
    if (extractedData.voice_profile) {
      const vp = extractedData.voice_profile;
      await supabase
        .from('voice_profiles')
        .upsert({
          workspace_id,
          tone: vp.tone || 'professional',
          greeting_style: vp.greeting_style || '',
          sample_phrases: vp.sample_phrases || [],
          source: 'website_analysis',
          updated_at: new Date().toISOString()
        }, { onConflict: 'workspace_id' });
    }

    // =========================================
    // STEP 6: Update workspace flags
    // =========================================
    
    await supabase
      .from('workspaces')
      .update({
        website_url,
        ground_truth_generated: true,
        knowledge_base_status: 'website_analyzed'
      })
      .eq('id', workspace_id);

    // =========================================
    // STEP 7: Mark job as completed
    // =========================================
    
    await supabase
      .from('website_scrape_jobs')
      .update({
        status: 'completed',
        business_info: extractedData.business_info,
        voice_profile: extractedData.voice_profile,
        search_keywords: extractedData.search_keywords,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', job_id);

    console.log(`[${FUNCTION_NAME}] Job completed: ${faqsCreated} FAQs, ${groundTruthCount} facts`);

    return new Response(
      JSON.stringify({
        success: true,
        job_id,
        faqs_extracted: faqsCreated,
        ground_truth_facts: groundTruthCount,
        search_keywords: extractedData.search_keywords || [],
        business_info: extractedData.business_info
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[${FUNCTION_NAME}] Error:`, error.message);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: FUNCTION_NAME
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
