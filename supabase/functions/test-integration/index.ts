import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { service } = await req.json();

    if (service === 'twilio') {
      const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
      const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
      const phoneNumber = Deno.env.get('TWILIO_PHONE_NUMBER');

      if (!accountSid || !authToken || !phoneNumber) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            message: 'Twilio credentials not configured' 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Test Twilio API by checking account status
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`;
      const response = await fetch(url, {
        headers: {
          'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        },
      });

      if (response.ok) {
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Twilio connection successful',
            phoneNumber: phoneNumber.slice(0, 3) + ' **** **' + phoneNumber.slice(-3)
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        return new Response(
          JSON.stringify({ 
            success: false, 
            message: 'Twilio authentication failed' 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (service === 'postmark') {
      const apiKey = Deno.env.get('POSTMARK_API_KEY');

      if (!apiKey) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            message: 'Postmark API key not configured' 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Test Postmark API by checking server status
      const response = await fetch('https://api.postmarkapp.com/server', {
        headers: {
          'X-Postmark-Server-Token': apiKey,
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Postmark connection successful' 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        return new Response(
          JSON.stringify({ 
            success: false, 
            message: 'Postmark authentication failed' 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(
      JSON.stringify({ 
        success: false, 
        message: 'Invalid service specified' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Test integration error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});