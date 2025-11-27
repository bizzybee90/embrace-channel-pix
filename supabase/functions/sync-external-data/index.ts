import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncStats {
  table: string;
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get query parameters
    const url = new URL(req.url);
    const tables = url.searchParams.get('tables')?.split(',') || ['faq_database', 'price_list', 'business_facts'];
    const fullSync = url.searchParams.get('full') === 'true';

    console.log('Starting sync:', { tables, fullSync });

    // Create Supabase clients
    const localSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const externalSupabase = createClient(
      Deno.env.get('EXTERNAL_SUPABASE_URL') ?? '',
      Deno.env.get('EXTERNAL_SUPABASE_SERVICE_KEY') ?? ''
    );

    // Get workspace ID
    const { data: workspace } = await localSupabase
      .from('workspaces')
      .select('id')
      .limit(1)
      .single();

    if (!workspace) {
      throw new Error('No workspace found');
    }

    // Create sync log entry
    const { data: syncLog, error: logError } = await localSupabase
      .from('sync_logs')
      .insert({
        workspace_id: workspace.id,
        sync_type: fullSync ? 'full' : 'incremental',
        tables_synced: tables,
        status: 'running',
      })
      .select()
      .single();

    if (logError) {
      console.error('Error creating sync log:', logError);
    }

    const stats: SyncStats[] = [];
    let totalFetched = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalUnchanged = 0;

    // Sync FAQ Database
    if (tables.includes('faq_database')) {
      const faqStats = await syncFAQDatabase(externalSupabase, localSupabase, workspace.id, fullSync);
      stats.push(faqStats);
      totalFetched += faqStats.fetched;
      totalInserted += faqStats.inserted;
      totalUpdated += faqStats.updated;
      totalUnchanged += faqStats.unchanged;
    }

    // Sync Price List
    if (tables.includes('price_list')) {
      const priceStats = await syncPriceList(externalSupabase, localSupabase, workspace.id, fullSync);
      stats.push(priceStats);
      totalFetched += priceStats.fetched;
      totalInserted += priceStats.inserted;
      totalUpdated += priceStats.updated;
      totalUnchanged += priceStats.unchanged;
    }

    // Sync Business Facts
    if (tables.includes('business_facts')) {
      const factsStats = await syncBusinessFacts(externalSupabase, localSupabase, workspace.id, fullSync);
      stats.push(factsStats);
      totalFetched += factsStats.fetched;
      totalInserted += factsStats.inserted;
      totalUpdated += factsStats.updated;
      totalUnchanged += factsStats.unchanged;
    }

    // Update sync log
    if (syncLog) {
      await localSupabase
        .from('sync_logs')
        .update({
          completed_at: new Date().toISOString(),
          status: 'success',
          records_fetched: totalFetched,
          records_inserted: totalInserted,
          records_updated: totalUpdated,
          records_unchanged: totalUnchanged,
          details: { stats },
        })
        .eq('id', syncLog.id);
    }

    const response = {
      success: true,
      sync_id: syncLog?.id,
      stats,
      totals: {
        fetched: totalFetched,
        inserted: totalInserted,
        updated: totalUpdated,
        unchanged: totalUnchanged,
      },
    };

    console.log('Sync completed:', response);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error in sync-external-data:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage
      }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

async function syncFAQDatabase(
  externalSupabase: any,
  localSupabase: any,
  workspaceId: string,
  fullSync: boolean
): Promise<SyncStats> {
  const stats: SyncStats = {
    table: 'faq_database',
    fetched: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: [],
  };

  try {
    // Fetch external FAQs
    let query = externalSupabase.from('faq_database').select('*');
    
    if (!fullSync) {
      // Incremental sync - only get recently updated
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('updated_at', oneDayAgo);
    }

    const { data: externalFAQs, error } = await query;

    if (error) throw error;

    stats.fetched = externalFAQs?.length || 0;
    console.log(`Fetched ${stats.fetched} FAQs from external database`);

    // Process each FAQ
    for (const externalFAQ of externalFAQs || []) {
      try {
        // Check if FAQ exists
        const { data: existing } = await localSupabase
          .from('faq_database')
          .select('id, updated_at')
          .eq('external_id', externalFAQ.id)
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        const faqData = {
          workspace_id: workspaceId,
          external_id: externalFAQ.id,
          category: externalFAQ.category,
          question: externalFAQ.question,
          answer: externalFAQ.answer,
          keywords: externalFAQ.tags || [],
          priority: externalFAQ.priority || 0,
          is_active: externalFAQ.is_active ?? true,
          enabled: externalFAQ.enabled ?? true,
          embedding: externalFAQ.embedding || null,
          is_mac_specific: externalFAQ.is_mac_specific ?? false,
          is_industry_standard: externalFAQ.is_industry_standard ?? false,
          source_company: externalFAQ.source_company || null,
          updated_at: externalFAQ.updated_at || new Date().toISOString(),
        };

        if (existing) {
          // Check if update needed
          if (new Date(externalFAQ.updated_at) > new Date(existing.updated_at)) {
            const { error: updateError } = await localSupabase
              .from('faq_database')
              .update(faqData)
              .eq('id', existing.id);

            if (updateError) throw updateError;
            stats.updated++;
          } else {
            stats.unchanged++;
          }
        } else {
          // Insert new FAQ
          const { error: insertError } = await localSupabase
            .from('faq_database')
            .insert(faqData);

          if (insertError) throw insertError;
          stats.inserted++;
        }
      } catch (error) {
        console.error('Error processing FAQ:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        stats.errors.push(`FAQ ${externalFAQ.id}: ${errorMessage}`);
      }
    }
  } catch (error) {
    console.error('Error syncing FAQ database:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    stats.errors.push(errorMessage);
  }

  return stats;
}

async function syncPriceList(
  externalSupabase: any,
  localSupabase: any,
  workspaceId: string,
  fullSync: boolean
): Promise<SyncStats> {
  const stats: SyncStats = {
    table: 'price_list',
    fetched: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: [],
  };

  try {
    // Fetch external prices
    let query = externalSupabase.from('price_list').select('*');
    
    if (!fullSync) {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('updated_at', oneDayAgo);
    }

    const { data: externalPrices, error } = await query;

    if (error) throw error;

    stats.fetched = externalPrices?.length || 0;
    console.log(`Fetched ${stats.fetched} prices from external database`);

    // Process each price
    for (const externalPrice of externalPrices || []) {
      try {
        // Check if price exists
        const { data: existing } = await localSupabase
          .from('price_list')
          .select('id, updated_at')
          .eq('external_id', externalPrice.id)
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        const priceData = {
          workspace_id: workspaceId,
          external_id: externalPrice.id,
          service_code: externalPrice.service_code,
          service_name: externalPrice.service_name,
          category: externalPrice.category,
          description: externalPrice.description || null,
          property_type: externalPrice.property_type || null,
          bedrooms: externalPrice.bedrooms || null,
          base_price: externalPrice.price_typical || null,
          price_typical: externalPrice.price_typical || null,
          price_min: externalPrice.price_min || null,
          price_max: externalPrice.price_max || null,
          window_price_min: externalPrice.window_price_min || null,
          window_price_max: externalPrice.window_price_max || null,
          price_range: externalPrice.price_min && externalPrice.price_max 
            ? `£${externalPrice.price_min} - £${externalPrice.price_max}` 
            : null,
          applies_to_properties: externalPrice.applies_to_properties || null,
          rule_priority: externalPrice.rule_priority || 0,
          customer_count: externalPrice.customer_count || 0,
          affects_package: externalPrice.affects_package ?? false,
          per_unit: externalPrice.per_unit ?? false,
          is_active: externalPrice.is_active ?? true,
          currency: 'GBP',
          unit: externalPrice.per_unit ? 'per unit' : null,
          updated_at: externalPrice.updated_at || new Date().toISOString(),
        };

        if (existing) {
          // Check if update needed
          if (new Date(externalPrice.updated_at) > new Date(existing.updated_at)) {
            const { error: updateError } = await localSupabase
              .from('price_list')
              .update(priceData)
              .eq('id', existing.id);

            if (updateError) throw updateError;
            stats.updated++;
          } else {
            stats.unchanged++;
          }
        } else {
          // Insert new price
          const { error: insertError } = await localSupabase
            .from('price_list')
            .insert(priceData);

          if (insertError) throw insertError;
          stats.inserted++;
        }
      } catch (error) {
        console.error('Error processing price:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        stats.errors.push(`Price ${externalPrice.id}: ${errorMessage}`);
      }
    }
  } catch (error) {
    console.error('Error syncing price list:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    stats.errors.push(errorMessage);
  }

  return stats;
}

async function syncBusinessFacts(
  externalSupabase: any,
  localSupabase: any,
  workspaceId: string,
  fullSync: boolean
): Promise<SyncStats> {
  const stats: SyncStats = {
    table: 'business_facts',
    fetched: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: [],
  };

  try {
    // Fetch external facts
    let query = externalSupabase.from('business_facts').select('*');
    
    if (!fullSync) {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('updated_at', oneDayAgo);
    }

    const { data: externalFacts, error } = await query;

    if (error) throw error;

    stats.fetched = externalFacts?.length || 0;
    console.log(`Fetched ${stats.fetched} business facts from external database`);

    // Process each fact
    for (const externalFact of externalFacts || []) {
      try {
        // Check if fact exists
        const { data: existing } = await localSupabase
          .from('business_facts')
          .select('id, updated_at')
          .eq('external_id', externalFact.id)
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        const factData = {
          workspace_id: workspaceId,
          external_id: externalFact.id,
          category: externalFact.category,
          fact_key: externalFact.fact_key,
          fact_value: externalFact.fact_value,
          metadata: {},
          updated_at: externalFact.updated_at || new Date().toISOString(),
        };

        if (existing) {
          // Check if update needed
          if (new Date(externalFact.updated_at) > new Date(existing.updated_at)) {
            const { error: updateError } = await localSupabase
              .from('business_facts')
              .update(factData)
              .eq('id', existing.id);

            if (updateError) throw updateError;
            stats.updated++;
          } else {
            stats.unchanged++;
          }
        } else {
          // Insert new fact
          const { error: insertError } = await localSupabase
            .from('business_facts')
            .insert(factData);

          if (insertError) throw insertError;
          stats.inserted++;
        }
      } catch (error) {
        console.error('Error processing business fact:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        stats.errors.push(`Fact ${externalFact.id}: ${errorMessage}`);
      }
    }
  } catch (error) {
    console.error('Error syncing business facts:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    stats.errors.push(errorMessage);
  }

  return stats;
}
