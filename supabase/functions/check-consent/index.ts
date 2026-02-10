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

    const { customer_identifier, channel } = await req.json();

    if (!customer_identifier || !channel) {
      return new Response(
        JSON.stringify({ error: 'customer_identifier and channel are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Checking consent for:', customer_identifier, 'on channel:', channel);

    // Find customer by email or phone using safe parameterized queries
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
      console.log('Customer not found');
      return new Response(
        JSON.stringify({ has_consent: false }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check consent for this channel
    const { data: consent } = await supabase
      .from('customer_consents')
      .select('consent_given, consent_date, consent_method')
      .eq('customer_id', customer.id)
      .eq('channel', channel)
      .eq('consent_given', true)
      .is('withdrawn_date', null)
      .single();

    if (!consent) {
      console.log('No consent found for customer');
      return new Response(
        JSON.stringify({ has_consent: false }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Consent found:', consent);
    return new Response(
      JSON.stringify({
        has_consent: true,
        consent_date: consent.consent_date,
        consent_method: consent.consent_method
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error checking consent:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
