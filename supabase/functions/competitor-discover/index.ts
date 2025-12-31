import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId, workspaceId, nicheQuery, serviceArea, targetCount = 100, excludeDomains = [] } = await req.json();
    console.log('Competitor discovery started:', { jobId, nicheQuery, serviceArea, targetCount });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!FIRECRAWL_API_KEY) {
      console.error('FIRECRAWL_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'Firecrawl not configured' }), {
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

    // Default exclude list + user provided
    const defaultExclude = [
      'yell.com', 'checkatrade.com', 'bark.com', 'trustpilot.com', 
      'facebook.com', 'instagram.com', 'linkedin.com', 'maps.google.com',
      'yelp.com', 'gumtree.com', 'freeindex.co.uk', 'cylex-uk.co.uk',
      'hotfrog.co.uk', 'thebestof.co.uk', 'google.com', 'youtube.com',
      'twitter.com', 'x.com', 'pinterest.com', 'tiktok.com',
      'amazon.com', 'ebay.com', 'wikipedia.org', 'gov.uk',
      'indeed.com', 'glassdoor.com', 'reed.co.uk',
    ];
    const allExcludeDomains = [...new Set([...defaultExclude, ...excludeDomains])];

    // Build search queries
    const searchQueries = [
      `${nicheQuery} ${serviceArea || ''}`,
      `${nicheQuery} services ${serviceArea || ''}`,
      `${nicheQuery} company ${serviceArea || ''}`,
      `best ${nicheQuery} near me ${serviceArea || ''}`,
      `${nicheQuery} quotes ${serviceArea || ''}`,
    ];

    const discoveredSites = new Map<string, { url: string; title: string; description: string }>();

    // Run searches
    for (const query of searchQueries) {
      if (discoveredSites.size >= targetCount * 2) break; // Get extra to allow for filtering

      try {
        console.log('Searching:', query);
        
        const searchResponse = await fetch('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            limit: 20,
            scrapeOptions: { formats: ['markdown'] },
          }),
        });

        if (!searchResponse.ok) {
          console.error('Search failed:', searchResponse.status);
          continue;
        }

        const searchData = await searchResponse.json();
        const results = searchData.data || [];

        for (const result of results) {
          try {
            const url = new URL(result.url);
            const domain = url.hostname.replace(/^www\./, '').toLowerCase();

            // Skip excluded domains
            if (allExcludeDomains.some(ex => domain.includes(ex) || ex.includes(domain))) {
              continue;
            }

            // Skip if already discovered
            if (discoveredSites.has(domain)) continue;

            discoveredSites.set(domain, {
              url: result.url,
              title: result.title || domain,
              description: result.description || '',
            });

          } catch (urlError) {
            console.error('Invalid URL:', result.url);
          }
        }

        // Small delay between searches
        await new Promise(r => setTimeout(r, 500));

      } catch (searchError) {
        console.error('Search error:', searchError);
      }
    }

    console.log(`Discovered ${discoveredSites.size} unique domains`);

    // Use AI to filter out directories/aggregators
    const sitesToFilter = Array.from(discoveredSites.entries()).slice(0, targetCount * 1.5);
    const approvedSites: Array<{ domain: string; url: string; title: string; description: string }> = [];
    const rejectedSites: Array<{ domain: string; reason: string }> = [];

    if (LOVABLE_API_KEY && sitesToFilter.length > 0) {
      // Batch filter with AI
      const filterPrompt = `You are analyzing websites to determine if they are genuine ${nicheQuery} companies or directory/aggregator sites.

For each domain, respond with:
- "COMPANY" if it appears to be a genuine business offering ${nicheQuery} services
- "DIRECTORY" if it's a listing site, marketplace, comparison site, or aggregator
- "IRRELEVANT" if it's not related to ${nicheQuery}

Domains to analyze:
${sitesToFilter.map(([domain, info], i) => `${i + 1}. ${domain} - "${info.title}" - ${info.description?.substring(0, 100) || 'No description'}`).join('\n')}

Respond with ONLY a JSON array like: [{"domain": "example.com", "type": "COMPANY"}, ...]`;

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
              { role: 'system', content: 'You are a web classifier. Output valid JSON only.' },
              { role: 'user', content: filterPrompt }
            ],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || '';
          
          // Extract JSON from response
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const classifications = JSON.parse(jsonMatch[0]);
            
            for (const classification of classifications) {
              const siteInfo = discoveredSites.get(classification.domain);
              if (!siteInfo) continue;

              if (classification.type === 'COMPANY') {
                approvedSites.push({
                  domain: classification.domain,
                  ...siteInfo
                });
              } else {
                rejectedSites.push({
                  domain: classification.domain,
                  reason: classification.type
                });
              }
            }
          }
        }
      } catch (aiError) {
        console.error('AI filtering error:', aiError);
        // Fallback: approve all discovered sites
        for (const [domain, info] of sitesToFilter) {
          approvedSites.push({ domain, ...info });
        }
      }
    } else {
      // No AI available, approve all
      for (const [domain, info] of sitesToFilter) {
        approvedSites.push({ domain, ...info });
      }
    }

    // Limit to target count
    const finalSites = approvedSites.slice(0, targetCount);

    console.log(`Approved ${finalSites.length} sites, rejected ${rejectedSites.length}`);

    // Insert sites into database
    if (finalSites.length > 0) {
      const sitesToInsert = finalSites.map(site => ({
        job_id: jobId,
        workspace_id: workspaceId,
        domain: site.domain,
        url: site.url,
        title: site.title,
        description: site.description,
        status: 'approved',
        is_directory: false,
      }));

      await supabase.from('competitor_sites').insert(sitesToInsert);
    }

    // Insert rejected sites for audit
    if (rejectedSites.length > 0) {
      const rejectsToInsert = rejectedSites.slice(0, 50).map(site => ({
        job_id: jobId,
        workspace_id: workspaceId,
        domain: site.domain,
        url: discoveredSites.get(site.domain)?.url || `https://${site.domain}`,
        title: discoveredSites.get(site.domain)?.title || site.domain,
        status: 'rejected',
        is_directory: site.reason === 'DIRECTORY',
        rejection_reason: site.reason,
      }));

      await supabase.from('competitor_sites').insert(rejectsToInsert);
    }

    // Update job progress
    await supabase.from('competitor_research_jobs').update({
      sites_discovered: discoveredSites.size,
      sites_approved: finalSites.length,
      status: finalSites.length > 0 ? 'scraping' : 'error',
      error_message: finalSites.length === 0 ? 'No competitor sites found' : null,
    }).eq('id', jobId);

    // If we have sites, trigger the scraping worker
    if (finalSites.length > 0) {
      supabase.functions.invoke('competitor-scrape-worker', {
        body: { jobId, workspaceId }
      }).catch(err => console.error('Failed to start scraper:', err));
    }

    return new Response(JSON.stringify({
      success: true,
      discovered: discoveredSites.size,
      approved: finalSites.length,
      rejected: rejectedSites.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Discovery error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
