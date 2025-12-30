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

    const { workspaceId, industryType } = await req.json();

    console.log(`Copying industry FAQs for workspace ${workspaceId}, industry: ${industryType}`);

    if (!workspaceId || !industryType) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'workspaceId and industryType are required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get templates for this industry
    const { data: templates, error: fetchError } = await supabase
      .from('industry_faq_templates')
      .select('*')
      .eq('industry_type', industryType)
      .eq('is_active', true);

    if (fetchError) {
      console.error('Error fetching templates:', fetchError);
      throw fetchError;
    }

    if (!templates || templates.length === 0) {
      console.log(`No templates available for ${industryType} yet`);
      return new Response(JSON.stringify({ 
        success: true, 
        faqsCopied: 0,
        message: `No templates available for ${industryType} yet. These will be added by admin.`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Found ${templates.length} templates to copy`);

    // Copy templates to customer's workspace
    const customerFaqs = templates.map(t => ({
      question: t.question,
      answer: t.answer,
      category: t.category,
      keywords: t.tags,
      metadata: t.metadata,
      embedding: t.embedding,
      workspace_id: workspaceId,
      is_own_content: false,
      is_industry_standard: true,
      source_company: 'Industry Knowledge',
      generation_source: 'industry_template',
      priority: 5,
      is_active: true,
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    // Insert in batches of 100 to avoid timeout
    const batchSize = 100;
    let totalInserted = 0;

    for (let i = 0; i < customerFaqs.length; i += batchSize) {
      const batch = customerFaqs.slice(i, i + batchSize);
      const { error: insertError } = await supabase
        .from('faq_database')
        .insert(batch);

      if (insertError) {
        console.error(`Error inserting batch ${i / batchSize + 1}:`, insertError);
        throw insertError;
      }
      totalInserted += batch.length;
      console.log(`Inserted batch ${i / batchSize + 1}, total: ${totalInserted}`);
    }

    // Update business_context with count
    await supabase
      .from('business_context')
      .update({ 
        industry_faqs_copied: totalInserted,
        knowledge_base_status: 'templates_copied'
      })
      .eq('workspace_id', workspaceId);

    console.log(`Successfully copied ${totalInserted} FAQs`);

    return new Response(JSON.stringify({
      success: true,
      faqsCopied: totalInserted
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Error in copy-industry-faqs:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
