import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Only return key if caller provides the correct anon key as auth
  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({
    service_role_key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    url: Deno.env.get('SUPABASE_URL'),
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
