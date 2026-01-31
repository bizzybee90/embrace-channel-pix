import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SearchResult {
  url: string;
  title: string;
  description?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, location, niche } = await req.json();
    
    if (!query || query.trim().length < 3) {
      return new Response(JSON.stringify({ suggestions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      throw new Error("FIRECRAWL_API_KEY is not configured");
    }

    // Build smarter search query with niche and location context
    let searchQuery = query;
    if (niche) {
      searchQuery += ` ${niche}`;
    }
    if (location) {
      searchQuery += ` ${location}`;
    }
    searchQuery += ' UK';

    console.log("Searching for:", searchQuery);

    // Use Firecrawl's search endpoint
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: searchQuery,
        limit: 10,
        scrapeOptions: {
          formats: ["markdown"],
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Firecrawl error:", response.status, errorText);
      throw new Error(`Firecrawl API error: ${response.status}`);
    }

    const data = await response.json();
    console.log("Firecrawl response:", JSON.stringify(data).slice(0, 500));

    // Known directories to filter out
    const blocklist = [
      'yell.com', 'checkatrade.com', 'bark.com', 'trustatrader.com', 
      'mybuilder.com', 'rated-people.com', 'trustpilot.com', 'houzz.co.uk',
      'yelp.com', 'freeindex.co.uk', 'gumtree.com', 'facebook.com',
      'google.com', 'gov.uk', 'wikipedia.org', 'youtube.com', 'instagram.com',
      'linkedin.com', 'twitter.com', 'pinterest.com', 'amazon.co.uk', 'ebay.co.uk'
    ];

    // Extract and filter results
    const results: SearchResult[] = (data.data || [])
      .map((item: any) => {
        try {
          const urlObj = new URL(item.url);
          const domain = urlObj.hostname.replace(/^www\./, '').toLowerCase();
          
          // Filter out directories
          if (blocklist.some(blocked => domain.includes(blocked))) {
            return null;
          }
          
          return {
            url: item.url,
            domain,
            title: item.title || domain,
            description: item.description || item.markdown?.slice(0, 150),
          };
        } catch {
          return null;
        }
      })
      .filter((item: SearchResult | null): item is SearchResult => item !== null);

    // Deduplicate by domain
    const seen = new Set<string>();
    const unique = results.filter((r: any) => {
      if (seen.has(r.domain)) return false;
      seen.add(r.domain);
      return true;
    });

    return new Response(JSON.stringify({ suggestions: unique.slice(0, 8) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Search error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Search failed",
        suggestions: [] 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
