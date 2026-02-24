import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Lightweight rate limiter using the existing api_usage table.
 * 
 * Checks how many requests a workspace has made to a specific endpoint
 * within a time window. If over the limit, returns a 429 response.
 * If under the limit, logs the request and returns null (proceed).
 * 
 * Limits are set generously — a real business will never hit them.
 * They exist purely to stop automated abuse / runaway scripts.
 */

interface RateLimitConfig {
  /** Which endpoint is being called (stored in api_usage.function_name) */
  endpoint: string;
  /** Max requests allowed in the window */
  maxRequests: number;
  /** Time window in minutes */
  windowMinutes: number;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Check rate limit and log the request.
 * Returns a 429 Response if over limit, or null if OK to proceed.
 */
export async function checkRateLimit(
  workspaceId: string,
  config: RateLimitConfig,
): Promise<Response | null> {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const windowStart = new Date(Date.now() - config.windowMinutes * 60_000).toISOString();

    // Count recent requests
    const { count, error } = await supabase
      .from('api_usage')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('function_name', config.endpoint)
      .gte('created_at', windowStart);

    if (error) {
      // If the count query fails, don't block the request — log and proceed
      console.warn(`[rate-limit] Count query failed for ${config.endpoint}:`, error.message);
      return null;
    }

    if ((count ?? 0) >= config.maxRequests) {
      console.warn(
        `[rate-limit] BLOCKED ${config.endpoint} for workspace=${workspaceId}: ` +
        `${count}/${config.maxRequests} in ${config.windowMinutes}min`
      );
      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          message: `Too many requests. Maximum ${config.maxRequests} per ${config.windowMinutes} minutes. Please try again later.`,
          retry_after_seconds: config.windowMinutes * 60,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Retry-After': String(config.windowMinutes * 60),
          },
        },
      );
    }

    // Log this request (fire-and-forget — don't block on the insert)
    supabase
      .from('api_usage')
      .insert({
        workspace_id: workspaceId,
        provider: 'internal',
        function_name: config.endpoint,
        tokens_used: 0,
        requests: 1,
        cost_estimate: 0,
      })
      .then(({ error: insertError }) => {
        if (insertError) {
          console.warn(`[rate-limit] Failed to log request for ${config.endpoint}:`, insertError.message);
        }
      });

    return null; // Under limit — proceed
  } catch (err) {
    // Rate limiter should never crash the main function
    console.error('[rate-limit] Unexpected error:', err);
    return null;
  }
}

/**
 * Pre-configured limits for each endpoint.
 * 
 * These are deliberately generous — a legitimate business won't hit them.
 * They stop automated abuse, runaway scripts, and compromised sessions.
 * 
 * | Endpoint              | Limit       | Normal use         |
 * |-----------------------|-------------|--------------------|
 * | send-reply            | 60/hour     | ~5-20/hour busy    |
 * | email-send            | 60/hour     | same function      |
 * | trigger-n8n-workflow  | 10/hour     | 1-3/day            |
 * | email-import-v2       | 10/hour     | 1-3/day            |
 * | ai-enrich             | 120/hour    | ~50/hour in batch   |
 * | classify-dispatcher   | 10/hour     | 1-3/day            |
 * | email-classify-bulk   | 20/hour     | 1-5/day in batches |
 */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'send-reply': { endpoint: 'send-reply', maxRequests: 60, windowMinutes: 60 },
  'email-send': { endpoint: 'email-send', maxRequests: 60, windowMinutes: 60 },
  'trigger-n8n-workflow': { endpoint: 'trigger-n8n-workflow', maxRequests: 10, windowMinutes: 60 },
  'email-import-v2': { endpoint: 'email-import-v2', maxRequests: 10, windowMinutes: 60 },
  'ai-enrich-conversation': { endpoint: 'ai-enrich-conversation', maxRequests: 120, windowMinutes: 60 },
  'classify-emails-dispatcher': { endpoint: 'classify-emails-dispatcher', maxRequests: 10, windowMinutes: 60 },
  'email-classify-bulk': { endpoint: 'email-classify-bulk', maxRequests: 20, windowMinutes: 60 },
};
