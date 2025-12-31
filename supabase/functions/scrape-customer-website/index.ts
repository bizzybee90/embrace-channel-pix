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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

    const { workspaceId, websiteUrl, businessName, businessType } = await req.json();

    console.log('=== SCRAPE CUSTOMER WEBSITE STARTED ===');
    console.log(`Workspace: ${workspaceId}`);
    console.log(`Website URL: ${websiteUrl}`);
    console.log(`Business: ${businessName} (${businessType})`);
    console.log(`Firecrawl key present: ${!!FIRECRAWL_API_KEY}`);
    console.log(`Anthropic key present: ${!!ANTHROPIC_API_KEY}`);
    console.log(`OpenAI key present: ${!!OPENAI_API_KEY}`);

    if (!websiteUrl) {
      return new Response(JSON.stringify({ 
        success: true, 
        faqsGenerated: 0,
        pagesScraped: 0,
        message: 'No website URL provided'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!FIRECRAWL_API_KEY) {
      console.error('FIRECRAWL_API_KEY not configured');
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Firecrawl not configured' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update status
    await supabase
      .from('business_context')
      .update({ 
        knowledge_base_status: 'scraping',
        knowledge_base_started_at: new Date().toISOString()
      })
      .eq('workspace_id', workspaceId);

    // Format URL
    let formattedUrl = websiteUrl.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    // STEP 1: Start Firecrawl crawl job
    console.log('Starting Firecrawl crawl...');
    const crawlResponse = await fetch('https://api.firecrawl.dev/v1/crawl', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: formattedUrl,
        limit: 30,
        scrapeOptions: { 
          formats: ['markdown'],
          onlyMainContent: true
        }
      })
    });

    if (!crawlResponse.ok) {
      const errorText = await crawlResponse.text();
      console.error('Firecrawl error:', crawlResponse.status, errorText);
      throw new Error(`Firecrawl error: ${crawlResponse.status}`);
    }

    const { id: jobId } = await crawlResponse.json();
    console.log(`Crawl job started: ${jobId}`);

    // STEP 2: Poll for completion (max 3 minutes)
    let crawlData = null;
    for (let i = 0; i < 36; i++) {
      await new Promise(r => setTimeout(r, 5000));
      
      const statusResponse = await fetch(
        `https://api.firecrawl.dev/v1/crawl/${jobId}`,
        { headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}` } }
      );
      
      const status = await statusResponse.json();
      console.log(`Poll ${i + 1}: status = ${status.status}, completed = ${status.completed || 0}`);
      
      if (status.status === 'completed') {
        crawlData = status.data;
        break;
      }
      if (status.status === 'failed') {
        throw new Error('Crawl failed');
      }
    }

    if (!crawlData || crawlData.length === 0) {
      console.log('No content found from crawl');
      await supabase
        .from('business_context')
        .update({ 
          knowledge_base_status: 'complete',
          knowledge_base_completed_at: new Date().toISOString(),
          website_faqs_generated: 0
        })
        .eq('workspace_id', workspaceId);

      return new Response(JSON.stringify({
        success: true,
        pagesScraped: 0,
        faqsGenerated: 0,
        message: 'No content found on website'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Crawl complete: ${crawlData.length} pages`);

    // STEP 3: Generate FAQs with Claude
    const allContent = crawlData
      .map((page: any) => {
        const url = page.metadata?.sourceURL || page.url || '';
        const markdown = page.markdown || '';
        return `--- PAGE: ${url} ---\n${markdown}`;
      })
      .filter((c: string) => c.length > 100)
      .join('\n\n')
      .slice(0, 80000); // Larger context for more FAQs

    const prompt = `You are extracting FAQs from a ${businessType || 'business'} website for "${businessName}".

Your goal is to generate as many SPECIFIC, USEFUL Q&A pairs as possible. These FAQs will be used by an AI to answer customer questions, so they must contain EXACT information.

WEBSITE CONTENT:
${allContent}

EXTRACT FAQs FOR EACH CATEGORY:

**PRICING** (generate multiple FAQs per service):
- What is the exact price for [service]? Include currency (£) and any variations
- What are the minimum charges?
- Are there any additional fees?
- Payment methods accepted?
- Do you offer payment plans?

**SERVICES** (one FAQ per distinct service):
- What does [service name] include?
- How long does [service] take?
- What equipment/products do you use?
- What's NOT included?

**COVERAGE AREA**:
- What areas do you cover? (list all postcodes/towns mentioned)
- Do you charge for travel?
- What areas are outside your service area?

**BOOKING & AVAILABILITY**:
- How do I book?
- What's your cancellation policy?
- How much notice do you need?
- What are your opening hours? (be specific per day)
- Do you offer emergency services?

**ABOUT THE BUSINESS**:
- Are you insured?
- What qualifications/certifications do you have?
- How long have you been in business?
- Who owns/runs the business?

**POLICIES**:
- What is your satisfaction guarantee?
- Do you offer free quotes?
- What happens if I'm not happy?

RULES:
1. Use EXACT figures from the website (e.g., "£45" not "around £40-50")
2. Include the business name in answers where appropriate
3. Be specific - "We cover Leeds, Wakefield, and Bradford" not "We cover the local area"
4. Generate at least 30 FAQs if sufficient content exists
5. Each FAQ must be genuinely useful for a customer

OUTPUT FORMAT (JSON array only, no other text):
[
  {"question": "How much does X cost?", "answer": "X costs £45...", "category": "pricing", "tags": ["price", "cost"]},
  ...
]`;

    console.log('Calling Claude for FAQ extraction...');
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('Claude API error:', claudeResponse.status, errorText);
      throw new Error(`Claude API error: ${claudeResponse.status}`);
    }

    const claudeData = await claudeResponse.json();
    const content = claudeData.content?.[0]?.text || '';
    console.log(`Claude response length: ${content.length}`);

    let faqs: any[] = [];
    try {
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        faqs = JSON.parse(match[0]);
      }
    } catch (e) {
      console.error('Error parsing Claude response:', e);
    }

    console.log(`Extracted ${faqs.length} FAQs`);

    if (faqs.length === 0) {
      await supabase
        .from('business_context')
        .update({ 
          knowledge_base_status: 'complete',
          knowledge_base_completed_at: new Date().toISOString(),
          website_faqs_generated: 0
        })
        .eq('workspace_id', workspaceId);

      return new Response(JSON.stringify({
        success: true,
        pagesScraped: crawlData.length,
        faqsGenerated: 0,
        message: 'Could not extract FAQs from website content'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // STEP 4: Generate embeddings and store
    console.log('Generating embeddings...');
    const faqsToInsert = [];

    for (const faq of faqs) {
      if (!faq.question || !faq.answer) continue;

      try {
        const embResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: `${faq.question} ${faq.answer}`
          })
        });

        if (embResponse.ok) {
          const embData = await embResponse.json();
          faqsToInsert.push({
            question: faq.question,
            answer: faq.answer,
            category: faq.category || 'general',
            keywords: faq.tags || [],
            embedding: embData.data[0].embedding,
            workspace_id: workspaceId,
            is_own_content: true,
            is_industry_standard: false,
            source_company: businessName,
            source_url: formattedUrl,
            generation_source: 'website_scrape',
            priority: 10,
            is_active: true,
            enabled: true
          });
        }
      } catch (e) {
        console.error('Error generating embedding for FAQ:', e);
      }
    }

    console.log(`Generated ${faqsToInsert.length} FAQs with embeddings`);

    if (faqsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('faq_database')
        .insert(faqsToInsert);

      if (insertError) {
        console.error('Error inserting FAQs:', insertError);
        throw insertError;
      }
    }

    // Update status
    await supabase
      .from('business_context')
      .update({ 
        knowledge_base_status: 'complete',
        knowledge_base_completed_at: new Date().toISOString(),
        website_faqs_generated: faqsToInsert.length
      })
      .eq('workspace_id', workspaceId);

    console.log('Website scraping complete');

    return new Response(JSON.stringify({
      success: true,
      pagesScraped: crawlData.length,
      faqsGenerated: faqsToInsert.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Error in scrape-customer-website:', error);
    
    // Try to update status to error
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      const { workspaceId } = await req.json().catch(() => ({}));
      if (workspaceId) {
        await supabase
          .from('business_context')
          .update({ knowledge_base_status: 'error' })
          .eq('workspace_id', workspaceId);
      }
    } catch (e) {
      // Ignore update errors
    }

    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
