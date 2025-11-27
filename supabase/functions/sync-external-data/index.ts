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
    const tables = url.searchParams.get('tables')?.split(',') || ['faq_database', 'price_list', 'business_facts', 'conversations'];
    const fullSync = url.searchParams.get('full') === 'true';

    console.log('Starting sync:', { tables, fullSync });

    // Get external credentials
    const externalUrl = Deno.env.get('EXTERNAL_SUPABASE_URL');
    const externalKey = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_KEY');

    if (!externalUrl || !externalKey) {
      throw new Error('External Supabase credentials not configured. Please add EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_SERVICE_KEY secrets.');
    }

    console.log('External Supabase URL:', externalUrl);

    // Create Supabase clients
    const localSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const externalSupabase = createClient(externalUrl, externalKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    });
    
    console.log('External client configured with service key');

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

    // Sync Conversations
    if (tables.includes('conversations')) {
      const convStats = await syncConversations(externalSupabase, localSupabase, workspace.id, fullSync);
      stats.push(convStats);
      totalFetched += convStats.fetched;
      totalInserted += convStats.inserted;
      totalUpdated += convStats.updated;
      totalUnchanged += convStats.unchanged;
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
    // Fetch external FAQs in smaller batches
    let allFAQs: any[] = [];
    let from = 0;
    const batchSize = 500; // Reduced from 1000
    let hasMore = true;

    console.log('Fetching FAQs with fullSync:', fullSync);

    while (hasMore) {
      let query = externalSupabase
        .from('faq_database')
        .select('*')
        .range(from, from + batchSize - 1);
      
      if (!fullSync) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        query = query.gte('updated_at', oneDayAgo);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching external FAQs:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        hasMore = false;
      } else {
        allFAQs = allFAQs.concat(data);
        console.log(`Fetched batch: ${data.length} FAQs (total: ${allFAQs.length})`);
        
        if (data.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      }
    }

    stats.fetched = allFAQs.length;
    console.log(`Fetched ${stats.fetched} FAQs total from external database`);

    if (allFAQs.length === 0) {
      return stats;
    }

    // Fetch ALL existing FAQs in ONE query
    const externalIds = allFAQs.map(f => f.id);
    const { data: existingFAQs } = await localSupabase
      .from('faq_database')
      .select('id, external_id, updated_at')
      .eq('workspace_id', workspaceId)
      .in('external_id', externalIds);

    // Create a Map for fast lookups
    const existingMap = new Map(
      (existingFAQs || []).map((f: any) => [f.external_id, f])
    );

    console.log(`Found ${existingFAQs?.length || 0} existing FAQs in local database`);

    // Prepare batched inserts and updates
    const toInsert: any[] = [];
    const toUpdate: any[] = [];

    for (const externalFAQ of allFAQs) {
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

      const existing: any = existingMap.get(externalFAQ.id);
      
      if (existing) {
        // Check if update needed
        if (new Date(externalFAQ.updated_at) > new Date(existing.updated_at)) {
          toUpdate.push({ ...faqData, id: existing.id });
        } else {
          stats.unchanged++;
        }
      } else {
        toInsert.push(faqData);
      }
    }

    // Batch insert new FAQs (500 at a time) using upsert to handle duplicates
    if (toInsert.length > 0) {
      console.log(`Upserting ${toInsert.length} FAQs in batches...`);
      for (let i = 0; i < toInsert.length; i += 500) {
        const batch = toInsert.slice(i, i + 500);
        const { error } = await localSupabase
          .from('faq_database')
          .upsert(batch, { 
            onConflict: 'external_id,workspace_id',
            ignoreDuplicates: false 
          });
        
        if (error) {
          console.error('Batch upsert error:', error);
          stats.errors.push(`Batch upsert failed: ${error.message}`);
        } else {
          stats.inserted += batch.length;
        }
      }
    }

    // Batch update existing FAQs (100 at a time - updates are more expensive)
    if (toUpdate.length > 0) {
      console.log(`Updating ${toUpdate.length} FAQs...`);
      for (const faq of toUpdate) {
        const { id, ...updateData } = faq;
        const { error } = await localSupabase
          .from('faq_database')
          .update(updateData)
          .eq('id', id);
        
        if (error) {
          console.error('Update error:', error);
          stats.errors.push(`Update failed for FAQ ${id}: ${error.message}`);
        } else {
          stats.updated++;
        }
      }
    }

    console.log(`FAQ sync complete: inserted ${stats.inserted}, updated ${stats.updated}, unchanged ${stats.unchanged}`);
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
    let allPrices: any[] = [];
    let from = 0;
    const batchSize = 500;
    let hasMore = true;

    while (hasMore) {
      let query = externalSupabase
        .from('price_list')
        .select('*')
        .range(from, from + batchSize - 1);
      
      if (!fullSync) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        query = query.gte('updated_at', oneDayAgo);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length === 0) {
        hasMore = false;
      } else {
        allPrices = allPrices.concat(data);
        if (data.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      }
    }

    stats.fetched = allPrices.length;
    console.log(`Fetched ${stats.fetched} prices from external database`);

    if (allPrices.length === 0) {
      return stats;
    }

    // Fetch existing prices in ONE query
    const externalIds = allPrices.map(p => p.id);
    const { data: existingPrices } = await localSupabase
      .from('price_list')
      .select('id, external_id, updated_at')
      .eq('workspace_id', workspaceId)
      .in('external_id', externalIds);

    const existingMap = new Map(
      (existingPrices || []).map((p: any) => [p.external_id, p])
    );

    const toInsert: any[] = [];
    const toUpdate: any[] = [];

    for (const externalPrice of allPrices) {
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

      const existing: any = existingMap.get(externalPrice.id);
      
      if (existing) {
        if (new Date(externalPrice.updated_at) > new Date(existing.updated_at)) {
          toUpdate.push({ ...priceData, id: existing.id });
        } else {
          stats.unchanged++;
        }
      } else {
        toInsert.push(priceData);
      }
    }

    // Batch operations
    if (toInsert.length > 0) {
      const { error } = await localSupabase
        .from('price_list')
        .insert(toInsert);
      
      if (error) {
        stats.errors.push(`Insert failed: ${error.message}`);
      } else {
        stats.inserted = toInsert.length;
      }
    }

    if (toUpdate.length > 0) {
      for (const price of toUpdate) {
        const { id, ...updateData } = price;
        const { error } = await localSupabase
          .from('price_list')
          .update(updateData)
          .eq('id', id);
        
        if (error) {
          stats.errors.push(`Update failed: ${error.message}`);
        } else {
          stats.updated++;
        }
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
    let allFacts: any[] = [];
    let from = 0;
    const batchSize = 500;
    let hasMore = true;

    while (hasMore) {
      let query = externalSupabase
        .from('business_facts')
        .select('*')
        .range(from, from + batchSize - 1);
      
      if (!fullSync) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        query = query.gte('updated_at', oneDayAgo);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length === 0) {
        hasMore = false;
      } else {
        allFacts = allFacts.concat(data);
        if (data.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      }
    }

    stats.fetched = allFacts.length;
    console.log(`Fetched ${stats.fetched} business facts from external database`);

    if (allFacts.length === 0) {
      return stats;
    }

    // Fetch existing facts in ONE query
    const externalIds = allFacts.map(f => f.id);
    const { data: existingFacts } = await localSupabase
      .from('business_facts')
      .select('id, external_id, updated_at')
      .eq('workspace_id', workspaceId)
      .in('external_id', externalIds);

    const existingMap = new Map(
      (existingFacts || []).map((f: any) => [f.external_id, f])
    );

    const toInsert: any[] = [];
    const toUpdate: any[] = [];

    for (const externalFact of allFacts) {
      const factData = {
        workspace_id: workspaceId,
        external_id: externalFact.id,
        category: externalFact.category,
        fact_key: externalFact.fact_key,
        fact_value: externalFact.fact_value,
        metadata: externalFact.metadata || {},
        updated_at: externalFact.updated_at || new Date().toISOString(),
      };

      const existing: any = existingMap.get(externalFact.id);
      
      if (existing) {
        if (new Date(externalFact.updated_at) > new Date(existing.updated_at)) {
          toUpdate.push({ ...factData, id: existing.id });
        } else {
          stats.unchanged++;
        }
      } else {
        toInsert.push(factData);
      }
    }

    // Batch operations
    if (toInsert.length > 0) {
      const { error } = await localSupabase
        .from('business_facts')
        .insert(toInsert);
      
      if (error) {
        stats.errors.push(`Insert failed: ${error.message}`);
      } else {
        stats.inserted = toInsert.length;
      }
    }

    if (toUpdate.length > 0) {
      for (const fact of toUpdate) {
        const { id, ...updateData } = fact;
        const { error } = await localSupabase
          .from('business_facts')
          .update(updateData)
          .eq('id', id);
        
        if (error) {
          stats.errors.push(`Update failed: ${error.message}`);
        } else {
          stats.updated++;
        }
      }
    }
  } catch (error) {
    console.error('Error syncing business facts:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    stats.errors.push(errorMessage);
  }

  return stats;
}

async function syncConversations(
  externalSupabase: any,
  localSupabase: any,
  workspaceId: string,
  fullSync: boolean
): Promise<SyncStats> {
  const stats: SyncStats = {
    table: 'conversations',
    fetched: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: [],
  };

  try {
    // First, test if we can access the conversations table
    console.log('Testing external database access to conversations table...');
    const { count, error: countError } = await externalSupabase
      .from('conversations')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.error('Error accessing conversations table:', countError);
      stats.errors.push(`Cannot access conversations table: ${countError.message}`);
      return stats;
    }
    
    console.log(`External conversations table has ${count} total records`);
    
    // Process conversations in SMALL STREAMING CHUNKS to avoid memory issues
    let from = 0;
    const chunkSize = 100; // Process 100 at a time
    let hasMore = true;
    let processedCount = 0;

    while (hasMore) {
      // Fetch a small batch
      let query = externalSupabase
        .from('conversations')
        .select('*')
        .range(from, from + chunkSize - 1);
      
      if (!fullSync) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        query = query.gte('created_at', oneDayAgo);
      }

      console.log(`Processing conversations ${from}-${from + chunkSize - 1}...`);
      const { data: batchConvs, error } = await query;
      
      if (error) {
        console.error('Error fetching conversations batch:', error);
        stats.errors.push(`Batch fetch error: ${error.message}`);
        break;
      }

      if (!batchConvs || batchConvs.length === 0) {
        hasMore = false;
        break;
      }

      // Process this batch
      const batchResults = await processBatchConversations(
        batchConvs,
        localSupabase,
        workspaceId
      );

      stats.fetched += batchConvs.length;
      stats.inserted += batchResults.inserted;
      stats.updated += batchResults.updated;
      stats.unchanged += batchResults.unchanged;
      stats.errors.push(...batchResults.errors);

      processedCount += batchConvs.length;
      console.log(`Processed ${processedCount} conversations so far (inserted: ${stats.inserted}, updated: ${stats.updated})`);

      // Check if we should continue
      if (batchConvs.length < chunkSize) {
        hasMore = false;
      } else {
        from += chunkSize;
      }
    }

    console.log(`Conversation sync complete: fetched ${stats.fetched}, inserted ${stats.inserted}, updated ${stats.updated}, unchanged ${stats.unchanged}`);
  } catch (error) {
    console.error('Error syncing conversations:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    stats.errors.push(errorMessage);
  }

  return stats;
}

async function processBatchConversations(
  conversations: any[],
  localSupabase: any,
  workspaceId: string
): Promise<{ inserted: number; updated: number; unchanged: number; errors: string[] }> {
  const result = { inserted: 0, updated: 0, unchanged: 0, errors: [] as string[] };

  // Get all external IDs from this batch
  const externalIds = conversations.map(c => String(c.id));
  
  // Fetch existing conversations in ONE query
  const { data: existingConvs } = await localSupabase
    .from('conversations')
    .select('id, external_conversation_id, updated_at')
    .eq('workspace_id', workspaceId)
    .in('external_conversation_id', externalIds);

  const existingMap = new Map(
    (existingConvs || []).map((c: any) => [c.external_conversation_id, c])
  );

  const toInsert: any[] = [];
  const toUpdate: any[] = [];

  for (const externalConv of conversations) {
    try {
      // Map source to channel
      const channelMap: Record<string, string> = {
        'whatsapp': 'whatsapp',
        'sms': 'sms',
        'email': 'email',
        'phone': 'phone',
        'web': 'webchat',
      };
      const channel = channelMap[externalConv.source?.toLowerCase()] || 'webchat';

      // Try to find customer (simplified - no batch optimization here yet)
      let customerId = null;
      if (externalConv.customer_phone || externalConv.customer_email) {
        const customerQuery = localSupabase
          .from('customers')
          .select('id')
          .eq('workspace_id', workspaceId);

        if (externalConv.customer_phone) {
          customerQuery.eq('phone', externalConv.customer_phone);
        } else if (externalConv.customer_email) {
          customerQuery.eq('email', externalConv.customer_email);
        }

        const { data: customer } = await customerQuery.maybeSingle();
        customerId = customer?.id || null;
      }

      const convData = {
        workspace_id: workspaceId,
        external_conversation_id: String(externalConv.id),
        customer_id: customerId,
        channel: channel,
        title: externalConv.text?.substring(0, 100) || 'Imported conversation',
        summary_for_human: externalConv.text || null,
        category: externalConv.intent || 'other',
        mode: externalConv.mode || 'ai',
        status: externalConv.escalation_handled ? 'resolved' : (externalConv.escalated ? 'escalated' : 'new'),
        is_escalated: externalConv.escalated ?? false,
        confidence: externalConv.confidence || null,
        ai_draft_response: externalConv.ai_draft_response || externalConv.ai_response || null,
        final_response: externalConv.final_response || null,
        human_edited: externalConv.human_edited ?? false,
        auto_responded: externalConv.auto_responded ?? false,
        customer_satisfaction: externalConv.customer_satisfaction || null,
        led_to_booking: externalConv.led_to_booking ?? false,
        embedding: externalConv.embedding || null,
        needs_embedding: !externalConv.embedding,
        first_response_at: externalConv.sent_at || null,
        metadata: externalConv.metadata || {},
        created_at: externalConv.created_at || new Date().toISOString(),
        updated_at: externalConv.created_at || new Date().toISOString(),
      };

      const existing: any = existingMap.get(String(externalConv.id));
      
      if (existing) {
        if (new Date(externalConv.created_at) > new Date(existing.updated_at)) {
          toUpdate.push({ ...convData, id: existing.id });
        } else {
          result.unchanged++;
        }
      } else {
        toInsert.push(convData);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Conversation ${externalConv.id}: ${errorMessage}`);
    }
  }

  // Batch insert
  if (toInsert.length > 0) {
    const { error } = await localSupabase
      .from('conversations')
      .upsert(toInsert, { 
        onConflict: 'external_conversation_id,workspace_id',
        ignoreDuplicates: false 
      });
    
    if (error) {
      result.errors.push(`Batch insert failed: ${error.message}`);
    } else {
      result.inserted = toInsert.length;
    }
  }

  // Batch update
  if (toUpdate.length > 0) {
    for (const conv of toUpdate) {
      const { id, ...updateData } = conv;
      const { error } = await localSupabase
        .from('conversations')
        .update(updateData)
        .eq('id', id);
      
      if (error) {
        result.errors.push(`Update failed: ${error.message}`);
      } else {
        result.updated++;
      }
    }
  }

  return result;
}
