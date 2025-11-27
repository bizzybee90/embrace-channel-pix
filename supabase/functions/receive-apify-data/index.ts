import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ApifyCustomer {
  customer_id: string;
  customer_name?: string;
  address?: string;
  phone?: string;
  email?: string;
  next_appointment?: string;
  price?: number;
  frequency?: string;
  schedule_code?: string;
  notes?: string;
  status?: string;
  payment_method?: string;
  balance?: number;
  tier?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload = await req.json();
    console.log('Received Apify webhook:', { payload });

    // Extract customers array from payload (handle both single and batch)
    const customers: ApifyCustomer[] = Array.isArray(payload) 
      ? payload 
      : payload.customers 
      ? payload.customers 
      : [payload];

    if (customers.length === 0) {
      throw new Error('No customer data provided');
    }

    // Get workspace ID (assuming first workspace for now)
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id')
      .limit(1)
      .single();

    if (!workspace) {
      throw new Error('No workspace found');
    }

    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];

    // Process each customer
    for (const customer of customers) {
      try {
        if (!customer.customer_id) {
          errors.push('Missing customer_id');
          continue;
        }

        // Check if customer exists
        const { data: existing } = await supabase
          .from('customers')
          .select('id')
          .eq('customer_id', customer.customer_id)
          .eq('workspace_id', workspace.id)
          .maybeSingle();

        const customerData = {
          workspace_id: workspace.id,
          customer_id: customer.customer_id,
          name: customer.customer_name || null,
          address: customer.address || null,
          phone: customer.phone || null,
          email: customer.email || null,
          next_appointment: customer.next_appointment || null,
          price: customer.price || null,
          frequency: customer.frequency || null,
          schedule_code: customer.schedule_code || null,
          notes: customer.notes || null,
          status: customer.status || 'active',
          payment_method: customer.payment_method || null,
          balance: customer.balance || 0,
          tier: customer.tier || 'regular',
          last_updated: new Date().toISOString(),
        };

        if (existing) {
          // Update existing customer
          const { error } = await supabase
            .from('customers')
            .update(customerData)
            .eq('id', existing.id);

          if (error) throw error;
          updated++;
        } else {
          // Insert new customer
          const { error } = await supabase
            .from('customers')
            .insert(customerData);

          if (error) throw error;
          inserted++;
        }
      } catch (error) {
        console.error('Error processing customer:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`${customer.customer_id}: ${errorMessage}`);
      }
    }

    // Log webhook request
    await supabase
      .from('webhook_logs')
      .insert({
        direction: 'inbound',
        webhook_url: req.url,
        payload: payload,
        status_code: 200,
      });

    const response = {
      success: true,
      inserted,
      updated,
      total: customers.length,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log('Apify webhook processed:', response);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error in receive-apify-data:', error);
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
