import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LocationData {
  displayName: string;
  placeId?: string;
  countryCode?: string;
  postcode?: string;
  lat?: number;
  lng?: number;
  radius?: number;
}

interface DiscoveredCompetitor {
  company_name: string;
  website_url: string;
  location_verified: boolean;
  evidence: string;
  source: 'search' | 'maps';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      jobId, 
      workspaceId, 
      nicheQuery, 
      serviceArea, 
      locationData,
      targetCount = 100, 
      excludeDomains = [] 
    } = await req.json();
    
    console.log('Smart competitor discovery started:', { jobId, nicheQuery, serviceArea, locationData, targetCount });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Update job status
    await supabase.from('competitor_research_jobs').update({
      status: 'discovering',
      started_at: new Date().toISOString(),
    }).eq('id', jobId);

    // Parse location data for geo-filtering
    const parsedLocation: LocationData = locationData || parseServiceArea(serviceArea);
    const countryCode = parsedLocation.countryCode || 'GB';
    const isUK = countryCode === 'GB';
    const countryName = isUK ? 'United Kingdom' : 'United States';
    const searchLang = isUK ? 'en-GB' : 'en-US';

    console.log('Location context:', { parsedLocation, countryCode, isUK });

    // Default exclude list + user provided + country-specific
    const defaultExclude = [
      'yell.com', 'checkatrade.com', 'bark.com', 'trustpilot.com', 
      'facebook.com', 'instagram.com', 'linkedin.com', 'maps.google.com',
      'yelp.com', 'gumtree.com', 'freeindex.co.uk', 'cylex-uk.co.uk',
      'hotfrog.co.uk', 'thebestof.co.uk', 'google.com', 'youtube.com',
      'twitter.com', 'x.com', 'pinterest.com', 'tiktok.com',
      'amazon.com', 'ebay.com', 'wikipedia.org', 'gov.uk',
      'indeed.com', 'glassdoor.com', 'reed.co.uk', 'thumbtack.com',
      'homeadvisor.com', 'angi.com', 'angieslist.com', 'houzz.com',
      'nextdoor.com', 'craigslist.org', 'yellowpages.com',
    ];
    
    // Add country-specific exclusions
    if (isUK) {
      // Exclude obvious US domains when searching UK
      defaultExclude.push('.com.au', '.nz', '.ca');
    }
    
    const allExcludeDomains = [...new Set([...defaultExclude, ...excludeDomains])];

    // Use Gemini to discover local competitors with web search
    const discoveryPrompt = `You are researching ${nicheQuery} businesses that genuinely serve ${parsedLocation.displayName || serviceArea} in ${countryName}.

CRITICAL LOCATION REQUIREMENTS:
- User is in: ${parsedLocation.displayName || serviceArea}
- Country: ${countryName} (${countryCode})
${parsedLocation.postcode ? `- Postcode area: ${parsedLocation.postcode}` : ''}
${parsedLocation.radius ? `- Service radius: ${parsedLocation.radius} miles` : ''}

SEARCH STRATEGY:
1. Search for "${nicheQuery} ${parsedLocation.displayName || serviceArea}"
2. Look for businesses with ${isUK ? 'UK phone numbers (+44, 01234, 07xxx), UK addresses, .co.uk domains' : 'US phone numbers, US addresses, .com domains'}
3. Consider Google Maps/local business listings in the area
4. Check for service area mentions on their websites

EXCLUDE:
- Directory sites (Checkatrade, Bark, Yell, Thumbtack, etc.)
- Businesses clearly located in other countries
- National franchises without local presence
- Inactive/closed businesses

For each competitor found, provide:
- company_name: The business name
- website_url: Their website (prefer ${isUK ? '.co.uk' : '.com'} domains)
- location_verified: true if you found evidence they serve this area
- evidence: What confirmed their location (e.g., "UK phone 01234 567890", "Address mentions ${parsedLocation.displayName}", "Google Maps listing")
- source: "search" for web search, "maps" for Google Maps/local listings

Find ${Math.min(targetCount, 50)} genuine local ${nicheQuery} businesses.

IMPORTANT: Only include businesses that GENUINELY serve ${parsedLocation.displayName || serviceArea}, ${countryName}. 
A window cleaner in Florida, USA should NEVER appear when searching for Luton, UK.

Respond with ONLY a valid JSON array:
[{"company_name": "...", "website_url": "https://...", "location_verified": true, "evidence": "...", "source": "search"}, ...]`;

    console.log('Calling Gemini for smart discovery...');

    let discoveredCompetitors: DiscoveredCompetitor[] = [];

    try {
      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { 
              role: 'system', 
              content: `You are a local business researcher specializing in finding genuine ${nicheQuery} companies in specific geographic areas. You have access to web search and Google Maps data. Output valid JSON only.` 
            },
            { role: 'user', content: discoveryPrompt }
          ],
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error('Gemini API error:', aiResponse.status, errorText);
        throw new Error(`Gemini API error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content || '';
      
      console.log('Gemini response length:', content.length);

      // Extract JSON from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        discoveredCompetitors = JSON.parse(jsonMatch[0]);
        console.log(`Gemini found ${discoveredCompetitors.length} competitors`);
      }
    } catch (aiError) {
      console.error('Gemini discovery error:', aiError);
    }

    // Supplement with Firecrawl search if we need more or Gemini failed
    if (FIRECRAWL_API_KEY && discoveredCompetitors.length < targetCount) {
      console.log('Supplementing with Firecrawl search...');
      
      const searchQueries = [
        `${nicheQuery} ${parsedLocation.displayName || serviceArea}`,
        `${nicheQuery} services ${parsedLocation.displayName || serviceArea}`,
      ];

      // Add UK-specific site filters
      if (isUK) {
        searchQueries.push(`${nicheQuery} ${parsedLocation.displayName} site:.co.uk`);
      }

      const existingDomains = new Set(
        discoveredCompetitors.map(c => extractDomain(c.website_url))
      );

      for (const query of searchQueries) {
        if (discoveredCompetitors.length >= targetCount) break;

        try {
          const searchResponse = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query,
              limit: 20,
              country: countryCode,
              lang: searchLang,
              scrapeOptions: { formats: ['markdown'] },
            }),
          });

          if (!searchResponse.ok) continue;

          const searchData = await searchResponse.json();
          const results = searchData.data || [];

          for (const result of results) {
            try {
              const domain = extractDomain(result.url);
              
              // Skip excluded or already found domains
              if (allExcludeDomains.some(ex => domain.includes(ex) || ex.includes(domain))) continue;
              if (existingDomains.has(domain)) continue;

              // Quick domain-based country check
              if (isUK && (domain.endsWith('.com.au') || domain.endsWith('.nz') || domain.endsWith('.ca'))) {
                continue;
              }

              existingDomains.add(domain);
              discoveredCompetitors.push({
                company_name: result.title || domain,
                website_url: result.url,
                location_verified: false,
                evidence: 'Found via web search - needs verification',
                source: 'search',
              });

            } catch (urlError) {
              console.error('Invalid URL:', result.url);
            }
          }

          await new Promise(r => setTimeout(r, 500));
        } catch (searchError) {
          console.error('Firecrawl search error:', searchError);
        }
      }
    }

    // Now use Gemini to verify geographic relevance of all found sites
    if (LOVABLE_API_KEY && discoveredCompetitors.length > 0) {
      console.log('Verifying geographic relevance...');
      
      const verifyPrompt = `Verify which of these businesses genuinely serve ${parsedLocation.displayName || serviceArea}, ${countryName}.

For each business, check:
1. Is the domain appropriate for ${countryName}? (${isUK ? '.co.uk preferred over .com' : '.com is fine'})
2. Does the business name suggest a local/regional company?
3. Would this business logically serve ${parsedLocation.displayName || serviceArea}?

Businesses to verify:
${discoveredCompetitors.slice(0, 80).map((c, i) => 
  `${i + 1}. ${c.company_name} - ${c.website_url} - Evidence: ${c.evidence}`
).join('\n')}

For each business, respond with:
- "APPROVED" if it appears to genuinely serve this area
- "REJECTED" + reason if it's in the wrong country/area or is a directory

Respond with ONLY a valid JSON array:
[{"company_name": "...", "status": "APPROVED"}, {"company_name": "...", "status": "REJECTED", "reason": "US company, not UK"}]`;

      try {
        const verifyResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'You are a geographic verification assistant. Output valid JSON only.' },
              { role: 'user', content: verifyPrompt }
            ],
          }),
        });

        if (verifyResponse.ok) {
          const verifyData = await verifyResponse.json();
          const verifyContent = verifyData.choices?.[0]?.message?.content || '';
          
          const jsonMatch = verifyContent.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const verifications = JSON.parse(jsonMatch[0]);
            const verificationMap = new Map(
              verifications.map((v: any) => [v.company_name, v])
            );

            // Filter out rejected sites
            discoveredCompetitors = discoveredCompetitors.filter(c => {
              const verification = verificationMap.get(c.company_name) as { status?: string } | undefined;
              if (!verification) return true; // Keep if not in verification list
              return verification.status === 'APPROVED';
            });

            console.log(`After verification: ${discoveredCompetitors.length} competitors`);
          }
        }
      } catch (verifyError) {
        console.error('Verification error:', verifyError);
      }
    }

    // Limit to target count
    const finalCompetitors = discoveredCompetitors.slice(0, targetCount);

    console.log(`Final approved: ${finalCompetitors.length} competitors`);

    // Insert sites into database
    if (finalCompetitors.length > 0) {
      const sitesToInsert = finalCompetitors.map(site => ({
        job_id: jobId,
        workspace_id: workspaceId,
        domain: extractDomain(site.website_url),
        url: site.website_url,
        title: site.company_name,
        description: site.evidence,
        status: 'approved',
        is_directory: false,
      }));

      await supabase.from('competitor_sites').insert(sitesToInsert);
    }

    // Update job progress
    await supabase.from('competitor_research_jobs').update({
      sites_discovered: discoveredCompetitors.length,
      sites_approved: finalCompetitors.length,
      status: finalCompetitors.length > 0 ? 'scraping' : 'error',
      error_message: finalCompetitors.length === 0 ? 'No local competitor sites found' : null,
    }).eq('id', jobId);

    // If we have sites, trigger the scraping worker
    if (finalCompetitors.length > 0) {
      supabase.functions.invoke('competitor-scrape-worker', {
        body: { jobId, workspaceId, nicheQuery, serviceArea }
      }).catch(err => console.error('Failed to start scraper:', err));
    }

    return new Response(JSON.stringify({
      success: true,
      discovered: discoveredCompetitors.length,
      approved: finalCompetitors.length,
      countryCode,
      locationVerified: parsedLocation.displayName || serviceArea,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Smart discovery error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Helper to extract domain from URL
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
}

// Parse service area string into structured location data
function parseServiceArea(serviceArea: string): LocationData {
  if (!serviceArea) return { displayName: '' };
  
  // Parse "Luton, Bedfordshire (20 miles)" format
  const radiusMatch = serviceArea.match(/^(.+?)\s*\((\d+)\s*miles?\)$/i);
  const name = radiusMatch ? radiusMatch[1].trim() : serviceArea;
  const radius = radiusMatch ? parseInt(radiusMatch[2], 10) : undefined;
  
  // Try to detect country from common UK/US patterns
  let countryCode = 'GB'; // Default to UK
  const lowerName = name.toLowerCase();
  
  // US state abbreviations or common US cities
  const usIndicators = [
    'california', 'texas', 'florida', 'new york', 'illinois',
    ', ca', ', tx', ', fl', ', ny', ', il', ', az', ', wa',
    'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia',
  ];
  
  if (usIndicators.some(ind => lowerName.includes(ind))) {
    countryCode = 'US';
  }
  
  return {
    displayName: name,
    countryCode,
    radius,
  };
}
