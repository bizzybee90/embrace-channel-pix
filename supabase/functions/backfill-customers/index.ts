import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let options = { dryRun: false, limit: 500 };
    try {
      const body = await req.json();
      options = { ...options, ...body };
    } catch {
      // Use defaults
    }

    console.log('[backfill-customers] Starting with options:', options);

    // Get all conversations
    const { data: conversations, error: fetchError } = await supabase
      .from('conversations')
      .select('id, customer_id, workspace_id')
      .order('created_at', { ascending: false })
      .limit(options.limit);

    if (fetchError) {
      console.error('[backfill-customers] Error fetching:', fetchError);
      throw fetchError;
    }

    console.log(`[backfill-customers] Found ${conversations?.length || 0} conversations to check`);

    let updated = 0;
    let customersCreated = 0;
    const stats = {
      checked: 0,
      alreadyCorrect: 0,
      updated: 0,
      customersCreated: 0,
      errors: 0
    };

    for (const conv of conversations || []) {
      stats.checked++;
      
      try {
        // Get the first message's raw_payload for this conversation
        const { data: messages } = await supabase
          .from('messages')
          .select('raw_payload, actor_name')
          .eq('conversation_id', conv.id)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: true })
          .limit(1);

        const message = messages?.[0];
        if (!message?.raw_payload) {
          continue;
        }

        const rawPayload = message.raw_payload as any;
        
        // Extract sender email from raw_payload - check both 'address' and 'email' fields
        const senderEmail = (
          rawPayload.from?.address || 
          rawPayload.from?.email || 
          rawPayload.sender?.address || 
          rawPayload.sender?.email || 
          ''
        ).toLowerCase().trim();

        const senderName = rawPayload.from?.name || rawPayload.sender?.name || message.actor_name || senderEmail.split('@')[0] || 'Unknown';

        if (!senderEmail || !senderEmail.includes('@')) {
          continue;
        }

        // Check if current customer has the correct email
        if (conv.customer_id) {
          const { data: currentCustomer } = await supabase
            .from('customers')
            .select('id, email, name')
            .eq('id', conv.customer_id)
            .single();

          if (currentCustomer?.email?.toLowerCase() === senderEmail) {
            // Already correct
            stats.alreadyCorrect++;
            continue;
          }
        }

        // Find or create customer with correct email
        let customerId: string;
        
        const { data: existingCustomer } = await supabase
          .from('customers')
          .select('id, name')
          .eq('email', senderEmail)
          .eq('workspace_id', conv.workspace_id)
          .single();

        if (existingCustomer) {
          customerId = existingCustomer.id;
          console.log(`[backfill-customers] Found existing customer for ${senderEmail}: ${existingCustomer.id}`);
        } else {
          // Create new customer
          if (options.dryRun) {
            console.log(`[backfill-customers] Would create customer: ${senderName} <${senderEmail}>`);
            customerId = 'dry-run';
          } else {
            const { data: newCustomer, error: createError } = await supabase
              .from('customers')
              .insert({
                workspace_id: conv.workspace_id,
                email: senderEmail,
                name: senderName,
                preferred_channel: 'email',
              })
              .select()
              .single();

            if (createError) {
              console.error(`[backfill-customers] Error creating customer:`, createError);
              stats.errors++;
              continue;
            }

            customerId = newCustomer.id;
            customersCreated++;
            stats.customersCreated++;
            console.log(`[backfill-customers] Created customer: ${senderName} <${senderEmail}> -> ${customerId}`);
          }
        }

        // Update conversation with correct customer_id
        if (!options.dryRun && customerId !== 'dry-run') {
          const { error: updateError } = await supabase
            .from('conversations')
            .update({ customer_id: customerId })
            .eq('id', conv.id);

          if (updateError) {
            console.error(`[backfill-customers] Error updating conversation:`, updateError);
            stats.errors++;
            continue;
          }
        }

        updated++;
        stats.updated++;
        console.log(`[backfill-customers] Updated conversation ${conv.id} -> customer ${senderEmail}`);

      } catch (err) {
        console.error(`[backfill-customers] Error processing conversation:`, err);
        stats.errors++;
      }
    }

    console.log('[backfill-customers] Complete!', stats);

    return new Response(JSON.stringify({
      success: true,
      dryRun: options.dryRun,
      stats
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('[backfill-customers] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
