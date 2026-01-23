import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'kb-discover-competitors';

// Directories and aggregators to exclude
const BLOCKLIST = [
  'yell.com', 'yelp.com', 'checkatrade.com', 'bark.com', 'trustatrader.com',
  'mybuilder.com', 'rated-people.com', 'trustpilot.com', 'facebook.com',
  'instagram.com', 'twitter.com', 'linkedin.com', 'youtube.com',
  'gumtree.com', 'freeindex.co.uk', 'google.com', 'wikipedia.org',
  'pinterest.com', 'tiktok.com', 'reddit.com', 'amazon.com', 'ebay.com',
  'nextdoor.com', 'gov.uk', 'nhs.uk', 'which.co.uk', 'moneysupermarket.com',
  'comparethemarket.com', 'thomsonlocal.com', 'x.com'
];

interface DiscoveredCompetitor {
  name: string;
  website: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');

    const { job_id, workspace_id } = await req.json();

    if (!job_id) throw new Error('job_id is required');
    if (!workspace_id) throw new Error('workspace_id is required');

    console.log(`[${FUNCTION_NAME}] Starting competitor discovery for job:`, job_id);

    // Update job status
    await supabase
      .from('competitor_research_jobs')
      .update({
        status: 'discovering',
        heartbeat_at: new Date().toISOString()
      })
      .eq('id', job_id);

    // STEP 1: Load search_keywords and website from business_profile
    const { data: profile, error: profileError } = await supabase
      .from('business_profile')
      .select('search_keywords, website, service_area, formatted_address')
      .eq('workspace_id', workspace_id)
      .single();

    if (profileError || !profile) {
      throw new Error('Business profile not found. Please run website analysis first.');
    }

    const searchKeywords = profile.search_keywords || [];
    if (searchKeywords.length === 0) {
      throw new Error('No search keywords. Run website analysis first.');
    }

    const userWebsiteUrl = profile.website || '';
    const serviceArea = profile.service_area || profile.formatted_address || '';
    
    // Get user's domain to exclude
    let userDomain = '';
    if (userWebsiteUrl) {
      try {
        userDomain = new URL(userWebsiteUrl).hostname.replace('www.', '').toLowerCase();
      } catch (e) {
        console.warn(`[${FUNCTION_NAME}] Could not parse user website URL:`, userWebsiteUrl);
      }
    }

    console.log(`[${FUNCTION_NAME}] Using keywords:`, searchKeywords.slice(0, 5));
    console.log(`[${FUNCTION_NAME}] Service area:`, serviceArea);
    console.log(`[${FUNCTION_NAME}] User domain to exclude:`, userDomain);

    // STEP 2: For each keyword, call Gemini with Google Grounding
    const allCompetitors: DiscoveredCompetitor[] = [];
    const keywordsToUse = searchKeywords.slice(0, 5);

    for (let i = 0; i < keywordsToUse.length; i++) {
      const keyword = keywordsToUse[i];
      const searchQuery = serviceArea ? `${keyword} ${serviceArea}` : keyword;
      
      console.log(`[${FUNCTION_NAME}] Searching for keyword ${i + 1}/${keywordsToUse.length}: "${searchQuery}"`);

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: `Search Google for: "${searchQuery}"

I need a list of REAL LOCAL BUSINESSES with their websites.

IMPORTANT RULES:
1. Only include actual service provider businesses (companies that DO the work)
2. EXCLUDE all of these:
   - Directory sites (Yell, Checkatrade, Bark, Yelp, Trustpilot, etc.)
   - Lead generation sites
   - Social media profiles (Facebook, Instagram, LinkedIn, etc.)
   - News articles or blog posts
   ${userWebsiteUrl ? `- The business website: ${userWebsiteUrl}` : ''}
3. Only include businesses with their own website domain

Return a JSON array:
[{"name": "Business Name", "website": "https://theirwebsite.com"}, ...]

Find up to 15 real local businesses. Return ONLY the JSON array.`
                }]
              }],
              tools: [{
                googleSearch: {}
              }],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 2000
              }
            })
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[${FUNCTION_NAME}] Gemini API error for keyword "${keyword}":`, response.status, errorText);
          continue;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Parse JSON from response
        const jsonMatch = text.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          try {
            const competitors = JSON.parse(jsonMatch[0]) as DiscoveredCompetitor[];
            console.log(`[${FUNCTION_NAME}] Found ${competitors.length} competitors for "${keyword}"`);
            allCompetitors.push(...competitors);
          } catch (parseErr) {
            console.warn(`[${FUNCTION_NAME}] Failed to parse JSON for keyword "${keyword}":`, parseErr);
          }
        } else {
          console.warn(`[${FUNCTION_NAME}] No JSON array found in response for "${keyword}"`);
        }

        // Rate limit: wait 1.5 seconds between calls
        if (i < keywordsToUse.length - 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (err) {
        console.error(`[${FUNCTION_NAME}] Error searching for "${keyword}":`, err);
      }
    }

    console.log(`[${FUNCTION_NAME}] Total raw competitors found: ${allCompetitors.length}`);

    // STEP 3: Deduplicate and filter results
    const uniqueCompetitors = new Map<string, DiscoveredCompetitor>();
    
    for (const comp of allCompetitors) {
      if (!comp.website) continue;
      
      try {
        const domain = new URL(comp.website).hostname.replace('www.', '').toLowerCase();
        
        // Skip user's own site
        if (userDomain && domain === userDomain) continue;
        
        // Skip blocklisted domains
        if (BLOCKLIST.some(blocked => domain.includes(blocked))) continue;
        
        // Skip duplicates
        if (uniqueCompetitors.has(domain)) continue;
        
        uniqueCompetitors.set(domain, comp);
      } catch (e) {
        // Invalid URL, skip
      }
    }

    const finalCompetitors = Array.from(uniqueCompetitors.values()).slice(0, 40);
    console.log(`[${FUNCTION_NAME}] After dedup/filter: ${finalCompetitors.length} competitors`);

    // STEP 4: Insert into competitor_sites table
    if (finalCompetitors.length > 0) {
      const sitesToInsert = finalCompetitors.map(comp => {
        let domain = '';
        try {
          domain = new URL(comp.website).hostname.replace('www.', '').toLowerCase();
        } catch {
          domain = comp.website;
        }
        
        return {
          job_id,
          workspace_id,
          domain,
          url: comp.website,
          business_name: comp.name,
          discovery_source: 'gemini_grounded',
          status: 'approved',
          scrape_status: 'pending',
          discovered_at: new Date().toISOString()
        };
      });

      const { error: insertError } = await supabase
        .from('competitor_sites')
        .upsert(sitesToInsert, { 
          onConflict: 'job_id,domain',
          ignoreDuplicates: true 
        });

      if (insertError) {
        console.error(`[${FUNCTION_NAME}] Insert error:`, insertError);
      }
    }

    // STEP 5: Update job with discovery results
    await supabase
      .from('competitor_research_jobs')
      .update({
        status: 'sites_ready',
        sites_discovered: finalCompetitors.length,
        sites_approved: finalCompetitors.length,
        search_queries: keywordsToUse.map((k: string) => serviceArea ? `${k} ${serviceArea}` : k),
        heartbeat_at: new Date().toISOString()
      })
      .eq('id', job_id);

    // Update workspace status
    await supabase
      .from('workspaces')
      .update({ knowledge_base_status: 'competitors_discovered' })
      .eq('id', workspace_id);

    const duration = Date.now() - startTime;
    console.log(`[${FUNCTION_NAME}] Completed in ${duration}ms: ${finalCompetitors.length} competitors`);

    return new Response(
      JSON.stringify({
        success: true,
        job_id,
        competitors_found: finalCompetitors.length,
        competitors: finalCompetitors.map(c => ({
          name: c.name,
          website: c.website
        })),
        keywords_used: keywordsToUse,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
