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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { customer_identifier, channel, consent_method, customer_name, workspace_id } = await req.json();

    if (!customer_identifier || !channel || !consent_method) {
      return new Response(
        JSON.stringify({ error: 'customer_identifier, channel, and consent_method are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Creating consent for:', customer_identifier, 'on channel:', channel);

    // Find or create customer using safe parameterized queries
    let { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', customer_identifier)
      .maybeSingle();

    if (!customer) {
      const result = await supabase
        .from('customers')
        .select('id')
        .eq('phone', customer_identifier)
        .maybeSingle();
      customer = result.data;
    }

    if (!customer) {
      console.log('Customer not found, creating new customer');
      
      // Determine if identifier is email or phone
      const isEmail = customer_identifier.includes('@');
      const customerData: any = {
        workspace_id: workspace_id,
        name: customer_name || customer_identifier,
      };
      
      if (isEmail) {
        customerData.email = customer_identifier;
      } else {
        customerData.phone = customer_identifier;
      }

      const { data: newCustomer, error: createError } = await supabase
        .from('customers')
        .insert(customerData)
        .select('id')
        .single();

      if (createError) {
        console.error('Error creating customer:', createError);
        throw createError;
      }

      customer = newCustomer;
    }

    // Create consent record
    const { data: consent, error: consentError } = await supabase
      .from('customer_consents')
      .insert({
        customer_id: customer.id,
        channel: channel,
        consent_given: true,
        consent_date: new Date().toISOString(),
        consent_method: consent_method,
        notes: `Consent captured via ${consent_method} contact`
      })
      .select('id')
      .single();

    if (consentError) {
      console.error('Error creating consent:', consentError);
      throw consentError;
    }

    console.log('Consent created:', consent);
    return new Response(
      JSON.stringify({
        success: true,
        consent_id: consent.id,
        customer_id: customer.id
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error creating consent:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
