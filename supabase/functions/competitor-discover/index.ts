import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'competitor-discover';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY');
    if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');

    const body = await req.json();
    console.log(`[${functionName}] Starting:`, { workspace_id: body.workspace_id });

    if (!body.workspace_id) throw new Error('workspace_id is required');

    // Get business profile
    const { data: profile } = await supabase
      .from('business_profile')
      .select('*')
      .eq('workspace_id', body.workspace_id)
      .single();

    if (!profile) {
      throw new Error('Business profile not found. Please set your location first.');
    }

    const location = profile.formatted_address || profile.county || profile.service_area || 'UK';
    const keywords = profile.search_keywords || [profile.industry || 'local business'];
    const radius = profile.service_radius_miles || 25;

    console.log(`[${functionName}] Searching for:`, { location, keywords, radius });

    // Create a research job
    const { data: job, error: jobError } = await supabase
      .from('competitor_research_jobs')
      .insert({
        workspace_id: body.workspace_id,
        niche_query: keywords.join(', '),
        location: location,
        radius_miles: radius,
        status: 'discovering',
        started_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString()
      })
      .select()
      .single();

    if (jobError) throw jobError;

    // Use Gemini with Google Search to find competitors
    const prompt = `Find 15-20 ${keywords.join(' / ')} businesses within ${radius} miles of ${location}.

Use Google Search to find real, currently operating businesses. 

EXCLUDE these domains: yell.com, checkatrade.com, bark.com, trustpilot.com, facebook.com, instagram.com, linkedin.com, yelp.com, gumtree.com, freeindex.co.uk, thomsonlocal.com, twitter.com, youtube.com, pinterest.com, x.com, trustatrader.com, mybuilder.com, ratedpeople.com, google.com, bing.com, yahoo.com, wikipedia.org, amazon.co.uk, ebay.co.uk, gov.uk, nhs.uk

For each business found, provide:
- Business name
- Website URL (their actual website, not a directory listing)
- City/town
- Approximate distance from ${location}
- Google rating if available

Respond with ONLY a JSON array:
[
  {
    "name": "ABC Window Cleaning",
    "website": "https://abcwindowcleaning.co.uk",
    "city": "Dunstable",
    "distance_miles": 5,
    "rating": 4.8,
    "review_count": 45
  }
]

Only include businesses with actual websites. Skip any without a website.`;

    const geminiResponse = await fetch(`${GEMINI_API}?key=${GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{
          google_search: {}  // Enable Google grounding
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096
        }
      })
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error(`[${functionName}] Gemini API error:`, errorText);
      
      // Update job with error
      await supabase
        .from('competitor_research_jobs')
        .update({
          status: 'error',
          error_message: `Gemini API error: ${geminiResponse.status}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);
        
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiData = await geminiResponse.json();
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log(`[${functionName}] Gemini response length:`, responseText.length);

    // Parse competitors
    let competitors: any[];
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found');
      competitors = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`[${functionName}] Parse error:`, responseText.substring(0, 500));
      
      // Update job with error
      await supabase
        .from('competitor_research_jobs')
        .update({
          status: 'error',
          error_message: 'Failed to parse competitor list from AI response',
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);
        
      throw new Error('Failed to parse competitor list');
    }

    // Filter and dedupe
    const seenUrls = new Set<string>();
    const validCompetitors = competitors.filter(c => {
      if (!c.website || !c.name) return false;
      
      try {
        const hostname = new URL(c.website).hostname.toLowerCase();
        if (seenUrls.has(hostname)) return false;
        seenUrls.add(hostname);
        return true;
      } catch {
        return false;
      }
    });

    console.log(`[${functionName}] Valid competitors after filtering:`, validCompetitors.length);

    // Insert competitors
    const competitorsToInsert = validCompetitors.map(c => {
      let domain: string;
      try {
        domain = new URL(c.website).hostname.replace('www.', '').toLowerCase();
      } catch {
        domain = c.website;
      }
      
      return {
        job_id: job.id,
        workspace_id: body.workspace_id,
        domain: domain,
        url: c.website,
        business_name: c.name,
        city: c.city || null,
        distance_miles: c.distance_miles || null,
        rating: c.rating || null,
        review_count: c.review_count || null,
        status: 'discovered',
        is_valid: true,
        scrape_status: 'pending',
        discovery_source: 'gemini_grounded',
        discovered_at: new Date().toISOString()
      };
    });

    if (competitorsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('competitor_sites')
        .insert(competitorsToInsert);
        
      if (insertError) {
        console.error(`[${functionName}] Insert error:`, insertError);
      }
    }

    // Update job
    await supabase
      .from('competitor_research_jobs')
      .update({
        sites_discovered: validCompetitors.length,
        sites_approved: validCompetitors.length,
        status: validCompetitors.length > 0 ? 'discovered' : 'error',
        error_message: validCompetitors.length === 0 ? 'No competitor sites found' : null,
        updated_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString()
      })
      .eq('id', job.id);

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms: ${validCompetitors.length} competitors`);

    return new Response(
      JSON.stringify({ 
        success: true,
        job_id: job.id,
        competitors_found: validCompetitors.length,
        competitors: validCompetitors,
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
